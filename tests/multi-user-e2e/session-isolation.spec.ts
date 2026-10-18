import { expect, test, type Page, type Route } from "@playwright/test";
import type { WorkspaceData } from "../../src/lib/types";

// These requests exercise the real client and routing with synthetic sessions.
// Database/API access control is tested separately against real local services.
const users = {
  A: {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Alex Synthetic",
    email: "alex.multi-user@example.test",
    marker: "SYNTHETIC_A_ONLY_RECORD",
    accountId: "20000000-0000-4000-8000-000000000001",
  },
  B: {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Blair Synthetic",
    email: "blair.multi-user@example.test",
    marker: "SYNTHETIC_B_ONLY_RECORD",
    accountId: "20000000-0000-4000-8000-000000000002",
  },
};
type User = keyof typeof users;
const password = "Synthetic-multi-user-password-42";

function emptyWorkspace(): WorkspaceData {
  return {
    accounts: [],
    snapshots: [],
    transactions: [],
    bills: [],
    allocations: [],
    fixedDeposits: [],
    loans: [],
    emis: [],
    emiAllocations: [],
    groups: [],
    shares: [],
    settlements: [],
    reminders: [],
    auditEvents: [],
  };
}

function workspaceFor(user: User): WorkspaceData {
  const identity = users[user];
  return {
    ...emptyWorkspace(),
    accounts: [
      {
        id: identity.accountId,
        userId: identity.id,
        name: `${user} synthetic bank`,
        institution: "Synthetic Bank",
        kind: "bank",
        active: true,
        maskedSuffix: user === "A" ? "1111" : "2222",
      },
    ],
    transactions: [
      {
        id: `30000000-0000-4000-8000-00000000000${user === "A" ? "1" : "2"}`,
        userId: identity.id,
        amount: user === "A" ? "123.45" : "67.89",
        currency: "INR",
        kind: "expense",
        status: "posted",
        occurredOn: "2026-10-17",
        description: identity.marker,
        fromAccountId: identity.accountId,
        toAccountId: null,
        category: "Food",
      },
    ],
  };
}

async function mockSessions(
  page: Page,
  options: {
    initialUser?: User;
    emptyB?: boolean;
    signupEnabled?: boolean;
    allowSingleASave?: boolean;
  } = {},
) {
  const state = {
    user: options.initialUser as User | undefined,
    workspaceReads: 0,
    unexpectedWrites: [] as string[],
    authActions: [] as string[],
    savedBy: [] as string[],
    holdNextRead: false,
    heldReads: 0,
    completedHeldReads: 0,
    releaseHeld: () => {},
  };
  const workspaces = {
    A: workspaceFor("A"),
    B: options.emptyB ? emptyWorkspace() : workspaceFor("B"),
  };
  function workspaceReply() {
    const user = state.user;
    return {
      status: user ? 200 : 401,
      json: {
        configured: true,
        authenticated: Boolean(user),
        backend: "supabase",
        signupEnabled: options.signupEnabled !== false,
        ...(user
          ? {
              userId: users[user].id,
              profile: {
                id: users[user].id,
                displayName: users[user].name,
                email: users[user].email,
                currency: "INR",
                timezone: "Asia/Kolkata",
                createdAt: "2026-10-01T00:00:00Z",
              },
              workspace: structuredClone(workspaces[user]),
            }
          : {}),
      },
    };
  }
  await page.clock.install({ time: new Date("2026-10-18T06:30:00Z") });
  await page.route("**/*", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(test.info().project.use.baseURL!).origin)
      return route.abort();
    if (url.pathname === "/api/workspace" && request.method() === "GET") {
      state.workspaceReads++;
      const reply = workspaceReply();
      if (state.holdNextRead) {
        state.holdNextRead = false;
        state.heldReads++;
        await new Promise<void>((resolve) => {
          state.releaseHeld = resolve;
        });
        // An AbortController may already have cancelled this stale request.
        await route.fulfill(reply).catch(() => {});
        state.completedHeldReads++;
        return;
      }
      return route.fulfill(reply);
    }
    if (
      url.pathname === "/api/workspace" &&
      request.method() === "POST" &&
      options.allowSingleASave &&
      state.user === "A" &&
      state.savedBy.length === 0
    ) {
      const body = request.postDataJSON();
      expect(body.collection).toBe("transactions");
      expect(body.record.userId).toBe(users.A.id);
      state.savedBy.push(body.record.userId);
      workspaces.A.transactions.push(body.record);
      return route.fulfill({ status: 200, json: { record: body.record } });
    }
    if (url.pathname === "/api/auth" && request.method() === "POST") {
      const body = request.postDataJSON();
      state.authActions.push(body.action);
      if (body.action === "logout") {
        state.user = undefined;
        return route.fulfill({ status: 200, json: { ok: true } });
      }
      if (body.action === "signup") {
        expect(body.email).toBe(users.B.email);
        return route.fulfill({
          status: 200,
          json: { ok: true, needsEmailConfirmation: true, retryAfter: 0 },
        });
      }
      if (body.action === "verify-signup-otp") {
        expect(body.email).toBe(users.B.email);
        expect(body.token).toBe("001234");
        state.user = "B";
        return route.fulfill({
          status: 200,
          json: { ok: true, authenticated: true },
        });
      }
      if (body.action === "login") {
        state.user = body.email === users.A.email ? "A" : "B";
        return route.fulfill({ status: 200, json: { ok: true } });
      }
      if (body.action === "reset")
        return route.fulfill({ status: 200, json: { ok: true } });
    }
    if (url.pathname === "/api/ai/settings")
      return route.fulfill({
        status: 200,
        json: { available: false, configured: false, ownerManaged: true },
      });
    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "HEAD"].includes(request.method()))
        state.unexpectedWrites.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({
        status: 403,
        json: { error: "Unmocked synthetic operation denied" },
      });
    }
    return route.continue();
  });
  return state;
}

async function expectOnlyUser(page: Page, user: User) {
  await expect(page.locator(".user-card")).toContainText(users[user].name);
  await expect(page.locator("body")).not.toContainText(
    users[user === "A" ? "B" : "A"].marker,
  );
  expect(
    await page.evaluate(
      (markers) => {
        const stored = JSON.stringify({ ...localStorage, ...sessionStorage });
        return markers.every((marker) => !stored.includes(marker));
      },
      [users.A.marker, users.B.marker, password, "001234"],
    ),
  ).toBe(true);
}

async function signOut(page: Page) {
  await page.locator('.desktop-sidebar a.user-card[href="/profile"]').click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", {
      name: "Welcome to your workspace",
      exact: true,
    }),
  ).toBeVisible();
}

async function signIn(page: Page, user: User) {
  await page
    .getByLabel("Email address", { exact: true })
    .fill(users[user].email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expectOnlyUser(page, user);
}

test("A logout then B six-digit signup opens an empty private workspace, including reload and Back", async ({
  page,
}) => {
  const state = await mockSessions(page, { initialUser: "A", emptyB: true });
  await page.goto("/transactions?period=all");
  await expect(page.getByText(users.A.marker, { exact: true })).toBeVisible();
  await signOut(page);
  await expect(page.locator("body")).not.toContainText(users.A.marker);
  await page
    .getByRole("button", { name: "New here? Create an account", exact: true })
    .click();
  await page.getByLabel("Email address", { exact: true }).fill(users.B.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Verify your email", exact: true }),
  ).toBeVisible();
  expect(state.user).toBeUndefined();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await page.getByLabel("Verification code", { exact: true }).fill("001234");
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expectOnlyUser(page, "B");
  await expect(
    page.getByText("No activity this month", { exact: true }),
  ).toBeVisible();
  await page.locator('.desktop-sidebar a[href="/transactions"]').click();
  await expect(
    page.getByRole("heading", {
      name: "No transactions here yet",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expectOnlyUser(page, "B");
  await page.goBack();
  await expectOnlyUser(page, "B");
  // Reach the ledger entry that was originally opened while A was signed in.
  await page.goBack();
  await expectOnlyUser(page, "B");
  await expect(
    page.getByRole("heading", {
      name: "No transactions here yet",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(users.A.marker);
  expect(state.authActions).toEqual(["logout", "signup", "verify-signup-otp"]);
  expect(state.unexpectedWrites).toEqual([]);
});

test("existing A and B keep independent records through same-browser logout/login and refresh", async ({
  page,
}) => {
  const state = await mockSessions(page, { initialUser: "A" });
  await page.goto("/transactions?period=all");
  await expect(page.getByText(users.A.marker, { exact: true })).toBeVisible();
  await signOut(page);
  await signIn(page, "B");
  await page.locator('.desktop-sidebar a[href="/transactions"]').click();
  await expect(page.getByText(users.B.marker, { exact: true })).toBeVisible();
  await expectOnlyUser(page, "B");
  await page.reload();
  await expect(page.getByText(users.B.marker, { exact: true })).toBeVisible();
  await expectOnlyUser(page, "B");
  await signOut(page);
  await signIn(page, "A");
  await page.locator('.desktop-sidebar a[href="/transactions"]').click();
  await expect(page.getByText(users.A.marker, { exact: true })).toBeVisible();
  await expectOnlyUser(page, "A");
  expect(state.unexpectedWrites).toEqual([]);
});

test("focus refresh switches identity and discards the preceding user's unsaved editor", async ({
  page,
}) => {
  const state = await mockSessions(page, { initialUser: "A", emptyB: true });
  await page.goto("/dashboard");
  await expectOnlyUser(page, "A");
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const editor = page.locator(".transaction-modal");
  await editor
    .getByLabel("Description", { exact: true })
    .fill("SYNTHETIC_A_UNSAVED_DRAFT");
  state.user = "B";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expectOnlyUser(page, "B");
  await expect(editor).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.locator("body")).not.toContainText(users.A.marker);
  expect(state.unexpectedWrites).toEqual([]);
});

test("an older delayed A refresh cannot replace a newer B session", async ({
  page,
}) => {
  const state = await mockSessions(page, { initialUser: "A" });
  await page.goto("/transactions?period=all");
  await expect(page.getByText(users.A.marker, { exact: true })).toBeVisible();
  state.holdNextRead = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => state.heldReads).toBe(1);
  state.user = "B";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expectOnlyUser(page, "B");
  await expect(page.getByText(users.B.marker, { exact: true })).toBeVisible();
  state.releaseHeld();
  await expect.poll(() => state.completedHeldReads).toBe(1);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expectOnlyUser(page, "B");
  await expect(page.getByText(users.B.marker, { exact: true })).toBeVisible();
  await expect(page.getByText(users.A.marker, { exact: true })).toHaveCount(0);
  expect(state.unexpectedWrites).toEqual([]);
});

test("A's completed save and delayed refresh do not expose data or a stale error in B's workspace", async ({
  page,
}) => {
  const state = await mockSessions(page, {
    initialUser: "A",
    emptyB: true,
    allowSingleASave: true,
  });
  await page.goto("/dashboard");
  await expectOnlyUser(page, "A");
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const editor = page.locator(".transaction-modal");
  await editor.getByLabel("Amount · ₹", { exact: true }).fill("12.34");
  await editor
    .getByLabel("Description", { exact: true })
    .fill("SYNTHETIC_A_DELAYED_SAVE");
  await editor.getByLabel("Date", { exact: true }).fill("2026-10-18");
  await editor
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption(users.A.accountId);
  state.holdNextRead = true;
  await editor
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect.poll(() => state.heldReads).toBe(1);
  state.user = "B";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expectOnlyUser(page, "B");
  await expect(editor).toHaveCount(0);
  state.releaseHeld();
  await expect.poll(() => state.completedHeldReads).toBe(1);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expectOnlyUser(page, "B");
  await expect(page.locator("body")).not.toContainText(
    "SYNTHETIC_A_DELAYED_SAVE",
  );
  // Next's empty route announcer has role=alert independently of app errors.
  await expect(page.locator('.toast[role="alert"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "Your change was saved, but balances could not be refreshed",
  );
  expect(state.savedBy).toEqual([users.A.id]);
  expect(state.unexpectedWrites).toEqual([]);
});

test("B never finds A's account through a copied deep link or ledger filter", async ({
  page,
}) => {
  const state = await mockSessions(page, { initialUser: "B" });
  await page.goto(`/accounts/${users.A.accountId}`);
  await expect(
    page.getByRole("heading", { name: "Account not found", exact: true }),
  ).toBeVisible();
  await expectOnlyUser(page, "B");
  await page.goto(`/transactions?account=${users.A.accountId}&period=all`);
  await expect(
    page.getByRole("heading", {
      name: "No transactions here yet",
      exact: true,
    }),
  ).toBeVisible();
  await expectOnlyUser(page, "B");
  await expect(page.getByText(users.B.marker, { exact: true })).toHaveCount(0);
  expect(state.unexpectedWrites).toEqual([]);
});

for (const signupEnabled of [true, false]) {
  test(`${signupEnabled ? "public" : "restricted"} login retains signup gating and account-neutral recovery`, async ({
    page,
  }) => {
    const state = await mockSessions(page, { signupEnabled });
    await page.goto("/login");
    const signup = page.getByRole("button", {
      name: "New here? Create an account",
      exact: true,
    });
    await expect(signup).toHaveCount(signupEnabled ? 1 : 0);
    await page
      .getByRole("button", { name: "Forgot your password?", exact: true })
      .click();
    await expect(
      page.getByText(
        "We’ll email a secure link if this address has an account.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("owner account");
    await page.getByLabel("Email address", { exact: true }).fill(users.B.email);
    await page
      .getByRole("button", { name: "Send reset link", exact: true })
      .click();
    await expect(
      page.getByText(
        "If this email has an account, a reset link is on its way. Check your inbox and spam folder.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(state.authActions).toEqual(["reset"]);
    expect(state.unexpectedWrites).toEqual([]);
  });
}

test("cloud settings describe the current user's private records without owner-only copy", async ({
  page,
}) => {
  const state = await mockSessions(page, { initialUser: "B" });
  await page.goto("/settings");
  await expect(
    page.getByText(
      "Your private cloud workspace. Only your signed-in account can access its financial records.",
      { exact: true },
    ),
  ).toBeVisible();
  await expectOnlyUser(page, "B");
  expect(state.unexpectedWrites).toEqual([]);
});
