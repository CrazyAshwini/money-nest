import { expect, test, type Page } from "@playwright/test";
import { cloneDemoData, DEMO_USER_ID } from "../../src/lib/seed";
import type { Reminder, WorkspaceData } from "../../src/lib/types";

const storageKey = "finance-os:fictional-demo:v1";
const cloudOwner = "11000000-0000-4000-8000-000000000009";
const firstReminder = "44000000-0000-4000-8000-000000000001";
const secondReminder = "44000000-0000-4000-8000-000000000002";
const version = "2026-10-31T00:00:00.123456Z";
type StorageWrite = { key: string; value: string };
type BrowserStorageProbe = Window & {
  syntheticStorageWrites: StorageWrite[];
  syntheticStorageQuota: boolean;
  reportSyntheticStorageWrite: (key: string, value: string) => Promise<void>;
};

async function storageProbe(page: Page) {
  const writes: StorageWrite[] = [];
  await page.exposeFunction(
    "reportSyntheticStorageWrite",
    (key: string, value: string) => {
      writes.push({ key, value });
    },
  );
  await page.addInitScript((workspaceKey) => {
    const browser = window as unknown as BrowserStorageProbe;
    browser.syntheticStorageWrites = [];
    browser.syntheticStorageQuota = false;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage) {
        const write = { key: String(key), value: String(value) };
        browser.syntheticStorageWrites.push(write);
        void browser.reportSyntheticStorageWrite(write.key, write.value);
        if (key === workspaceKey && browser.syntheticStorageQuota)
          throw new DOMException(
            "Synthetic storage quota",
            "QuotaExceededError",
          );
      }
      return setItem.call(this, key, value);
    };
  }, storageKey);
  return writes;
}

function syntheticWorkspace(owner: string): WorkspaceData {
  const workspace = Object.fromEntries(
    Object.keys(cloneDemoData()).map((key) => [key, []]),
  ) as unknown as WorkspaceData;
  workspace.accounts = [
    {
      id: "22000000-0000-4000-8000-000000000009",
      userId: owner,
      name: "Synthetic storage bank",
      institution: "Synthetic institution",
      kind: "bank",
      maskedSuffix: "",
      active: true,
      openingBalance: "1000.00",
      openingBalanceDate: "2026-10-01",
      updatedAt: version,
    },
  ];
  workspace.transactions = [
    {
      id: "33000000-0000-4000-8000-000000000009",
      userId: owner,
      amount: "41.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      description: "Synthetic storage-only purchase",
      occurredOn: "2026-10-05",
      fromAccountId: workspace.accounts[0].id,
      toAccountId: null,
      category: "Other",
      updatedAt: version,
    },
  ];
  workspace.reminders = [
    {
      id: firstReminder,
      userId: owner,
      title: "Synthetic first reminder",
      enabled: false,
      channel: "in_app",
      state: "scheduled",
      triggerAt: "2026-11-01T06:00:00Z",
      billId: null,
      emiId: null,
      updatedAt: version,
    },
    {
      id: secondReminder,
      userId: owner,
      title: "Synthetic second reminder",
      enabled: true,
      channel: "in_app",
      state: "scheduled",
      triggerAt: "2026-11-01T07:00:00Z",
      billId: null,
      emiId: null,
      updatedAt: version,
    },
  ];
  return workspace;
}

async function mockedWorkspace(page: Page, backend: "demo" | "supabase") {
  const state = {
    backend,
    authenticated: true,
    reads: 0,
    mutations: [] as Array<{
      collection: string;
      record: Reminder;
      expectedUpdatedAt?: string | null;
    }>,
    workspace: syntheticWorkspace(
      backend === "demo" ? DEMO_USER_ID : cloudOwner,
    ),
  };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL!).origin)
      return route.abort();
    if (url.pathname === "/api/workspace") {
      if (route.request().method() === "GET") {
        state.reads++;
        return route.fulfill({
          status: state.authenticated ? 200 : 401,
          json: {
            configured: true,
            authenticated: state.authenticated,
            backend: state.backend,
            userId: state.backend === "demo" ? DEMO_USER_ID : cloudOwner,
            profile: { displayName: "Synthetic storage tester" },
            signupEnabled: false,
            ...(state.authenticated ? { workspace: state.workspace } : {}),
          },
        });
      }
      const body = route
        .request()
        .postDataJSON() as (typeof state.mutations)[number];
      state.mutations.push(body);
      expect(state.backend).toBe("supabase");
      expect(body.collection).toBe("reminders");
      const current = state.workspace.reminders.find(
        (record) => record.id === body.record.id,
      )!;
      expect(body.expectedUpdatedAt).toBe(current.updatedAt);
      const saved = { ...body.record, updatedAt: "2026-11-01T00:00:00.000Z" };
      state.workspace.reminders = state.workspace.reminders.map((record) =>
        record.id === saved.id ? saved : record,
      );
      return route.fulfill({ status: 200, json: { record: saved } });
    }
    if (url.pathname === "/api/auth") {
      expect(route.request().postDataJSON()).toMatchObject({
        action: "exit-demo",
      });
      state.authenticated = false;
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

const firstToggle = (page: Page) =>
  page.getByRole("switch", {
    name: "Toggle Synthetic first reminder",
    exact: true,
  });
const secondToggle = (page: Page) =>
  page.getByRole("switch", {
    name: "Toggle Synthetic second reminder",
    exact: true,
  });
async function browserWrites(page: Page) {
  return page.evaluate(
    () => (window as unknown as BrowserStorageProbe).syntheticStorageWrites,
  );
}
async function pauseDemo(page: Page) {
  await page.clock.install({ time: new Date("2026-11-01T10:00:00Z") });
  await page.goto("/notifications");
  await expect(firstToggle(page)).toBeVisible();
  // Load naturally before pausing; jumping ahead settles the initial demo save.
  await page.clock.pauseAt(new Date("2026-11-01T10:10:00Z"));
  await expect.poll(async () => (await browserWrites(page)).length).toBe(1);
  await page.evaluate(() => {
    (window as unknown as BrowserStorageProbe).syntheticStorageWrites.length =
      0;
  });
}

test("cloud load, update and reload never persist workspace data in localStorage", async ({
  page,
}) => {
  const writes = await storageProbe(page);
  const state = await mockedWorkspace(page, "supabase");
  await page.goto("/notifications");
  await expect(firstToggle(page)).toHaveAttribute("aria-checked", "false");
  await firstToggle(page).click();
  await expect(firstToggle(page)).toHaveAttribute("aria-checked", "true");
  expect(state.mutations).toHaveLength(1);
  expect(state.mutations[0].record.userId).toBe(cloudOwner);
  expect(await browserWrites(page)).toEqual([]);
  await page.reload();
  await expect(firstToggle(page)).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(700); // Covers a full persistence debounce window after reload.
  expect(await browserWrites(page)).toEqual([]);
  expect(writes).toEqual([]);
  expect(state.reads).toBeGreaterThanOrEqual(3);
});

test("a demo response containing another owner's row is never written to browser storage", async ({
  page,
}) => {
  const writes = await storageProbe(page);
  const state = await mockedWorkspace(page, "demo");
  state.workspace.transactions[0].userId = cloudOwner;
  await page.goto("/notifications");
  await expect.poll(() => state.reads).toBeGreaterThan(0);
  await page.waitForTimeout(700);
  expect(await browserWrites(page)).toEqual([]);
  expect(writes).toEqual([]);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
});

test("rapid demo edits coalesce into one final workspace write after 500 milliseconds", async ({
  page,
}) => {
  await storageProbe(page);
  const state = await mockedWorkspace(page, "demo");
  await pauseDemo(page);
  await firstToggle(page).click();
  await expect(firstToggle(page)).toHaveAttribute("aria-checked", "true");
  await page.clock.runFor(200);
  await secondToggle(page).click();
  await expect(secondToggle(page)).toHaveAttribute("aria-checked", "false");
  await page.clock.runFor(200);
  await firstToggle(page).click();
  await expect(firstToggle(page)).toHaveAttribute("aria-checked", "false");
  await page.clock.runFor(499);
  expect(await browserWrites(page)).toEqual([]);
  await page.clock.runFor(1);
  const writes = await browserWrites(page);
  expect(writes).toHaveLength(1);
  expect(writes[0].key).toBe(storageKey);
  const saved = JSON.parse(writes[0].value) as WorkspaceData;
  expect(saved.reminders.map((record) => record.enabled)).toEqual([
    false,
    false,
  ]);
  expect(
    Object.values(saved)
      .flat()
      .every((record) => record.userId === DEMO_USER_ID),
  ).toBe(true);
  expect(state.mutations).toEqual([]);
});

test("signing out cancels a pending demo write instead of persisting it in the next mode", async ({
  page,
}) => {
  await storageProbe(page);
  const state = await mockedWorkspace(page, "demo");
  await pauseDemo(page);
  await firstToggle(page).click();
  await expect(firstToggle(page)).toHaveAttribute("aria-checked", "true");
  await page.locator('a[href="/settings"]').first().click();
  await page.getByRole("button", { name: "Exit demo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.clock.runFor(1000);
  expect(await browserWrites(page)).toEqual([]);
  expect(state.authenticated).toBe(false);
});

test("leaving the app cancels its pending demo persistence", async ({
  page,
}) => {
  const writes = await storageProbe(page);
  await mockedWorkspace(page, "demo");
  await pauseDemo(page);
  await expect.poll(() => writes.length).toBe(1);
  const before = writes.length;
  await firstToggle(page).click();
  await expect(firstToggle(page)).toHaveAttribute("aria-checked", "true");
  await page.goto("about:blank");
  await page.waitForTimeout(700);
  expect(writes).toHaveLength(before);
});

test("a quota failure keeps the demo usable and asks the user to export changes", async ({
  page,
}) => {
  await storageProbe(page);
  await mockedWorkspace(page, "demo");
  await pauseDemo(page);
  await page.evaluate(() => {
    (window as unknown as BrowserStorageProbe).syntheticStorageQuota = true;
  });
  await firstToggle(page).click();
  await expect(firstToggle(page)).toHaveAttribute("aria-checked", "true");
  await page.clock.runFor(500);
  await expect(page.locator(".toast[role=alert]")).toContainText(
    "Browser storage is full",
  );
  await expect(page.locator(".toast[role=alert]")).toContainText(
    "Export your demo changes",
  );
  expect(await browserWrites(page)).toHaveLength(1);
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!) as WorkspaceData,
    storageKey,
  );
  expect(stored.reminders[0].enabled).toBe(false);
  await page.clock.runFor(1000);
  expect(await browserWrites(page)).toHaveLength(1);
});
