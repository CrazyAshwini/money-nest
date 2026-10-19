import { describe, expect, it } from "vitest";
import {
  CATEGORY_PLATFORMS,
  getCategoryPlatformOptions,
  getHistoryPlatformSuggestions,
  isOtherHistoryPlatform,
} from "./category-platforms";
import { monthlySummary } from "./finance";
import {
  getTransactionView,
  isTransferActivity,
  parseTransactionFilters,
  serializeTransactionFilters,
  type TransactionViewFilters,
} from "./transactions-view";
import type { Transaction, WorkspaceData } from "./types";

const today = "2027-02-02";
const record = (
  id: string,
  overrides: Partial<Transaction> = {},
): Transaction => ({
  id,
  userId: "owner",
  amount: "10.01",
  currency: "INR",
  kind: "expense",
  status: "posted",
  occurredOn: "2027-02-01",
  description: `Synthetic ${id}`,
  fromAccountId: "bank",
  toAccountId: null,
  category: "Food",
  platform: "Swiggy",
  ...overrides,
});
const workspace = (transactions: Transaction[] = []): WorkspaceData => ({
  accounts: [],
  snapshots: [],
  transactions,
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
});
const filters = (query = ""): TransactionViewFilters =>
  parseTransactionFilters(new URLSearchParams(query), today);
const view = (data: WorkspaceData, query = "") =>
  getTransactionView(data, "owner", filters(query), today);

describe("transaction URL state", () => {
  it("defaults to the actual supplied calendar month and All, independent of historical workspace month", () => {
    expect(filters()).toMatchObject({
      period: "month",
      month: "2027-02",
      kind: "all",
      category: "",
      platform: "",
      invalidPeriod: false,
    });
    expect(
      parseTransactionFilters(new URLSearchParams(), "2028-01-01").month,
    ).toBe("2028-01");
  });

  it.each([
    "refund",
    "bill_payment",
    "adjustment",
    "expense",
    "income",
    "transfer",
  ])("preserves the existing explicit %s deep link", (kind) => {
    const state = filters(
      `period=all&kind=${kind}&account=synthetic-card&status=pending_review&category=Food`,
    );
    expect(state).toMatchObject({
      kind,
      period: "all",
      account: "synthetic-card",
      status: "pending_review",
      category: "Food",
    });
    expect(
      parseTransactionFilters(serializeTransactionFilters(state), today),
    ).toEqual(state);
  });

  it("gives exact dates priority, then explicit month, then All dates", () => {
    expect(filters("date=2027-01-05&month=2026-12&period=all")).toMatchObject({
      period: "date",
      date: "2027-01-05",
      month: "2026-12",
    });
    expect(filters("month=2026-12&period=all")).toMatchObject({
      period: "month",
      month: "2026-12",
    });
    expect(filters("period=all")).toMatchObject({
      period: "all",
      month: "2027-02",
    });
  });

  it.each([
    "date=2027-02-29",
    "date=2027-13-01",
    "date=2027-02-31",
    "month=2027-13",
    "month=not-a-month",
  ])("does not silently broaden malformed %s to all records", (query) => {
    expect(filters(query).invalidPeriod).toBe(true);
    expect(view(workspace([record("entry")]), query).transactions).toEqual([]);
    expect(view(workspace(), query).periodLabel).toMatch(/^Unavailable /);
  });

  it("canonicalizes duplicate keys and preserves encoded references without URL loops", () => {
    const state = filters(
      "month=2027-01&month=2027-02&kind=expense&category=food&platform=swiggy&q=Tea+%26+cake%2F%3F&sort=oldest",
    );
    const canonical = serializeTransactionFilters(state);
    expect(canonical.getAll("month")).toEqual(["2027-01"]);
    expect(canonical.get("category")).toBe("Food");
    expect(canonical.get("platform")).toBe("Swiggy");
    expect(parseTransactionFilters(canonical, today)).toEqual(state);
    expect(
      serializeTransactionFilters(
        parseTransactionFilters(canonical, today),
      ).toString(),
    ).toBe(canonical.toString());
  });

  it("ignores orphan platforms and unsupported enum values safely", () => {
    expect(
      filters(
        "platform=Swiggy&kind=unknown&status=unknown&sort=unknown&account=all",
      ),
    ).toMatchObject({
      platform: "",
      kind: "all",
      status: "unknown",
      sort: "newest",
      account: "",
    });
    expect(
      view(workspace([record("entry")]), "status=unknown").transactions,
    ).toEqual([]);
    expect(
      serializeTransactionFilters(filters("status=unknown")).get("status"),
    ).toBe("unknown");
    expect(filters("category=Other&platform=Other")).toMatchObject({
      category: "Others",
      platform: "Others",
    });
  });

  it("round-trips exact-date scope without retaining a contradictory month restriction", () => {
    const source = filters(
      "date=2027-01-05&month=2026-12&period=all&category=Food&status=posted",
    );
    const params = serializeTransactionFilters(source);
    expect(params.get("date")).toBe("2027-01-05");
    expect(params.has("month")).toBe(false);
    expect(
      view(
        workspace([record("day", { occurredOn: "2027-01-05" })]),
        params.toString(),
      ).transactions.map((row) => row.id),
    ).toEqual(["day"]);
  });
});

describe("category to platform history filters", () => {
  it.each(["Food", "Shopping", "Groceries", "Stationery Items"])(
    "keeps Blinkit associated with its saved %s category",
    (category) => {
      const data = workspace([
        record("match", { category, platform: " BLINKIT " }),
        record("different-category", {
          category: "Health",
          platform: "Blinkit",
        }),
        record("different-platform", { category, platform: "Custom checkout" }),
      ]);
      const result = view(
        data,
        `category=${encodeURIComponent(category)}&platform=Blinkit`,
      );
      expect(result.transactions.map((row) => row.id)).toEqual(["match"]);
      expect(result.platformOptions).toContain("Blinkit");
      expect(result.summary.expenses).toBe("10.01");
    },
  );

  it.each([
    ["Transport", "IRCTC"],
    ["Shopping", "Amazon"],
    ["Stationery Items", "Amazon"],
  ])(
    "offers %s / %s without relabeling saved categories",
    (category, platform) => {
      expect(getHistoryPlatformSuggestions(category)).toContain(platform);
      expect(
        view(
          workspace([record("match", { category, platform })]),
          `category=${encodeURIComponent(category)}&platform=${platform}`,
        ).summary.expenseCount,
      ).toBe(1);
    },
  );

  it("groups custom, missing and saved Other platforms under exact Others without creating records", () => {
    const data = workspace([
      record("suggested", { platform: "Swiggy" }),
      record("custom", { platform: "Cake Country Checkout" }),
      record("missing", { platform: null }),
      record("blank", { platform: "  " }),
      record("legacy-other", { platform: "Other" }),
      record("other-category", {
        category: "Shopping",
        platform: "Cake Country Checkout",
      }),
    ]);
    const before = structuredClone(data);
    const result = view(data, "category=Food&platform=Others");
    expect(result.transactions.map((row) => row.id)).toEqual([
      "blank",
      "custom",
      "legacy-other",
      "missing",
    ]);
    expect(result.platformOptions).toContain("Cake Country Checkout");
    expect(
      result.platformOptions.filter((platform) => platform === "Others"),
    ).toHaveLength(1);
    expect(result.platformOptions).not.toContain("Other");
    expect(result.summary.expenses).toBe("40.04");
    expect(data).toEqual(before);
    expect(
      view(
        data,
        "category=Food&platform=Cake+Country+Checkout",
      ).transactions.map((row) => row.id),
    ).toEqual(["custom"]);
  });

  it("uses each category's suggestions for Others and never guesses category from platform", () => {
    const data = workspace([
      record("food-amazon", { category: "Food", platform: "Amazon" }),
      record("shopping-amazon", { category: "Shopping", platform: "Amazon" }),
    ]);
    expect(
      view(data, "category=Food&platform=Others").transactions.map(
        (row) => row.id,
      ),
    ).toEqual(["food-amazon"]);
    expect(
      view(data, "category=Shopping&platform=Others").transactions,
    ).toEqual([]);
    expect(isOtherHistoryPlatform("Food", "Amazon")).toBe(true);
    expect(isOtherHistoryPlatform("Shopping", "amazon")).toBe(false);
  });

  it("preserves legacy Stationery, Education, additional categories and saved custom platforms", () => {
    const data = workspace([
      record("legacy", { category: "Stationery", platform: "Classmate" }),
      record("education", { category: "Education", platform: "Coursera" }),
      record("custom", {
        category: "Community projects",
        platform: "Custom Portal",
      }),
    ]);
    const result = view(data);
    expect(result.categoryOptions).toEqual(
      expect.arrayContaining([
        "Stationery Items",
        "Education",
        "Community projects",
        "Others",
      ]),
    );
    expect(result.categoryOptions).not.toContain("Stationery");
    expect(
      view(data, "category=Stationery").transactions.map((row) => row.id),
    ).toEqual(["legacy"]);
    expect(
      view(data, "category=Stationery+Items").transactions.map((row) => row.id),
    ).toEqual(["legacy"]);
    expect(
      view(
        data,
        "category=community+PROJECTS&platform=custom+portal",
      ).transactions.map((row) => row.id),
    ).toEqual(["custom"]);
    expect(
      view(data, "category=community+PROJECTS&platform=custom+portal")
        .platformOptions,
    ).toContain("custom portal");
    expect(data.transactions.map((row) => row.category)).toEqual([
      "Stationery",
      "Education",
      "Community projects",
    ]);
  });

  it("deduplicates formatting variations and keeps a URL-selected category/platform selectable", () => {
    const result = view(
      workspace([
        record("a", { category: "Food", platform: "swiggy" }),
        record("b", { category: " food ", platform: " Swiggy " }),
        record("c", {
          category: "Community projects",
          platform: "Custom Portal",
        }),
      ]),
      "category=community+projects&platform=custom+portal",
    );
    expect(
      result.categoryOptions.filter(
        (category) => category.toLowerCase() === "community projects",
      ),
    ).toEqual(["community projects"]);
    expect(
      result.platformOptions.filter(
        (platform) => platform.toLowerCase() === "custom portal",
      ),
    ).toEqual(["custom portal"]);
    expect(
      view(
        workspace([
          record("a", { platform: "swiggy" }),
          record("b", { platform: " Swiggy " }),
        ]),
        "category=Food",
      ).platformOptions.filter(
        (platform) => platform.toLowerCase() === "swiggy",
      ),
    ).toEqual(["Swiggy"]);
  });

  it("does not alter the existing Add/Edit platform API or its legacy defaults", () => {
    expect(getCategoryPlatformOptions("Food")).toEqual([
      "Swiggy",
      "Zomato",
      "Domino's",
      "Other",
    ]);
    expect(getCategoryPlatformOptions("Stationery")).toContain("Classmate");
    expect(CATEGORY_PLATFORMS.Education).toContain("Coursera");
    expect(getHistoryPlatformSuggestions("__proto__")).toEqual([]);
  });
});

describe("canonical transaction summaries and list scoping", () => {
  const ledger = () =>
    workspace([
      record("purchase", {
        amount: "100.23",
        toAccountId: "wallet",
        merchant: "Cake Country",
        externalReference: "ORDER-ABC",
      }),
      record("pending", { amount: "900.00", status: "pending_review" }),
      record("void", { amount: "800.00", status: "voided" }),
      record("income", {
        amount: "1000.12",
        kind: "income",
        fromAccountId: null,
        toAccountId: "bank",
      }),
      record("transfer", {
        amount: "300.20",
        kind: "transfer",
        toAccountId: "wallet",
      }),
      record("external-transfer", {
        amount: "50.10",
        kind: "transfer",
        toAccountId: null,
        notes: "Confirmed external lender: Synthetic lender",
      }),
      record("repayment", {
        amount: "250.30",
        kind: "bill_payment",
        toAccountId: "card",
      }),
      record("adjustment", {
        amount: "600.00",
        kind: "adjustment",
        toAccountId: "card",
      }),
      record("refund", {
        amount: "40.00",
        kind: "refund",
        refundOfTransactionId: "purchase",
      }),
      record("previous", { amount: "55.55", occurredOn: "2027-01-31" }),
      record("undated", { amount: "999.00", occurredOn: null }),
      record("foreign", {
        amount: "99999.00",
        userId: "foreign-user",
        platform: "Private platform",
        category: "Private category",
      }),
    ]);

  it("separates posted dated expense, recognized income and transfer totals without signs or double repayment counting", () => {
    const data = ledger();
    const result = view(data);
    const canonical = monthlySummary(
      {
        ...data,
        transactions: data.transactions.filter((row) => row.userId === "owner"),
      },
      "2027-02",
    );
    expect(result.summary).toMatchObject({
      expenses: canonical.gross,
      income: canonical.income,
      transfers: "600.60",
      expenseCount: 1,
      incomeCount: 1,
      transferCount: 3,
      count: 9,
      pendingCount: 1,
      voidedCount: 1,
      undatedPostedCount: 0,
    });
    expect(result.summary.expenses).toBe("100.23");
    expect(result.summary.income).toBe("1000.12");
    expect(
      isTransferActivity(
        data.transactions.find((row) => row.id === "purchase")!,
      ),
    ).toBe(false);
    expect(
      isTransferActivity(
        data.transactions.find((row) => row.id === "adjustment")!,
      ),
    ).toBe(false);
  });

  it("keeps refund activity from becoming income or a negative expense, including cross-month capped refunds", () => {
    const data = workspace([
      record("old-purchase", { amount: "100.00", occurredOn: "2026-12-01" }),
      record("old-refund", {
        amount: "75.00",
        occurredOn: "2027-01-02",
        kind: "refund",
        refundOfTransactionId: "old-purchase",
      }),
      record("new-refund", {
        amount: "50.00",
        kind: "refund",
        refundOfTransactionId: "old-purchase",
      }),
      record("purchase", { amount: "20.00" }),
    ]);
    expect(monthlySummary(data, "2027-02")).toMatchObject({
      gross: "20.00",
      refunds: "25.00",
      net: "-5.00",
    });
    expect(view(data).summary).toMatchObject({
      expenses: "20.00",
      income: "0.00",
      count: 2,
    });
    expect(view(data, "kind=refund").summary).toMatchObject({
      expenses: "0.00",
      income: "0.00",
      count: 1,
    });
  });

  it("matches category/platform/search constraints in totals and preserves pending rows without treating them as expenses", () => {
    const result = view(
      ledger(),
      "kind=expense&category=Food&platform=Swiggy&q=order-abc",
    );
    expect(result.transactions.map((row) => row.id)).toEqual(["purchase"]);
    expect(result.summary).toMatchObject({
      expenses: "100.23",
      expenseCount: 1,
      count: 1,
    });
    expect(
      view(ledger(), "kind=expense&category=Food&platform=Swiggy").summary,
    ).toMatchObject({
      expenses: "100.23",
      expenseCount: 1,
      count: 3,
      pendingCount: 1,
      voidedCount: 1,
    });
    expect(
      view(ledger(), "kind=expense&status=pending_review").summary,
    ).toMatchObject({ expenses: "0.00", expenseCount: 0, count: 1 });
  });

  it("ignores retained category/platform filters on Transfer and Income while preserving explicit repayment links", () => {
    const data = ledger();
    expect(
      view(
        data,
        "kind=transfer&category=Missing&platform=Unrelated",
      ).transactions.map((row) => row.id),
    ).toEqual(["external-transfer", "repayment", "transfer"]);
    expect(
      view(data, "kind=income&category=Missing&platform=Unrelated").summary,
    ).toMatchObject({ income: "1000.12", incomeCount: 1, count: 1 });
    expect(
      view(data, "kind=bill_payment&category=Missing").transactions.map(
        (row) => row.id,
      ),
    ).toEqual(["repayment"]);
    expect(
      view(data, "kind=adjustment").transactions.map((row) => row.id),
    ).toEqual(["adjustment"]);
  });

  it("keeps exact ISO days/months and known totals across All dates, with undated records explicit", () => {
    const data = ledger();
    expect(
      view(data, "date=2027-01-31&period=all").transactions.map(
        (row) => row.id,
      ),
    ).toEqual(["previous"]);
    expect(view(data, "month=2027-01&period=all").summary).toMatchObject({
      expenses: "55.55",
      count: 1,
    });
    expect(view(data, "period=all").summary).toMatchObject({
      expenses: "155.78",
      income: "1000.12",
      undatedPostedCount: 1,
      count: 11,
    });
    expect(view(data, "period=all").transactions.at(-1)?.id).toBe("undated");
  });

  it("does not expose another owner's records, platform/category options, account metadata or totals", () => {
    const data = ledger();
    data.accounts = [
      {
        id: "foreign-bank",
        userId: "foreign-user",
        kind: "bank",
        name: "Private Account Name",
        institution: "Private institution",
        maskedSuffix: "1234",
        active: true,
      },
    ];
    const result = view(data, "period=all");
    expect(result.transactions.map((row) => row.id)).not.toContain("foreign");
    expect(result.categoryOptions).not.toContain("Private category");
    expect(view(data, "category=Food").platformOptions).not.toContain(
      "Private platform",
    );
    expect(view(data, "q=Private+Account+Name").transactions).toEqual([]);
    expect(
      getTransactionView(data, "", filters("period=all"), today).transactions,
    ).toEqual([]);
    expect(
      getTransactionView(data, "foreign-user", filters(), today).summary
        .expenses,
    ).toBe("99999.00");
  });

  it("searches saved merchant, description, platform, category, reference and metadata without mutating records", () => {
    const data = workspace([
      record("entry", {
        merchant: "Cake Country",
        description: "Anniversary cake",
        externalReference: "ORDER-42",
        sourceObjectId: "source-object",
        subcategory: "Celebrations",
        notes: "Leave at door",
        receiptDocumentId: "receipt-document",
        externalPayer: "Synthetic payer",
      }),
    ]);
    const original = structuredClone(data);
    for (const query of [
      "cake COUNTRY",
      "Anniversary",
      "Swiggy",
      "Food",
      "ORDER-42",
      "source-object",
      "Celebrations",
      "Leave at door",
      "receipt-document",
      "Synthetic payer",
    ]) {
      expect(
        view(data, `q=${encodeURIComponent(query)}`).transactions.map(
          (row) => row.id,
        ),
      ).toEqual(["entry"]);
    }
    expect(data).toEqual(original);
  });

  it("scopes account links without adding unrelated account records and honors status drilldowns", () => {
    expect(
      view(ledger(), "account=card").transactions.map((row) => row.id),
    ).toEqual(["adjustment", "repayment"]);
    expect(view(ledger(), "account=unavailable").transactions).toEqual([]);
    expect(
      view(ledger(), "status=posted&kind=expense").transactions.map(
        (row) => row.id,
      ),
    ).toEqual(["purchase"]);
  });

  it("orders both directions deterministically while keeping unconfirmed dates last", () => {
    const data = workspace([
      record("z", { occurredOn: "2027-01-03" }),
      record("a", { occurredOn: "2027-01-03" }),
      record("b", { occurredOn: "2027-01-01" }),
      record("undated", { occurredOn: null }),
    ]);
    expect(view(data, "period=all").transactions.map((row) => row.id)).toEqual([
      "a",
      "z",
      "b",
      "undated",
    ]);
    expect(
      view(data, "period=all&sort=oldest").transactions.map((row) => row.id),
    ).toEqual(["b", "a", "z", "undated"]);
    expect(data.transactions.map((row) => row.id)).toEqual([
      "z",
      "a",
      "b",
      "undated",
    ]);
  });

  it("keeps current and prior empty months selectable after choosing a historical month", () => {
    const result = view(
      workspace([record("old", { occurredOn: "2025-06-01" })]),
      "month=2025-06",
    );
    expect(result.monthOptions).toEqual(
      expect.arrayContaining(["2027-02", "2027-01", "2026-03", "2025-06"]),
    );
    expect(view(workspace(), "month=2026-12").summary).toMatchObject({
      expenses: "0.00",
      income: "0.00",
      transfers: "0.00",
      count: 0,
    });
  });
});
