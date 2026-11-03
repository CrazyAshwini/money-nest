import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  fixture,
  mockWorkspace,
  openEditor,
  noOverflow,
  OWNER,
  ready,
} from "../compact-expense-e2e/fixture";
import { applyPersonalLoanCommand } from "../../src/lib/personal-loans";

for (const width of [320, 390, 1440]) {
  test(`five-option selector, category flow and type switching at ${width}px`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = fixture();
    await mockWorkspace(context, page, baseURL!, f.data, true);
    const editor = await openEditor(page);
    await editor.locator('input[name="amount"]').fill("200.25");
    await editor
      .getByRole("button", { name: "Transaction type", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "Choose transaction type",
      exact: true,
    });
    await expect(picker.getByRole("option")).toHaveText([
      "Expense",
      "Income",
      "Bill Repayment",
      "Transfer",
      "Refund / Money Back",
    ]);
    await mkdir("docs/moneynest-upgrade/screenshots", { recursive: true });
    await page.screenshot({
      path: `docs/moneynest-upgrade/screenshots/${width}-selector.png`,
    });
    await picker.getByRole("option", { name: "Income", exact: true }).click();
    await expect(editor.locator('input[name="amount"]')).toHaveValue("200.25");
    await expect(
      editor.getByRole("button", { name: "Platform", exact: true }),
    ).toHaveCount(0);
    await editor
      .getByRole("button", { name: "Transaction type", exact: true })
      .click();
    await page.getByRole("option", { name: "Expense", exact: true }).click();
    await editor.getByRole("button", { name: "Category", exact: true }).click();
    await page.getByRole("option", { name: "Food", exact: true }).click();
    await editor.getByRole("button", { name: "Platform", exact: true }).click();
    await page.getByRole("option", { name: "Swiggy", exact: true }).click();
    await expect(
      editor.getByRole("button", { name: "Platform", exact: true }),
    ).toContainText("Swiggy");
    await noOverflow(page);
    await page.screenshot({
      path: `docs/moneynest-upgrade/screenshots/${width}-expense.png`,
    });
  });
  test(`personal loan creation, repayment, reversal and Profile at ${width}px`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const f = fixture();
    await mockWorkspace(context, page, baseURL!, f.data);
    await context.route("**/api/workspace", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON();
      if (!body.personalLoan) return route.fallback();
      try {
        Object.assign(
          f.data,
          applyPersonalLoanCommand(f.data, OWNER, body.personalLoan),
        );
        return route.fulfill({ status: 200, json: { ok: true } });
      } catch (error) {
        return route.fulfill({ status: 400, json: { error: String(error) } });
      }
    });
    await page.goto("/loans");
    await ready(page);
    await page.getByRole("button", { name: "Give Loan", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Give Loan", exact: true });
    await dialog.getByLabel("Person", { exact: true }).fill("QA Friend");
    await dialog.locator('input[name="amount"]').fill("500.00");
    await dialog
      .getByRole("combobox", { name: "Bank / wallet", exact: true })
      .selectOption(f.bank.id);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const loan = f.data.loans.find((l) => l.ledgerManaged)!;
    expect(loan).toBeTruthy();
    expect(f.data.transactions).toHaveLength(1);
    await page.goto(`/loans/${loan.id}`);
    await page
      .getByRole("button", { name: "Record Repayment", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Record Repayment",
      exact: true,
    });
    await dialog.locator('input[name="amount"]').fill("200.00");
    await dialog
      .getByRole("combobox", { name: "Bank / wallet", exact: true })
      .selectOption(f.bank.id);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("₹300.00", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Reverse repayment", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Reverse repayment",
      exact: true,
    });
    await dialog.locator('textarea[name="notes"]').fill("QA reversal reason");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByText("₹500.00", { exact: true }).first(),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: `docs/moneynest-upgrade/screenshots/${width}-loan.png`,
    });
    await page.goto(`/profile?account=${f.bank.id}`);
    await ready(page);
    await expect(
      page.getByRole("heading", { name: "Financial accounts", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: `Edit ${f.bank.name}`, exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Edit account", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
  });
}
