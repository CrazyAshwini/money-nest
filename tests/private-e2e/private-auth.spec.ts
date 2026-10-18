import { randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createDemoData } from "../../src/lib/seed";
import {
  privateProfileDirectory,
  provisionPrivateProfile,
} from "../../src/lib/private-profile-store";

const baseURL = "http://127.0.0.1:3001";
const cookieName = "finance-os-private-session";
const owner = randomUUID();
const profileName = "Synthetic private auth tester";
const email = `private.auth.${randomBytes(5).toString("hex")}@example.test`;
const password = randomBytes(18).toString("base64url");
let setupToken = "";
let directory = "";

function guardedDirectory() {
  const root = path.resolve(process.env.FINANCE_PRIVATE_DIR ?? "");
  const relative = path.relative(path.resolve(tmpdir()), root);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(root).startsWith("finance-os-private-e2e-")
  )
    throw new Error(
      "Private auth tests require an isolated temporary directory.",
    );
  return root;
}

async function assertNoPersistedCredentials(page: Page) {
  // Boolean assertions avoid printing credentials or a token on failure.
  expect(
    await page.evaluate(
      (values) => {
        const stored = JSON.stringify({ ...localStorage, ...sessionStorage });
        return values.every(
          (value) => !stored.includes(value) && !location.href.includes(value),
        );
      },
      [profileName, email, password, setupToken, owner],
    ),
  ).toBe(true);
}

test.beforeAll(async () => {
  directory = guardedDirectory();
  expect(privateProfileDirectory()).toBe(directory);
  // Provision only a generated synthetic fixture. The browser never edits it.
  const workspace = createDemoData();
  for (const rows of Object.values(workspace))
    for (const record of rows) record.userId = owner;
  setupToken = (await provisionPrivateProfile(workspace, profileName))
    .setupToken;
});

test.afterAll(async () => {
  if (directory && guardedDirectory() === directory)
    await rm(directory, { recursive: true, force: true });
  setupToken = "";
});

test("private setup, session protection, OTP isolation, logout and password login remain functional", async ({
  page,
  browser,
  request,
}) => {
  let financeWrites = 0;
  let cloudCalls = 0;
  let initialWorkspace: Record<string, unknown>;
  await page.route("**/*", async (route) => {
    const outgoing = route.request();
    const url = new URL(outgoing.url());
    if (url.origin !== baseURL) {
      cloudCalls++;
      return route.abort();
    }
    if (
      url.pathname.startsWith("/api/") &&
      !["GET", "HEAD"].includes(outgoing.method()) &&
      !["/api/profile", "/api/auth"].includes(url.pathname)
    ) {
      financeWrites++;
      return route.abort();
    }
    return route.continue();
  });

  await test.step("signed-out requests reveal no profile or financial workspace", async () => {
    const response = await request.get("/api/workspace");
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const result = await response.json();
    expect(result).toMatchObject({
      authenticated: false,
      backend: "local",
      needsSetup: true,
    });
    expect(result).not.toHaveProperty("workspace");
    expect(result).not.toHaveProperty("profile");
    expect(result).not.toHaveProperty("userId");
    expect((await request.get("/api/profile")).status()).toBe(401);
  });

  await test.step("setup consumes the fragment and establishes an HttpOnly private session", async () => {
    await page.goto("/profile/setup");
    await expect(
      page.getByRole("heading", { name: "Create your profile", exact: true }),
    ).toBeVisible();
    await page.evaluate((token) => {
      history.replaceState(null, "", `/profile/setup#token=${token}`);
    }, setupToken);
    await page.reload().catch(() => {
      throw new Error("Synthetic setup could not be loaded.");
    });
    await expect.poll(() => new URL(page.url()).hash === "").toBe(true);
    await page.getByLabel("Profile name", { exact: true }).fill(profileName);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Create profile", exact: true })
      .click();
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
    await expect(page.locator(".user-card")).toContainText(profileName);
    const session = (await page.context().cookies(baseURL)).find(
      (cookie) => cookie.name === cookieName,
    );
    expect(Boolean(session)).toBe(true);
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Strict");
    expect(
      await page.evaluate((name) => document.cookie.includes(name), cookieName),
    ).toBe(false);
    const loaded = await (await page.request.get("/api/workspace")).json();
    expect(loaded).toMatchObject({
      authenticated: true,
      backend: "local",
      userId: owner,
    });
    initialWorkspace = loaded.workspace;
    await assertNoPersistedCredentials(page);
    const reused = await request.post("/api/profile", {
      headers: { Origin: baseURL },
      data: {
        action: "setup",
        token: setupToken,
        displayName: profileName,
        email,
        password,
      },
    });
    expect(reused.ok()).toBe(false);
  });

  await test.step("origin checks and tampered sessions cannot access the profile", async () => {
    for (const endpoint of ["/api/profile", "/api/auth"]) {
      expect(
        (
          await page.request.post(endpoint, { data: { action: "logout" } })
        ).status(),
      ).toBe(403);
      expect(
        (
          await page.request.post(endpoint, {
            headers: { Origin: "https://unrelated.example.test" },
            data: { action: "logout" },
          })
        ).status(),
      ).toBe(403);
    }
    const tampered = await browser.newContext({ baseURL });
    try {
      await tampered.addCookies([
        { name: cookieName, value: "0".repeat(64), url: baseURL },
      ]);
      expect((await tampered.request.get("/api/workspace")).status()).toBe(401);
      expect((await tampered.request.get("/api/profile")).status()).toBe(401);
    } finally {
      await tampered.close();
    }
    expect((await page.request.get("/api/workspace")).status()).toBe(200);
  });

  await test.step("cloud OTP actions remain rejected by private authentication", async () => {
    for (const action of ["verify-signup-otp", "resend-signup-otp"]) {
      const response = await page.request.post("/api/auth", {
        headers: { Origin: baseURL },
        data: { action, email, token: "001234" },
      });
      expect(response.status()).toBe(400);
      expect(Object.keys(await response.json())).toEqual(["error"]);
    }
    const loaded = await (await page.request.get("/api/workspace")).json();
    expect(loaded).toMatchObject({
      authenticated: true,
      backend: "local",
      userId: owner,
    });
    expect(loaded.workspace).toEqual(initialWorkspace);
  });

  await test.step("logout revokes the previous private session", async () => {
    const previous = (await page.context().cookies(baseURL)).find(
      (cookie) => cookie.name === cookieName,
    );
    await page.goto("/profile");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/login`);
    await expect(
      page.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();
    expect((await page.request.get("/api/workspace")).status()).toBe(401);
    expect((await page.request.get("/api/profile")).status()).toBe(401);
    const revoked = await browser.newContext({ baseURL });
    try {
      if (!previous)
        throw new Error("Synthetic private session was not established.");
      await revoked.addCookies([previous]);
      expect((await revoked.request.get("/api/workspace")).status()).toBe(401);
    } finally {
      await revoked.close();
    }
    await assertNoPersistedCredentials(page);
  });

  await test.step("existing email and password login restores private access without finance writes", async () => {
    const wrong = await page.request.post("/api/profile", {
      headers: { Origin: baseURL },
      data: {
        action: "login",
        email,
        password: "Incorrect-synthetic-password",
      },
    });
    expect(wrong.ok()).toBe(false);
    expect(Object.keys(await wrong.json())).toEqual(["error"]);
    expect((await page.request.get("/api/workspace")).status()).toBe(401);
    await page.getByLabel("Email", { exact: true }).fill(email.toUpperCase());
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
    await expect(page.locator(".user-card")).toContainText(profileName);
    const loaded = await (await page.request.get("/api/workspace")).json();
    expect(loaded).toMatchObject({
      authenticated: true,
      backend: "local",
      userId: owner,
    });
    const financialEntries = (workspace: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(workspace).filter(([key]) => key !== "auditEvents"),
      );
    expect(financialEntries(loaded.workspace)).toEqual(
      financialEntries(initialWorkspace),
    );
    await assertNoPersistedCredentials(page);
    expect(financeWrites).toBe(0);
    expect(cloudCalls).toBe(0);
  });
});
