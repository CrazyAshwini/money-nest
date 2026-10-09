import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getPrivateProfileStatus,
  loginPrivateProfile,
  logoutPrivateProfile,
  readPrivateProfile,
  savePrivateRecord,
  setupPrivateProfile,
  updatePrivateProfile,
  commitPrivateImport,
  PrivateProfileError,
} from "./private-profile-store";
import { workspaceRecordSchemas } from "./validation";
import type { WorkspaceData } from "./types";
import { privateRequestAllowed } from "./private-request";

const COOKIE = "finance-os-private-session";
export const privateResponse = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });

const token = (request: NextRequest) =>
  request.cookies.get(COOKIE)?.value ?? "";

async function body(request: NextRequest, maxBytes: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid request.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error("Request is too large.");
    }
    chunks.push(chunk.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Invalid request.");
  }
}
const failure = (error: unknown) => {
  if (error instanceof PrivateProfileError)
    return privateResponse(
      { error: error.message },
      error.code === "auth" ? 401 : error.code === "storage" ? 503 : 400,
    );
  if (error instanceof z.ZodError)
    return privateResponse(
      { error: "The request contains invalid fields." },
      400,
    );
  const message = error instanceof Error ? error.message : "Request failed.";
  return privateResponse(
    { error: message },
    message === "Authentication required."
      ? 401
      : message === "Request is too large."
        ? 413
        : 400,
  );
};

export async function privateWorkspaceGET(request: NextRequest) {
  if (!privateRequestAllowed(request))
    return privateResponse(
      { error: "This profile is available only on this computer." },
      403,
    );
  try {
    const session = await readPrivateProfile(token(request));
    if (!session) {
      const status = await getPrivateProfileStatus();
      return privateResponse(
        { configured: true, backend: "local", authenticated: false, ...status },
        401,
      );
    }
    return privateResponse({
      configured: true,
      backend: "local",
      authenticated: true,
      userId: session.profile.id,
      profile: session.profile,
      workspace: session.workspace,
    });
  } catch {
    return privateResponse(
      { configured: true, error: "Your private profile could not be loaded." },
      503,
    );
  }
}

export async function privateWorkspacePOST(request: NextRequest) {
  if (!privateRequestAllowed(request, true))
    return privateResponse({ error: "Request origin is not allowed." }, 403);
  try {
    if (!(await readPrivateProfile(token(request))))
      return privateResponse({ error: "Authentication required." }, 401);
    const input = z
      .object({ collection: z.string(), record: z.unknown() })
      .parse(await body(request, 100000));
    if (
      !Object.hasOwn(workspaceRecordSchemas, input.collection) ||
      input.collection === "auditEvents"
    )
      throw new Error("Unknown record collection.");
    await savePrivateRecord(
      token(request),
      input.collection as keyof WorkspaceData,
      input.record as WorkspaceData[keyof WorkspaceData][number],
    );
    return privateResponse({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

const authSchema = z.object({
  action: z.enum(["setup", "login", "logout", "update"]),
  token: z.string().max(128).optional(),
  password: z.string().min(10).max(128).optional(),
  email: z.string().trim().email().max(254).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
});
export async function privateAuthPOST(request: NextRequest) {
  if (!privateRequestAllowed(request, true))
    return privateResponse({ error: "Request origin is not allowed." }, 403);
  try {
    const parsed = authSchema.safeParse(await body(request, 6000));
    if (!parsed.success)
      throw new Error(
        "Enter a valid email and a password of at least 10 characters.",
      );
    const input = parsed.data;
    if (input.action === "logout") {
      await logoutPrivateProfile(token(request));
      const response = privateResponse({ ok: true });
      response.cookies.set(COOKIE, "", {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        maxAge: 0,
      });
      return response;
    }
    if (input.action === "update") {
      if (!input.displayName) throw new Error("Enter your profile name.");
      const profile = await updatePrivateProfile(token(request), {
        displayName: input.displayName,
      });
      return privateResponse({ ok: true, profile });
    }
    if (!input.password)
      throw new Error("Enter a password of at least 10 characters.");
    const result =
      input.action === "setup"
        ? await setupPrivateProfile({
            token: input.token ?? "",
            displayName: input.displayName ?? "My profile",
            email: input.email,
            password: input.password,
          })
        : await loginPrivateProfile({
            password: input.password,
            email: input.email,
          });
    const response = privateResponse({ ok: true, profile: result.profile });
    response.cookies.set(COOKIE, result.sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    return failure(error);
  }
}

export async function privateProfileGET(request: NextRequest) {
  if (!privateRequestAllowed(request))
    return privateResponse({ error: "Request is not allowed." }, 403);
  try {
    const session = await readPrivateProfile(token(request));
    return session
      ? privateResponse({ profile: session.profile })
      : privateResponse({ error: "Authentication required." }, 401);
  } catch {
    return privateResponse(
      { error: "Your private profile could not be loaded." },
      503,
    );
  }
}

export async function privateImportPOST(request: NextRequest) {
  if (!privateRequestAllowed(request, true))
    return privateResponse({ error: "Request origin is not allowed." }, 403);
  try {
    if (!(await readPrivateProfile(token(request))))
      return privateResponse({ error: "Authentication required." }, 401);
    const input = z
      .object({
        transactions: z.array(z.unknown()).min(1).max(1000),
        inputHash: z.string().regex(/^[a-f0-9]{64}$/),
        fileName: z.string().min(1).max(255),
      })
      .parse(await body(request, 3000000));
    const result = await commitPrivateImport(
      token(request),
      input.transactions as WorkspaceData["transactions"],
      input.inputHash,
      input.fileName,
    );
    return privateResponse({
      ok: true,
      count: result.imported,
      imported: result.imported,
      duplicates: result.duplicates,
    });
  } catch (error) {
    return failure(error);
  }
}
