import { expect, test, type Page, type Route } from "@playwright/test";
import { cloneDemoData } from "../../src/lib/seed";
import type { Transaction, WorkspaceData } from "../../src/lib/types";

const owner = "11000000-0000-4000-8000-000000000001";
const otherOwner = "11000000-0000-4000-8000-000000000002";
const bankId = "22000000-0000-4000-8000-000000000001";
const transactionId = "33000000-0000-4000-8000-000000000001";
const originalVersion = "2026-10-31T00:00:00.000Z";
const changedVersion = "2026-10-31T00:00:01.000Z";
type Mutation = {
  collection: string;
  record?: Transaction;
  id?: string;
  expectedUpdatedAt?: string | null;
};

async function mockWorkspace(page: Page) {
  const workspace = Object.fromEntries(
    Object.keys(cloneDemoData()).map((key) => [key, []]),
  ) as unknown as WorkspaceData;
  workspace.accounts = [
    {
      id: bankId,
      userId: owner,
      updatedAt: originalVersion,
      name: "Synthetic conflict bank",
      institution: "Synthetic bank",
      kind: "bank",
      maskedSuffix: "",
      active: true,
      openingBalance: "1000.00",
      openingBalanceDate: "2026-10-01",
    },
  ];
  workspace.transactions = [
    {
      id: transactionId,
      userId: owner,
      updatedAt: originalVersion,
      amount: "50.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-20",
      description: "Synthetic original payment",
      fromAccountId: bankId,
      toAccountId: null,
      category: "Other",
      merchant: null,
      sourceSystem: "manual",
    },
  ];
  const state = {
    workspace,
    userId: owner,
    profileName: "Alpha tester",
    backend: "supabase" as "supabase" | "local",
    reads: 0,
    mutations: [] as Mutation[],
    beforeMutation: undefined as
      ((route: Route, body: Mutation) => Promise<void>) | undefined,
  };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL!).origin)
      return route.abort();
    if (url.pathname === "/api/workspace") {
      if (route.request().method() === "GET") {
        state.reads++;
        return route.fulfill({
          status: 200,
          json: {
            configured: true,
            authenticated: true,
            backend: state.backend,
            userId: state.userId,
            profile: { displayName: state.profileName },
            workspace: state.workspace,
          },
        });
      }
      const body = route.request().postDataJSON() as Mutation;
      state.mutations.push(body);
      if (state.beforeMutation) return state.beforeMutation(route, body);
      const current = state.workspace.transactions.find(
        (row) => row.id === (body.record?.id ?? body.id),
      );
      if (current && body.expectedUpdatedAt !== current.updatedAt)
        return route.fulfill({
          status: 409,
          json: {
            code: "conflict",
            error: "This record changed on another device.",
          },
        });
      if (route.request().method() === "DELETE") {
        state.workspace.transactions = state.workspace.transactions.filter(
          (row) => row.id !== body.id,
        );
      } else if (body.record) {
        const saved = { ...body.record, updatedAt: "2026-10-31T00:00:02.000Z" };
        state.workspace.transactions = [
          ...state.workspace.transactions.filter((row) => row.id !== saved.id),
          saved,
        ];
      }
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    if (url.pathname === "/api/ai/settings")
      return route.fulfill({
        status: 200,
        json: { available: true, configured: false, ownerManaged: true },
      });
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  return state;
}

async function openPayment(page: Page) {
  await page.goto("/transactions?period=all");
  await page
    .getByRole("button", {
      name: "View transaction: Synthetic original payment",
      exact: true,
    })
    .click();
}

async function reloadInBackground(page: Page, reads: () => number) {
  const previous = reads();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(reads).toBeGreaterThan(previous);
}

test("an open draft keeps its original version through refresh and reloads after a conflict", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await openPayment(page);
  await page
    .getByRole("button", { name: "Edit transaction", exact: true })
    .click();
  const editor = page.locator(".transaction-modal");
  await editor
    .locator('textarea[name="description"]')
    .fill("Synthetic stale draft");
  state.workspace.transactions[0] = {
    ...state.workspace.transactions[0],
    description: "Synthetic concurrent edit",
    updatedAt: changedVersion,
  };
  await reloadInBackground(page, () => state.reads);
  await expect(
    page.locator(`[data-transaction-id="${transactionId}"]:visible`),
  ).toContainText("Synthetic concurrent edit");
  await expect(editor.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic stale draft",
  );
  const beforeConflict = state.reads;
  await editor.getByRole("button", { name: /^Save / }).click();
  await expect(page.locator(".toast[role=alert]")).toContainText(
    "Changed on another device",
  );
  await expect.poll(() => state.reads).toBeGreaterThan(beforeConflict);
  expect(state.mutations).toHaveLength(1);
  expect(state.mutations[0].expectedUpdatedAt).toBe(originalVersion);
  expect(state.workspace.transactions[0].description).toBe(
    "Synthetic concurrent edit",
  );
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();

  await page
    .getByRole("button", {
      name: "View transaction: Synthetic concurrent edit",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Edit transaction", exact: true })
    .click();
  await expect(editor.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic concurrent edit",
  );
  await editor
    .locator('textarea[name="description"]')
    .fill("Synthetic reviewed retry");
  await editor.getByRole("button", { name: /^Save / }).click();
  await expect(editor).toHaveCount(0);
  expect(state.mutations).toHaveLength(2);
  expect(state.mutations[1].expectedUpdatedAt).toBe(changedVersion);
  expect(state.workspace.transactions[0].description).toBe(
    "Synthetic reviewed retry",
  );
});

test("delete confirmation retains the displayed record's version after a background refresh", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await openPayment(page);
  const details = page.getByRole("dialog", {
    name: "Transaction details",
    exact: true,
  });
  await details.getByRole("button", { name: "Delete", exact: true }).click();
  state.workspace.transactions[0] = {
    ...state.workspace.transactions[0],
    description: "Synthetic concurrent edit",
    updatedAt: changedVersion,
  };
  await reloadInBackground(page, () => state.reads);
  await expect(
    page.locator(`[data-transaction-id="${transactionId}"]:visible`),
  ).toContainText("Synthetic concurrent edit");
  await expect(details).toContainText("Synthetic original payment");
  await details
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(page.locator(".toast[role=alert]")).toContainText(
    "Changed on another device",
  );
  expect(state.mutations).toHaveLength(1);
  expect(state.mutations[0]).toEqual({
    collection: "transactions",
    id: transactionId,
    expectedUpdatedAt: originalVersion,
  });
  expect(state.workspace.transactions).toHaveLength(1);
  await details
    .getByRole("button", { name: "Close transaction details", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "View transaction: Synthetic concurrent edit",
      exact: true,
    }),
  ).toBeVisible();
});

test("a new transaction sends no update expectation", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const editor = page.locator(".transaction-modal");
  await editor.getByLabel("Amount · ₹", { exact: true }).fill("12.00");
  await editor
    .locator('textarea[name="description"]')
    .fill("Synthetic new payment");
  await editor.getByRole("button", { name: "Paid from", exact: true }).click();
  await page.getByRole("option", { name: /Synthetic conflict bank/ }).click();
  await editor.getByRole("button", { name: /^Save / }).click();
  await expect(editor).toHaveCount(0);
  expect(state.mutations).toHaveLength(1);
  expect(state.mutations[0]).not.toHaveProperty("expectedUpdatedAt");
  expect(state.workspace.transactions).toHaveLength(2);
});

test("editing an unversioned private record sends an explicit null expectation", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  state.backend = "local";
  delete state.workspace.transactions[0].updatedAt;
  state.beforeMutation = async (route, body) => {
    expect(body.expectedUpdatedAt).toBeNull();
    state.workspace.transactions[0] = {
      ...body.record!,
      updatedAt: changedVersion,
    };
    await route.fulfill({ status: 200, json: { ok: true } });
  };
  await openPayment(page);
  await page
    .getByRole("button", { name: "Edit transaction", exact: true })
    .click();
  const editor = page.locator(".transaction-modal");
  await editor
    .locator('textarea[name="description"]')
    .fill("Synthetic legacy private edit");
  await editor.getByRole("button", { name: /^Save / }).click();
  await expect(editor).toHaveCount(0);
  expect(state.mutations).toHaveLength(1);
  expect(state.mutations[0]).toHaveProperty("expectedUpdatedAt", null);
  expect(state.workspace.transactions[0].description).toBe(
    "Synthetic legacy private edit",
  );
});

test("a receipt create collision with changed content remains a conflict", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await page.route("**/api/ai/settings", (route) =>
    route.fulfill({
      status: 200,
      json: {
        available: true,
        configured: true,
        ownerManaged: true,
        provider: "Vercel AI Gateway",
        model: "synthetic-receipt-model",
        requiresRedaction: false,
      },
    }),
  );
  await page.route("**/api/ai/receipt", (route) =>
    route.fulfill({
      status: 200,
      json: {
        extraction: {
          documentType: "payment",
          amount: "25.50",
          currency: "INR",
          occurredOn: "2026-10-20",
          merchant: null,
          description: "Synthetic attempted receipt",
          kind: "expense",
          category: "Other",
          platform: null,
          externalReference: "SYNTHETIC-COLLISION",
          accountHint: null,
          paymentStatus: "successful",
          confidence: "high",
          warnings: [],
        },
        fingerprint: "c".repeat(64),
        provider: "Vercel AI Gateway",
        model: "synthetic-receipt-model",
      },
    }),
  );
  state.beforeMutation = async (route, body) => {
    state.workspace.transactions.push({
      ...body.record!,
      description: "Synthetic changed stored receipt",
      updatedAt: changedVersion,
    });
    await route.fulfill({
      status: 409,
      json: {
        code: "conflict",
        error: "This record changed on another device.",
      },
    });
  };
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const editor = page.locator(".transaction-modal");
  await editor
    .getByRole("button", { name: "Scan receipt", exact: true })
    .click();
  const scanner = page.locator(".receipt-modal");
  await scanner
    .getByLabel("Payment screenshot or shopping receipt")
    .setInputFiles({
      name: "synthetic-collision.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
  await scanner
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await scanner
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await editor.getByRole("button", { name: "Paid from", exact: true }).click();
  await page.getByRole("option", { name: /Synthetic conflict bank/ }).click();
  await editor
    .getByRole("checkbox", {
      name: "I checked the extracted details, selected the correct account, and reviewed possible duplicates.",
      exact: true,
    })
    .check();
  await editor.getByRole("button", { name: /^Save / }).click();
  await expect(page.locator(".toast[role=alert]")).toContainText(
    "Changed on another device",
  );
  await expect(editor.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic attempted receipt",
  );
  expect(state.mutations).toHaveLength(1);
  expect(state.mutations[0]).not.toHaveProperty("expectedUpdatedAt");
  expect(
    state.workspace.transactions.find(
      (row) => row.id === state.mutations[0].record!.id,
    )?.description,
  ).toBe("Synthetic changed stored receipt");
});

test("a delayed conflict from an earlier session stays silent after switching away and back", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.beforeMutation = async (route) => {
    await pending;
    await route.fulfill({
      status: 409,
      json: {
        code: "conflict",
        error: "This record changed on another device.",
      },
    });
  };
  await openPayment(page);
  await page
    .getByRole("button", { name: "Edit transaction", exact: true })
    .click();
  const editor = page.locator(".transaction-modal");
  await editor
    .locator('textarea[name="description"]')
    .fill("Synthetic earlier-session draft");
  await editor.getByRole("button", { name: /^Save / }).click();
  await expect.poll(() => state.mutations.length).toBe(1);
  for (const [userId, profileName] of [
    [otherOwner, "Beta tester"],
    [owner, "Alpha tester"],
  ]) {
    state.userId = userId;
    state.profileName = profileName;
    for (const rows of Object.values(state.workspace))
      for (const row of rows) row.userId = userId;
    await reloadInBackground(page, () => state.reads);
    await expect(page.locator(".user-card")).toContainText(profileName);
  }
  await expect(editor).toHaveCount(0);
  const readsBeforeResponse = state.reads;
  const response = page.waitForResponse(
    (reply) =>
      reply.url().endsWith("/api/workspace") &&
      reply.request().method() === "POST",
  );
  release!();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator(".toast")).not.toContainText(
    "Changed on another device",
  );
  expect(state.reads).toBe(readsBeforeResponse);
  expect(state.mutations).toHaveLength(1);
  expect(state.workspace.transactions[0].description).toBe(
    "Synthetic original payment",
  );
});
