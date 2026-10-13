import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { createDemoData } from "../../src/lib/seed";
import {
  privateProfileDirectory,
  provisionPrivateProfile,
} from "../../src/lib/private-profile-store";
import type { WorkspaceData } from "../../src/lib/types";

const baseURL = "http://127.0.0.1:3002";
const owner = randomUUID();
const bankName = "Synthetic workbook bank";
const inactiveBank = "Synthetic inactive bank";
const profileName = `Synthetic statement tester ${randomBytes(5).toString("hex")}`;
const email = `statement.${randomBytes(5).toString("hex")}@example.test`;
const password = randomBytes(18).toString("base64url");
const approvalLabel =
  "I have reviewed the selected rows and approve these ledger changes.";
const workbookMime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
let testDirectory = "";
let bankId = "";

function guardedTestDirectory() {
  const root = path.resolve(process.env.FINANCE_PRIVATE_DIR ?? "");
  const relativeRoot = path.relative(path.resolve(tmpdir()), root);
  if (
    relativeRoot.startsWith("..") ||
    path.isAbsolute(relativeRoot) ||
    !path.basename(root).startsWith("finance-os-private-e2e-")
  )
    throw new Error("Refusing to use a non-test statement profile directory.");
  return root;
}

function syntheticWorkspace(): WorkspaceData {
  const workspace = createDemoData();
  for (const rows of Object.values(workspace))
    for (const record of rows) record.userId = owner;
  const bank = workspace.accounts[0];
  bankId = bank.id;
  bank.name = bankName;
  workspace.accounts.push({
    ...bank,
    id: randomUUID(),
    name: inactiveBank,
    active: false,
  });
  return workspace;
}

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Genuine minimal OOXML, generated from fictional values without a source file. */
function workbook(tag: string, invalidHeaders = false) {
  const rows: Array<Array<string | number | null>> = [
    ...Array.from({ length: 17 }, (_, index) => [
      `Fictional statement metadata ${index + 1}`,
    ]),
    invalidHeaders
      ? ["Unrecognized", "Workbook", "Columns"]
      : ["Date", "Details", "Ref No./Cheque No.", "Debit", "Credit", "Balance"],
    [
      "10/10/2026",
      `Fictional stationery ${tag}`,
      `SYNTHETIC-${tag}-DEBIT`,
      1204.15,
      null,
      "₹ 8,795.85",
    ],
    [
      "11/10/2026",
      `Fictional incoming credit ${tag}`,
      `SYNTHETIC-${tag}-CREDIT`,
      null,
      "12,345.67",
      21141.52,
    ],
    [
      "12/10/2026",
      `Fictional bank fee ${tag}`,
      `SYNTHETIC-${tag}-FEE`,
      "₹25.00",
      null,
      "21,116.52",
    ],
    ["Total", null, null, "1,229.15", "12,345.67", null],
    ["Closing balance", null, null, null, null, "21,116.52"],
  ];
  const sheetRows = rows
    .map((values, index) => {
      const row = index + 1;
      const cells = values
        .map((value, column) => {
          if (value === null) return "";
          const address = `${String.fromCharCode(65 + column)}${row}`;
          return typeof value === "number"
            ? `<c r="${address}"><v>${value}</v></c>`
            : `<c r="${address}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${row}">${cells}</row>`;
    })
    .join("");
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
      "xl/workbook.xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Statement" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:F23"/><sheetData>${sheetRows}</sheetData></worksheet>`,
      ),
    }),
  );
}

async function workspace(page: Page) {
  const response = await page.request.get("/api/workspace");
  expect(response.status()).toBe(200);
  return (await response.json()).workspace as WorkspaceData;
}

async function upload(
  page: Page,
  tag: string,
  invalidHeaders = false,
  fileName = `fictional-statement-${tag}.xlsx`,
) {
  await page
    .getByLabel("Upload bank statement", { exact: true })
    .setInputFiles({
      name: fileName,
      mimeType: workbookMime,
      buffer: workbook(tag, invalidHeaders),
    });
}

function row(page: Page, number: number) {
  return page.locator("article").filter({
    has: page.getByRole("checkbox", {
      name: `Select import row ${number}`,
      exact: true,
    }),
  });
}

function selected(page: Page, number: number) {
  return page.getByRole("checkbox", {
    name: `Select import row ${number}`,
    exact: true,
  });
}

async function assertNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test.beforeAll(async ({ browser }) => {
  testDirectory = guardedTestDirectory();
  expect(privateProfileDirectory()).toBe(testDirectory);
  const { setupToken } = await provisionPrivateProfile(
    syntheticWorkspace(),
    profileName,
  );
  const context = await browser.newContext({ baseURL });
  try {
    const response = await context.request.post("/api/profile", {
      headers: { Origin: baseURL },
      data: {
        action: "setup",
        token: setupToken,
        displayName: profileName,
        email,
        password,
      },
    });
    expect(response.ok()).toBe(true);
    cookies = await context.cookies(baseURL);
    expect(cookies.some((cookie) => cookie.httpOnly)).toBe(true);
  } finally {
    await context.close();
  }
});

test.beforeEach(async ({ context, page }) => {
  await context.addCookies(cookies);
  // A statement import must not invoke any cloud scanner.
  await page.route("**/api/ai/receipt", async (route) => {
    await route.abort();
    throw new Error("Bank statement unexpectedly invoked receipt AI.");
  });
});

test.afterAll(async () => {
  const safeRoot = guardedTestDirectory();
  if (testDirectory && safeRoot === testDirectory)
    await rm(safeRoot, { recursive: true, force: true });
  cookies = [];
});

test("Excel header discovery and debit/credit review require an explicit bank without ledger changes", async ({
  page,
}) => {
  const before = await workspace(page);
  await page.goto("/imports");
  await expect(
    page.getByRole("button", { name: "Choose statement", exact: true }),
  ).toBeVisible();
  await upload(page, "preview");
  const account = page.getByRole("combobox", {
    name: "Bank account",
    exact: true,
  });
  await expect(account).toHaveValue("");
  await expect(
    account.locator("option", { hasText: inactiveBank }),
  ).toHaveCount(0);
  await expect(
    account.locator("option", { hasText: "Aster Platinum" }),
  ).toHaveCount(0);
  await expect(selected(page, 19)).toHaveCount(0);
  expect(await workspace(page)).toEqual(before);
  await account.selectOption(bankId);
  await expect(selected(page, 19)).toBeChecked();
  await expect(selected(page, 20)).toBeChecked();
  await expect(selected(page, 21)).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /^Select import row / }),
  ).toHaveCount(3);
  await expect(row(page, 19)).toContainText("Fictional stationery preview");
  await expect(row(page, 19)).toContainText("2026-10-10");
  await expect(row(page, 19)).toContainText("₹1,204.15");
  await expect(row(page, 19)).toContainText("Ref: SYNTHETIC-preview-DEBIT");
  await expect(row(page, 20)).toContainText("₹12,345.67");
  await expect(row(page, 21)).toContainText("₹25.00");
  await expect(
    page.getByRole("combobox", { name: "Type for row 19", exact: true }),
  ).toHaveValue("expense");
  await expect(
    page.getByRole("combobox", { name: "Type for row 20", exact: true }),
  ).toHaveValue("income");
  await expect(
    page.getByRole("button", { name: "Import 3 selected rows", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: approvalLabel, exact: true })
    .check();
  await page
    .getByRole("combobox", { name: "Type for row 20", exact: true })
    .selectOption("transfer");
  await expect(
    page.getByRole("checkbox", { name: approvalLabel, exact: true }),
  ).not.toBeChecked();
  await expect(selected(page, 20)).toBeDisabled();
  await expect(row(page, 20)).toContainText("Choose the other account");
  const other = before.accounts.find(
    (account) =>
      account.kind === "bank" && account.active && account.id !== bankId,
  )!;
  await page
    .getByRole("combobox", { name: "Other account for row 20", exact: true })
    .selectOption(other.id);
  await expect(selected(page, 20)).toBeEnabled();
  await expect(selected(page, 20)).toBeChecked();
  await page
    .getByRole("combobox", { name: "Type for row 20", exact: true })
    .selectOption("income");
  expect(await workspace(page)).toEqual(before);
  await assertNoOverflow(page);
});

test("reviewed partial Excel imports preserve directions, exact money, and never duplicate on re-upload", async ({
  page,
}) => {
  const before = await workspace(page);
  await page.goto("/imports");
  await upload(page, "commit");
  await page
    .getByRole("combobox", { name: "Bank account", exact: true })
    .selectOption(bankId);
  await expect(selected(page, 19)).toBeChecked();
  await page
    .getByRole("combobox", { name: "Category for row 19", exact: true })
    .selectOption("Stationery");
  await page
    .getByRole("combobox", { name: "Type for row 20", exact: true })
    .selectOption("refund");
  await selected(page, 21).uncheck();
  await page
    .getByRole("checkbox", { name: approvalLabel, exact: true })
    .check();
  await page
    .getByRole("button", { name: "Import 2 selected rows", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "2 rows imported." }),
  ).toBeVisible();
  const first = await workspace(page);
  expect(first.transactions).toHaveLength(before.transactions.length + 2);
  expect(
    first.transactions.find(
      (transaction) =>
        transaction.description === "Fictional stationery commit",
    ),
  ).toMatchObject({
    amount: "1204.15",
    currency: "INR",
    occurredOn: "2026-10-10",
    kind: "expense",
    status: "posted",
    fromAccountId: bankId,
    toAccountId: null,
    externalReference: "SYNTHETIC-commit-DEBIT",
    category: "Stationery",
  });
  expect(
    first.transactions.find(
      (transaction) =>
        transaction.description === "Fictional incoming credit commit",
    ),
  ).toMatchObject({
    amount: "12345.67",
    occurredOn: "2026-10-11",
    kind: "refund",
    fromAccountId: null,
    toAccountId: bankId,
  });
  expect(first.snapshots).toEqual(before.snapshots);
  expect(first.accounts).toEqual(before.accounts);
  await upload(page, "commit");
  await expect(selected(page, 19)).toBeDisabled();
  await expect(selected(page, 19)).not.toBeChecked();
  await expect(selected(page, 20)).toBeDisabled();
  await expect(selected(page, 21)).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: approvalLabel, exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", { name: approvalLabel, exact: true })
    .check();
  await page
    .getByRole("button", { name: "Import 1 selected rows", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "1 rows imported." }),
  ).toBeVisible();
  await upload(page, "commit");
  for (const number of [19, 20, 21]) {
    await expect(selected(page, number)).toBeDisabled();
    await expect(selected(page, number)).not.toBeChecked();
  }
  await expect(
    page.getByRole("button", { name: "Import 0 selected rows", exact: true }),
  ).toBeDisabled();
  await page.reload();
  const final = await workspace(page);
  expect(final.transactions).toHaveLength(before.transactions.length + 3);
  expect(
    final.transactions.find(
      (transaction) => transaction.description === "Fictional bank fee commit",
    ),
  ).toMatchObject({
    amount: "25.00",
    kind: "expense",
    fromAccountId: bankId,
    toAccountId: null,
  });
  expect(final.snapshots).toEqual(before.snapshots);
  expect(final.accounts).toEqual(before.accounts);
});

test("invalid and encrypted workbooks report friendly errors and recover without ledger changes", async ({
  page,
}) => {
  const before = await workspace(page);
  await page.goto("/imports");
  const input = page.getByLabel("Upload bank statement", { exact: true });
  await input.setInputFiles({
    name: "fictional-corrupt.xlsx",
    mimeType: workbookMime,
    buffer: Buffer.from("This is not an OOXML workbook."),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    /Excel|workbook|statement/i,
  );
  await input.setInputFiles({
    name: "fictional-encrypted.xlsx",
    mimeType: workbookMime,
    // Office's encrypted container signature; no confidential workbook exists.
    buffer: Buffer.from("d0cf11e0a1b11ae10000000000000000", "hex"),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    /password|encrypted|decrypt|unprotected/i,
  );
  await upload(page, "badheaders", true);
  const account = page.getByRole("combobox", {
    name: "Bank account",
    exact: true,
  });
  if (await account.isVisible()) await account.selectOption(bankId);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    /header|column|Date|Details/i,
  );
  expect(await workspace(page)).toEqual(before);
  await upload(page, "recovery");
  await account.selectOption(bankId);
  await expect(selected(page, 19)).toBeChecked();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(await workspace(page)).toEqual(before);
});

test("statement cards fit a 320 px screen and the CSV template remains reviewable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  const before = await workspace(page);
  await page.goto("/imports");
  await upload(
    page,
    "mobile",
    false,
    "AccountStatement_13102026_00000_decrypted (fictional).xlsx",
  );
  await page
    .getByRole("combobox", { name: "Bank account", exact: true })
    .selectOption(bankId);
  await expect(selected(page, 19)).toBeChecked();
  await expect(row(page, 20)).toBeVisible();
  await assertNoOverflow(page);
  await page.screenshot({
    path: path.resolve("artifacts/statement-import-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("checkbox", { name: approvalLabel, exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: "Import 3 selected rows", exact: true }),
  ).toBeEnabled();
  const csv = `date,description,amount,type,account,reference,category\n2026-10-12,Fictional CSV compatibility,18.29,expense,${bankName},SYNTHETIC-CSV-COMPATIBILITY,Stationery\n`;
  await page
    .getByLabel("Upload bank statement", { exact: true })
    .setInputFiles({
      name: "fictional-statement.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await expect(selected(page, 2)).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: approvalLabel, exact: true }),
  ).not.toBeChecked();
  await expect(row(page, 2)).toContainText("₹18.29");
  await expect(
    page.getByRole("button", { name: "Import 1 selected rows", exact: true }),
  ).toBeDisabled();
  await assertNoOverflow(page);
  expect(await workspace(page)).toEqual(before);
});
