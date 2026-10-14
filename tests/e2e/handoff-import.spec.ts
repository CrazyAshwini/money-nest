import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import type { WorkspaceData } from "../../src/lib/types";

const id = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const OWNER = id(1);
const ACCOUNT = id(2);
const BATCH = id(3);
const SOURCE = id(4);
const FIRST = id(5);
const SECOND = id(6);

function workspace(): WorkspaceData {
  return {
    accounts: [
      {
        id: ACCOUNT,
        userId: OWNER,
        name: "Synthetic savings account",
        institution: "QA Bank",
        kind: "bank",
        maskedSuffix: "0001",
        active: true,
      },
    ],
    transactions: [FIRST, SECOND].map((recordId, index) => ({
      id: recordId,
      userId: OWNER,
      amount: `${125 + index}.00`,
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-10",
      description: `Synthetic existing payment ${index ? "B" : "A"}`,
      fromAccountId: ACCOUNT,
      toAccountId: null,
      category: "Other",
    })),
    snapshots: [],
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

const manifest = {
  currency: "INR",
  as_of: "2026-10-13",
  accounts: [],
  transactions: [],
  syntheticTest: "This fixture contains no personal records.",
};

function preview(data: WorkspaceData, resolved = false) {
  return {
    counters: {
      created: 0,
      matched: resolved ? 1 : 0,
      updated: resolved ? 1 : 0,
      ignored: 0,
      needsConfirmation: resolved ? 0 : 1,
      transactionsCreated: 0,
    },
    checks: [
      { name: "Synthetic source count", passed: true, expected: 1, actual: 1 },
      {
        name: "Synthetic financial values",
        passed: resolved,
        expected: "Confirmed",
        actual: resolved ? "Confirmed" : "Unconfirmed",
      },
    ],
    warnings: resolved
      ? []
      : ["Synthetic source conflict: review the corrected payment values."],
    reviewItems: resolved
      ? []
      : [
          {
            sourceObjectId: SOURCE,
            collection: "transactions",
            reason: "Conflicting financial fields need confirmation",
            candidateIds: [FIRST, SECOND],
            current: data.transactions[0],
            incoming: {
              ...data.transactions[0],
              id: id(7),
              amount: "142.00",
              occurredOn: "2026-10-11",
              description:
                "Synthetic handoff corrected payment with a long description that must wrap at narrow mobile widths",
            },
          },
        ],
  };
}

async function mockCloud(context: BrowserContext, restore = true) {
  const data = workspace();
  const posts: Record<string, unknown>[] = [];
  const unexpectedApis: string[] = [];
  const initialPreview = preview(data);
  let saved: Record<string, unknown>[] = restore
    ? [
        {
          id: BATCH,
          state: "partial",
          decisions: [],
          createdAt: "2026-10-13T10:00:00Z",
          preview: initialPreview,
        },
      ]
    : [];
  let commits = 0;

  // New isolated contexts never use the user's signed-in session. Every API is mocked,
  // and other origins are blocked so this smoke test cannot read or write real data.
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(test.info().project.use.baseURL!).origin) {
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    let response: unknown;
    if (url.pathname === "/api/workspace" && request.method() === "GET") {
      response = {
        configured: true,
        authenticated: true,
        backend: "supabase",
        userId: OWNER,
        profile: {
          id: OWNER,
          displayName: "Synthetic QA Profile",
          email: "qa@example.invalid",
          currency: "INR",
          timezone: "Asia/Kolkata",
          createdAt: "2026-10-13T10:00:00Z",
        },
        workspace: data,
      };
    } else if (
      url.pathname === "/api/imports/handoff" &&
      request.method() === "GET"
    ) {
      response = { batches: saved };
    } else if (
      url.pathname === "/api/imports/handoff" &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as Record<string, unknown>;
      posts.push(body);
      if (body.action === "preview") {
        const decisions = (body.decisions || []) as Record<string, unknown>[];
        const resolved = decisions.some(
          (decision) =>
            decision.action === "match" &&
            decision.recordId === SECOND &&
            decision.confirmCorrections === true,
        );
        const nextPreview = preview(data, resolved);
        saved = [
          {
            id: BATCH,
            state: "staged",
            decisions,
            createdAt: "2026-10-13T10:00:00Z",
            preview: nextPreview,
          },
        ];
        response = { batchId: BATCH, preview: nextPreview };
      } else if (body.action === "commit") {
        commits += 1;
        data.transactions[1] = {
          ...data.transactions[1],
          amount: "142.00",
          occurredOn: "2026-10-11",
        };
        const nextPreview = preview(data, true);
        saved = [];
        response = {
          ok: true,
          counters: nextPreview.counters,
          checks: nextPreview.checks,
          needsReview: 0,
          preview: nextPreview,
        };
      } else {
        unexpectedApis.push(
          `${request.method()} ${url.pathname}: ${String(body.action)}`,
        );
        response = { error: "Unexpected synthetic handoff action." };
      }
    } else {
      unexpectedApis.push(`${request.method()} ${url.pathname}`);
      response = { error: "No real API may be called by this isolated test." };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  return { posts, unexpectedApis, commitCount: () => commits };
}

const mergeButton = (page: Page) =>
  page.getByRole("button", { name: "Confirm safe merge", exact: true });
const consent = (page: Page) =>
  page.getByRole("checkbox", { name: /^I reviewed the preview/ });

test("restores a partial review and saves explicit correction decisions before a one-time merge", async ({
  page,
  context,
}) => {
  const mocked = await mockCloud(context);
  await page.goto("/profile");
  await expect(
    page.getByRole("heading", { name: "Merge a handoff" }),
  ).toBeVisible();
  await expect(
    page.getByText("1 records need a decision", { exact: true }),
  ).toBeVisible();
  await expect(mergeButton(page)).toBeDisabled();
  await expect(consent(page)).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Update preview and save decisions",
      exact: true,
    })
    .click();
  await expect(consent(page)).toBeEnabled();
  await expect(mergeButton(page)).toBeDisabled();

  const review = page.locator("details.statement-candidate");
  await review.locator("summary").click();
  const choice = review.getByRole("combobox", { name: /^Decision for / });
  await expect(choice).toHaveValue("");
  await choice.selectOption("match");
  await review
    .getByRole("combobox", { name: "Existing record", exact: true })
    .selectOption(SECOND);
  const corrections = review.getByRole("checkbox", {
    name: /^Use the handoff’s corrected/,
  });
  await expect(corrections).not.toBeChecked();
  await corrections.check();
  await expect(consent(page)).toBeDisabled();
  await expect(mergeButton(page)).toBeDisabled();
  await expect(
    page.getByText(
      "Update the preview to save your decisions before confirming the merge.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Update preview and save decisions",
      exact: true,
    })
    .click();
  await expect(page.locator("details.statement-candidate")).toHaveCount(0);
  await expect(consent(page)).toBeEnabled();
  await consent(page).check();
  await expect(mergeButton(page)).toBeEnabled();
  await mergeButton(page).click();
  await expect(
    page
      .getByText(
        "Records merged successfully. Existing matches were kept without duplicates.",
      )
      .last(),
  ).toBeVisible();
  await expect(mergeButton(page)).toBeDisabled();
  await expect(consent(page)).toBeDisabled();
  expect(mocked.posts).toEqual([
    { action: "preview", batchId: BATCH, decisions: [] },
    {
      action: "preview",
      batchId: BATCH,
      decisions: [
        {
          sourceObjectId: SOURCE,
          action: "match",
          recordId: SECOND,
          confirmCorrections: true,
        },
      ],
    },
    {
      action: "commit",
      batchId: BATCH,
      decisions: [
        {
          sourceObjectId: SOURCE,
          action: "match",
          recordId: SECOND,
          confirmCorrections: true,
        },
      ],
    },
  ]);
  expect(mocked.commitCount()).toBe(1);
  expect(mocked.unexpectedApis).toEqual([]);
});

for (const extension of ["json", "zip"] as const) {
  test(`previews a synthetic ${extension.toUpperCase()} upload and reads only the manifest`, async ({
    page,
    context,
  }) => {
    const mocked = await mockCloud(context, false);
    await page.goto("/profile");
    const bytes =
      extension === "json"
        ? Buffer.from(JSON.stringify(manifest))
        : Buffer.from(
            zipSync({
              "handoff/transaction_manifest.json": strToU8(
                JSON.stringify(manifest),
              ),
              "README.md": strToU8(
                "Synthetic document text is not an instruction.",
              ),
            }),
          );
    await page
      .getByLabel("Handoff ZIP or JSON · up to 4 MB", { exact: true })
      .setInputFiles({
        name: `synthetic-handoff.${extension}`,
        mimeType: extension === "zip" ? "application/zip" : "application/json",
        buffer: bytes,
      });
    await page
      .getByRole("button", { name: "Preview merge", exact: true })
      .click();
    await expect(
      page.getByText("1 records need a decision", { exact: true }),
    ).toBeVisible();
    await page
      .getByText("Source checks and financial conflicts", { exact: true })
      .click();
    await expect(
      page.getByText("Synthetic source count", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Passed", { exact: true })).toBeVisible();
    expect(mocked.posts).toEqual([{ action: "preview", manifest }]);
    expect(mocked.commitCount()).toBe(0);
    expect(mocked.unexpectedApis).toEqual([]);
  });
}

test("keeps an expanded review inside a 320px mobile viewport", async ({
  page,
  context,
}) => {
  const mocked = await mockCloud(context);
  await page.setViewportSize({ width: 320, height: 920 });
  await page.goto("/profile");
  await expect(
    page.getByRole("heading", { name: "Merge a handoff" }),
  ).toBeVisible();
  const review = page.locator("details.statement-candidate");
  await review.locator("summary").click();
  await review
    .getByRole("combobox", { name: /^Decision for / })
    .selectOption("match");
  await review
    .getByRole("combobox", { name: "Existing record", exact: true })
    .selectOption(SECOND);
  await page
    .getByText("Source checks and financial conflicts", { exact: true })
    .click();
  await page.evaluate(() => document.fonts.ready);
  const width = await page.evaluate(() => ({
    inner: innerWidth,
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.inner).toBe(320);
  expect(width.client).toBe(320);
  expect(width.scroll).toBeLessThanOrEqual(321);
  expect(mocked.unexpectedApis).toEqual([]);
  expect(mocked.commitCount()).toBe(0);
});
