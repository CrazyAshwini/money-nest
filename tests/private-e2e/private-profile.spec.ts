import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDemoData } from "../../src/lib/seed";
import {
  privateProfileDirectory,
  provisionPrivateProfile,
} from "../../src/lib/private-profile-store";
import type { WorkspaceData } from "../../src/lib/types";

const baseURL = "http://127.0.0.1:3001";
const cookieName = "finance-os-private-session";
const owner = randomUUID();
const profileName = `Synthetic tester ${randomBytes(5).toString("hex")}`;
const bankName = `Synthetic private bank ${randomBytes(5).toString("hex")}`;
const email = `synthetic.${randomBytes(5).toString("hex")}@example.test`;
const password = randomBytes(8).toString("base64url").slice(0, 10);
const editedName = `${profileName} updated`;
const transactionName = "Synthetic private lunch";
const transactionNote = "Synthetic optional note preserved while collapsed";
const transactionReference = "SYNTHETIC-COMPACT-REFERENCE";
let setupToken = "";
let testDirectory = "";

function guardedTestDirectory() {
  const root = path.resolve(process.env.FINANCE_PRIVATE_DIR ?? "");
  const relativeRoot = path.relative(path.resolve(tmpdir()), root);
  if (
    relativeRoot.startsWith("..") ||
    path.isAbsolute(relativeRoot) ||
    !path.basename(root).startsWith("finance-os-private-e2e-")
  )
    throw new Error("Refusing to use a non-test private profile directory.");
  return root;
}

function syntheticWorkspace(): WorkspaceData {
  const workspace = createDemoData();
  for (const rows of Object.values(workspace))
    for (const record of rows) record.userId = owner;
  workspace.accounts[0].name = bankName;
  return workspace;
}

async function post(
  request: APIRequestContext,
  endpoint: string,
  data: unknown,
) {
  return request.post(endpoint, {
    headers: { Origin: baseURL },
    data,
  });
}

async function assertNoPrivateBrowserStorage(page: Page) {
  const storage = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
    ),
  );
  const serialized = JSON.stringify(storage);
  // Boolean assertions avoid accidentally printing a secret on failure.
  expect(serialized.includes(profileName)).toBe(false);
  expect(serialized.includes(bankName)).toBe(false);
  expect(serialized.toLowerCase().includes(email)).toBe(false);
  expect(serialized.includes(owner)).toBe(false);
  expect(serialized.includes(password)).toBe(false);
  expect(serialized.includes(setupToken)).toBe(false);
  for (const [key, value] of Object.entries(storage)) {
    expect(key).toBe("finance-os:fictional-demo:v1");
    const demo = JSON.parse(value ?? "{}") as WorkspaceData;
    expect(demo.accounts[0].name).toBe("Meridian Everyday");
  }
}

async function assertNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function staticScripts(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await staticScripts(target)));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(target);
  }
  return files;
}

test.beforeAll(async () => {
  testDirectory = guardedTestDirectory();
  expect(privateProfileDirectory()).toBe(testDirectory);
  const provisioned = await provisionPrivateProfile(
    syntheticWorkspace(),
    profileName,
  );
  setupToken = provisioned.setupToken;
});

test.afterAll(async () => {
  const safeRoot = guardedTestDirectory();
  if (testDirectory && safeRoot === testDirectory)
    await rm(safeRoot, { recursive: true, force: true });
  setupToken = "";
});

test("private profile setup, protected records, persistence, and demo isolation", async ({
  page,
  browser,
  request,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.name));

  await test.step("unauthenticated requests reveal no personal profile or records", async () => {
    const response = await request.get("/api/workspace");
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const data = await response.json();
    expect(data.authenticated).toBe(false);
    expect(data.backend).toBe("local");
    expect(data.exists).toBe(true);
    expect(data.needsSetup).toBe(true);
    expect(data).not.toHaveProperty("workspace");
    expect(data).not.toHaveProperty("profile");
    expect(data).not.toHaveProperty("userId");
    expect(JSON.stringify(data).includes(profileName)).toBe(false);
    expect(JSON.stringify(data).includes(bankName)).toBe(false);
    expect(JSON.stringify(data).toLowerCase().includes(email)).toBe(false);
    const profile = await request.get("/api/profile");
    expect(profile.status()).toBe(401);
    expect(await profile.json()).toEqual({ error: "Authentication required." });
    const foreignHost = await request.get("/api/workspace", {
      headers: { Host: "finance.example.invalid" },
    });
    expect(foreignHost.status()).toBe(403);
    const badSetup = await post(request, "/api/profile", {
      action: "setup",
      token: "0".repeat(64),
      displayName: "Synthetic tester",
      email,
      password,
    });
    expect(badSetup.ok()).toBe(false);
    expect(Object.keys(await badSetup.json())).toEqual(["error"]);
  });

  await test.step("setup consumes a fragment token and creates an HttpOnly session", async () => {
    await page.goto("/profile/setup");
    // Set the token inside the browser, avoiding a token-bearing URL in call logs.
    await page.evaluate((token) => {
      history.replaceState(null, "", `/profile/setup#token=${token}`);
    }, setupToken);
    await page.reload().catch(() => {
      throw new Error("Synthetic profile setup could not be opened.");
    });
    await expect.poll(() => new URL(page.url()).hash === "").toBe(true);
    await page.getByLabel("Profile name", { exact: true }).fill(profileName);
    await page.getByLabel("Email", { exact: true }).fill(email.toUpperCase());
    expect(password.length).toBe(10);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Create profile", exact: true })
      .click();
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
    await expect(page.locator(".user-card")).toContainText(profileName);
    await expect(page.locator(".demo-strip")).toHaveCount(0);
    const cookies = await page.context().cookies(baseURL);
    const session = cookies.find((cookie) => cookie.name === cookieName);
    expect(Boolean(session)).toBe(true);
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Strict");
    expect(
      await page.evaluate((name) => document.cookie.includes(name), cookieName),
    ).toBe(false);
    await assertNoPrivateBrowserStorage(page);
    const reused = await post(request, "/api/profile", {
      action: "setup",
      token: setupToken,
      displayName: profileName,
      email,
      password,
    });
    expect(reused.ok()).toBe(false);
    expect(Object.keys(await reused.json())).toEqual(["error"]);
  });

  await test.step("origins, sessions, and record ownership protect mutations", async () => {
    for (const endpoint of ["/api/workspace", "/api/profile"]) {
      const missingOrigin = await page.request.post(endpoint, { data: {} });
      expect(missingOrigin.status()).toBe(403);
      const crossOrigin = await page.request.post(endpoint, {
        headers: { Origin: "https://example.invalid" },
        data: {},
      });
      expect(crossOrigin.status()).toBe(403);
    }
    const loaded = await (await page.request.get("/api/workspace")).json();
    const workspace = loaded.workspace as WorkspaceData;
    expect(loaded.userId).toBe(owner);
    expect(loaded.profile.email).toBe(email);
    expect(workspace.accounts[0].name).toBe(bankName);
    const foreign = await post(page.request, "/api/workspace", {
      collection: "accounts",
      record: {
        ...workspace.accounts[0],
        userId: randomUUID(),
        name: "Rejected edit",
      },
    });
    expect([400, 403]).toContain(foreign.status());
    const malformed = await post(page.request, "/api/workspace", {
      collection: "accounts",
      record: { ...workspace.accounts[0], maskedSuffix: "123456789012" },
    });
    expect([400, 403]).toContain(malformed.status());
    const after = await (await page.request.get("/api/workspace")).json();
    expect(after.workspace.accounts[0].name).toBe(bankName);
    const tampered = await browser.newContext({ baseURL });
    try {
      await tampered.addCookies([
        { name: cookieName, value: "0".repeat(64), url: baseURL },
      ]);
      expect((await tampered.request.get("/api/workspace")).status()).toBe(401);
    } finally {
      await tampered.close();
    }
  });

  await test.step("profile and transaction edits persist across reloads", async () => {
    await page.goto("/profile");
    await expect(
      page.getByRole("link", { name: email, exact: true }),
    ).toHaveAttribute("href", `mailto:${email}`);
    await page.getByLabel("Profile name", { exact: true }).fill(editedName);
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(page.locator(".user-card")).toContainText(editedName);
    await page.reload();
    await expect(page.getByLabel("Profile name", { exact: true })).toHaveValue(
      editedName,
    );
    await expect(
      page.getByRole("link", { name: email, exact: true }),
    ).toHaveAttribute("href", `mailto:${email}`);
    await page.goto("/transactions");
    await page
      .getByRole("button", { name: "Add transaction", exact: true })
      .click();
    let dialog = page.locator(".transaction-modal");
    const moreDetails = dialog
      .locator("details")
      .filter({ hasText: "More details" });
    await expect(moreDetails).not.toHaveAttribute("open");
    await expect(
      dialog.getByRole("combobox", { name: "From account", exact: true }),
    ).toBeVisible();
    await expect(dialog.locator('select[name="toAccountId"]')).toHaveCount(1);
    await expect(dialog.locator('select[name="toAccountId"]')).toBeHidden();
    await expect(dialog.getByLabel("Notes", { exact: true })).toBeHidden();
    await expect(
      dialog.getByLabel("Bank reference", { exact: true }),
    ).toBeHidden();
    await expect(dialog.locator('select[name="status"]')).toHaveCount(1);
    await expect(dialog.locator('select[name="status"]')).toBeHidden();
    await expect(
      dialog.getByLabel("Transaction type", { exact: true }),
    ).toBeHidden();
    await expect(
      dialog.getByRole("textbox", { name: "Description", exact: true }),
    ).toHaveJSProperty("tagName", "TEXTAREA");
    await expect(
      dialog.getByRole("button", { name: "Take Photo", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Upload Image", exact: true }),
    ).toBeVisible();
    await mkdir(path.resolve("artifacts"), { recursive: true });
    await dialog.screenshot({
      path: path.resolve("artifacts/transaction-reference-desktop.png"),
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await assertNoPageOverflow(page);
    await dialog.screenshot({
      path: path.resolve("artifacts/transaction-reference-mobile.png"),
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await moreDetails.locator("summary").click();
    const transactionType = dialog.getByRole("combobox", {
      name: "Transaction type",
      exact: true,
    });
    await transactionType.selectOption("income");
    await moreDetails.locator("summary").click();
    await expect(
      dialog.getByRole("combobox", { name: "To account", exact: true }),
    ).toBeVisible();
    await expect(dialog.locator('select[name="fromAccountId"]')).toHaveCount(1);
    await expect(dialog.locator('select[name="fromAccountId"]')).toBeHidden();
    await moreDetails.locator("summary").click();
    await transactionType.selectOption("transfer");
    await moreDetails.locator("summary").click();
    await expect(
      dialog.getByRole("combobox", { name: "From account", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: "To account", exact: true }),
    ).toBeVisible();
    await moreDetails.locator("summary").click();
    await transactionType.selectOption("expense");
    await dialog
      .getByRole("textbox", { name: "Description", exact: true })
      .fill(transactionName);
    await dialog.getByLabel("Amount · ₹", { exact: true }).fill("12.34");
    await dialog.getByLabel("Date", { exact: true }).fill("2026-10-09");
    await dialog
      .getByRole("combobox", { name: "From account", exact: true })
      .selectOption({ label: bankName });
    await dialog.getByLabel("Notes", { exact: true }).fill(transactionNote);
    await dialog
      .getByLabel("Bank reference", { exact: true })
      .fill(transactionReference);
    await moreDetails.locator("summary").click();
    await expect(moreDetails).not.toHaveAttribute("open");
    await dialog
      .getByRole("button", { name: "Save transaction", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Search transactions", exact: true })
      .fill(transactionName);
    await page
      .getByRole("button", { name: `Edit ${transactionName}`, exact: true })
      .click();
    dialog = page.locator(".transaction-modal");
    await expect(dialog.getByLabel("Notes", { exact: true })).toBeHidden();
    await dialog.locator("summary", { hasText: "More details" }).click();
    await expect(dialog.getByLabel("Notes", { exact: true })).toHaveValue(
      transactionNote,
    );
    await expect(
      dialog.getByLabel("Bank reference", { exact: true }),
    ).toHaveValue(transactionReference);
    await dialog.locator("summary", { hasText: "More details" }).click();
    await dialog.getByLabel("Amount · ₹", { exact: true }).fill("15.67");
    await dialog
      .getByRole("button", { name: "Save transaction", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await page
      .getByRole("textbox", { name: "Search transactions", exact: true })
      .fill(transactionName);
    await expect(
      page.getByRole("button", { name: transactionName, exact: true }),
    ).toHaveCount(1);
    const loaded = await (await page.request.get("/api/workspace")).json();
    expect(
      loaded.workspace.transactions
        .filter(
          (row: { description: string }) => row.description === transactionName,
        )
        .map((row: { amount: string }) => row.amount),
    ).toEqual(["15.67"]);
    expect(
      loaded.workspace.transactions.find(
        (row: { description: string }) => row.description === transactionName,
      ),
    ).toMatchObject({
      notes: transactionNote,
      externalReference: transactionReference,
    });
    await assertNoPrivateBrowserStorage(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/dashboard");
    await expect(page.locator(".stats-grid .stat")).toHaveCount(4);
    await assertNoPageOverflow(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await test.step("a lost transaction response shows an error and retry preserves one expense", async () => {
    await page.goto("/transactions");
    const before = (await (await page.request.get("/api/workspace")).json())
      .workspace as WorkspaceData;
    await page
      .getByRole("button", { name: "Add transaction", exact: true })
      .click();
    const dialog = page.locator(".transaction-modal");
    await dialog
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Synthetic retry-safe expense");
    await dialog.getByLabel("Amount · ₹", { exact: true }).fill("12.34");
    await dialog.getByLabel("Date", { exact: true }).fill("2026-10-09");
    await dialog
      .getByRole("combobox", { name: "From account", exact: true })
      .selectOption({ label: bankName });
    const ids: string[] = [];
    await page.route("**/api/workspace", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON();
      ids.push(body.record.id);
      if (ids.length === 1) {
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog
      .getByRole("button", { name: "Save transaction", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: "Description", exact: true }),
    ).toHaveValue("Synthetic retry-safe expense");
    await dialog
      .getByRole("button", { name: "Save transaction", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    const after = (await (await page.request.get("/api/workspace")).json())
      .workspace as WorkspaceData;
    expect(after.transactions).toHaveLength(before.transactions.length + 1);
    expect(
      after.transactions.filter(
        (row) => row.description === "Synthetic retry-safe expense",
      ),
    ).toHaveLength(1);
    await page.unroute("**/api/workspace");
  });

  await test.step("logout revokes access and the password unlocks only the private workspace", async () => {
    await page.goto("/settings");
    await page.route("**/api/auth", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Synthetic connection error. Please retry.",
            }),
          })
        : route.continue(),
    );
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.locator('.error[role="alert"]')).toContainText(
      "Sign out failed. Please retry.",
    );
    await expect(page).toHaveURL(`${baseURL}/settings`);
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeEnabled();
    await page.unroute("**/api/auth");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/login`);
    const lockedWorkspace = await page.request.get("/api/workspace");
    expect(lockedWorkspace.status()).toBe(401);
    expect(
      JSON.stringify(await lockedWorkspace.json())
        .toLowerCase()
        .includes(email),
    ).toBe(false);
    const wrongPassword = await post(page.request, "/api/profile", {
      action: "login",
      email,
      password: "incorrect synthetic password",
    });
    expect(wrongPassword.ok()).toBe(false);
    const genericError = await wrongPassword.json();
    expect(Object.keys(genericError)).toEqual(["error"]);
    expect(JSON.stringify(genericError).toLowerCase().includes(email)).toBe(
      false,
    );
    for (const attemptedEmail of ["other.synthetic@example.test", undefined]) {
      const wrongEmail = await post(page.request, "/api/profile", {
        action: "login",
        email: attemptedEmail,
        password,
      });
      expect(wrongEmail.ok()).toBe(false);
      expect(await wrongEmail.json()).toEqual(genericError);
      expect((await page.request.get("/api/workspace")).status()).toBe(401);
    }
    await page.getByLabel("Email", { exact: true }).fill(email.toUpperCase());
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
    await expect(page.locator(".user-card")).toContainText(editedName);
    await assertNoPrivateBrowserStorage(page);
  });

  await test.step("fictional demo and shipped browser scripts contain no private profile", async () => {
    const demo = await browser.newContext({ baseURL });
    try {
      const demoPage = await demo.newPage();
      await demoPage.addInitScript(() =>
        sessionStorage.setItem("finance-os:mode", "demo"),
      );
      await demoPage.goto("/dashboard");
      await expect(demoPage.locator(".demo-strip")).toContainText(
        "Fictional data",
      );
      await expect(demoPage.locator(".user-card")).not.toContainText(
        profileName,
      );
      await assertNoPrivateBrowserStorage(demoPage);
      const unauthenticated = await demo.request.get("/api/workspace");
      expect(unauthenticated.status()).toBe(401);
    } finally {
      await demo.close();
    }
    const envelope = await readFile(
      path.join(testDirectory, "profile.enc.json"),
      "utf8",
    );
    expect(envelope.includes(profileName)).toBe(false);
    expect(envelope.includes(bankName)).toBe(false);
    expect(envelope.toLowerCase().includes(email)).toBe(false);
    expect(envelope.includes(password)).toBe(false);
    expect(envelope.includes(setupToken)).toBe(false);
    const scripts = await staticScripts(path.resolve(".next/static"));
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      const source = await readFile(script, "utf8");
      expect(source.includes(profileName)).toBe(false);
      expect(source.includes(bankName)).toBe(false);
      expect(source.toLowerCase().includes(email)).toBe(false);
    }
  });
  expect(browserErrors).toEqual([]);
});
