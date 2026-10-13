import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { buildImportCommitPlan, parseStatementCsv } from "./imports";
import type { Account } from "./types";
import {
  normalizeStatementWorkbook,
  readStatementWorkbook,
  type StatementCell,
  type StatementWorkbook,
} from "./statement-workbook";

const header = [
  "Date",
  "Details",
  "Ref No/Cheque No",
  "Debit",
  "Credit",
  "Balance",
];
const account: Account = {
  id: "bank-1",
  userId: "owner-1",
  name: "Example Savings",
  institution: "Example Bank",
  kind: "bank",
  maskedSuffix: "1234",
  active: true,
};
const workbook = (rows: StatementCell[][]): StatementWorkbook => ({
  sheets: [{ name: "Statement", rows }],
});
const normalize = (rows: StatementCell[][]) =>
  normalizeStatementWorkbook(workbook([header, ...rows]), account.id);

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
}
function sheetXml(rows: StatementCell[][]): string {
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map(
      (row, index) =>
        `<row r="${index + 1}">${row
          .map((value, column) => {
            if (value === null) return "";
            const address = `${String.fromCharCode(65 + column)}${index + 1}`;
            return typeof value === "number"
              ? `<c r="${address}"><v>${value}</v></c>`
              : `<c r="${address}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("")}</sheetData></worksheet>`;
}
function excelBytes(
  sheets: string[] = [
    sheetXml([
      header,
      ["11/10/2026", "Example purchase", "REF-1", 20.4, null, "979.60 CR"],
    ]),
  ],
  extras: Record<string, Uint8Array> = {},
): Uint8Array {
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    ),
    "xl/workbook.xml": strToU8(
      `<workbook xmlns="${main}" xmlns:r="${rel}"><sheets>${sheets.map((_, index) => `<sheet name="Sheet ${index + 1}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`,
    ),
    ...extras,
  };
  for (const [index, sheet] of sheets.entries())
    entries[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet);
  return zipSync(entries);
}
function excelFile(bytes = excelBytes(), name = "statement.xlsx"): File {
  return new File([Uint8Array.from(bytes)], name);
}

describe("local Excel statement normalization", () => {
  it("finds the supplied bank layout after 17 metadata rows and preserves physical row numbers", async () => {
    const rows: StatementCell[][] = Array.from({ length: 17 }, () => [
      "Bank statement metadata",
    ]);
    rows.push(
      header,
      [
        "11/10/2026",
        'Example, "shop"\nPurchase',
        "000123",
        "1,23,456.70",
        "-",
        "₹2,00,000.30 CR",
      ],
      ["12/10/2026", "Example salary", "REF-2", null, "2,500", "202500.30 CR"],
      header,
      ["Closing Balance", "", "", "", "", "202500.30 CR"],
      ["This is a computer generated statement"],
    );
    const result = normalizeStatementWorkbook(workbook(rows), account.id);
    expect(result.errors).toEqual([]);
    expect(result.rowNumbers).toEqual([19, 20]);
    expect(result.summary).toEqual({
      firstDate: "2026-10-11",
      lastDate: "2026-10-12",
      closingBalance: "202500.30",
    });
    const review = await parseStatementCsv(result.csv, [account]);
    expect(review.errors).toEqual([]);
    expect(review.candidates.map((candidate) => candidate.rowNumber)).toEqual([
      19, 20,
    ]);
    expect(review.candidates[0].transaction).toMatchObject({
      amount: "123456.70",
      kind: "expense",
      fromAccountId: account.id,
      description: 'Example, "shop" Purchase',
      externalReference: "000123",
    });
    expect(review.candidates[1].transaction).toMatchObject({
      amount: "2500.00",
      kind: "income",
      toAccountId: account.id,
    });
    expect(result.warnings).toContain(
      "Skipped 3 labeled summary, repeated header or footer rows.",
    );
  });

  it("preserves exact references under the bank's dotted combined reference header", async () => {
    const result = normalizeStatementWorkbook(
      workbook([
        ["Date", "Details", "Ref No./Cheque No.", "Debit", "Credit", "Balance"],
        [
          "11/10/2026",
          "Example purchase",
          "000123-BANK.45",
          "20.40",
          null,
          "979.60 CR",
        ],
      ]),
      account.id,
    );
    expect(result.errors).toEqual([]);
    const review = await parseStatementCsv(result.csv, [account]);
    expect(review.candidates[0].transaction?.externalReference).toBe(
      "000123-BANK.45",
    );
    const plan = buildImportCommitPlan(review, [], { approved: true });
    expect(plan.transactions[0].externalReference).toBe("000123-BANK.45");
    const repeat = await parseStatementCsv(
      result.csv,
      [account],
      plan.transactions,
    );
    expect(repeat.candidates[0].status).toBe("existing_match");
  });

  it("accepts aliases and dates without locale or time-zone guessing", async () => {
    const result = normalizeStatementWorkbook(
      workbook([
        [
          "Txn Date",
          "Narration",
          "Reference No",
          "Withdrawal Amount",
          "Deposit Amount",
          "Running Balance",
        ],
        ["29 Feb 2028", "Leap purchase", "A", "100.40", "0", "100 CR"],
        ["2028-03-01", "Salary", "B", "—", "200", "300 CR"],
        [
          new Date("2028-03-02T00:00:00.000Z"),
          "Purchase",
          "C",
          "50",
          "-",
          "250 CR",
        ],
      ]),
      account.id,
    );
    const review = await parseStatementCsv(result.csv, [account]);
    expect(
      review.candidates.map((candidate) => candidate.transaction?.occurredOn),
    ).toEqual(["2028-02-29", "2028-03-01", "2028-03-02"]);
    expect(
      review.candidates.every((candidate) => candidate.status === "new"),
    ).toBe(true);
  });

  it.each([
    "31/04/2026",
    "29/02/2026",
    "10/13/2026",
    "13/10/26",
    "2026-1-01",
    "n/a",
    "",
  ])("retains invalid date %s as an unselected review row", async (date) => {
    const result = normalize([
      [date, "Example purchase", "R", "10", null, "100 CR"],
    ]);
    expect(result.rowNumbers).toEqual([2]);
    expect(result.rowErrors[2][0]).toContain("was not guessed");
    const review = await parseStatementCsv(result.csv, [account]);
    expect(review.candidates[0]).toMatchObject({
      selected: false,
      status: "needs_review",
    });
    expect(
      buildImportCommitPlan(review, [], { approved: true }).transactions,
    ).toEqual([]);
  });

  it.each([
    "10.001",
    "-10",
    "+10",
    "1,2,34",
    "USD 10",
    "NaN",
    "1e3",
    "1000000000000",
  ])(
    "preserves an invalid amount %s for review without rounding",
    async (amount) => {
      const result = normalize([
        ["11/10/2026", "Example purchase", "R", amount, null, "100 CR"],
      ]);
      expect(result.rowNumbers).toEqual([2]);
      expect(result.rowErrors[2]).toContain(
        "Debit and Credit must contain exact INR amounts with no more than two decimal places; values were not rounded.",
      );
      const review = await parseStatementCsv(result.csv, [account]);
      expect(review.candidates[0]).toMatchObject({
        selected: false,
        transaction: null,
      });
    },
  );

  it.each([
    ["20", "30"],
    ["0", "0"],
    [null, null],
  ])(
    "rejects ambiguous debit/credit direction %s/%s",
    async (debit, credit) => {
      const result = normalize([
        ["11/10/2026", "Example purchase", "R", debit, credit, "100 CR"],
      ]);
      expect(result.rowErrors[2]).toContain(
        "Exactly one of Debit or Credit must be positive. The transaction direction was not guessed.",
      );
      const review = await parseStatementCsv(result.csv, [account]);
      expect(review.candidates[0].selected).toBe(false);
      expect(
        buildImportCommitPlan(review, [], { approved: true }).transactions,
      ).toEqual([]);
    },
  );

  it("keeps malformed nonfooter rows instead of silently dropping them", async () => {
    const result = normalize([
      ["11/10/2026", "Valid", "R", "20", null, "100 CR"],
      ["Bad date", "Needs review", "Q", "30", null, "70 CR"],
      ["Unexpected footer"],
    ]);
    expect(result.rowNumbers).toEqual([2, 3, 4]);
    const review = await parseStatementCsv(result.csv, [account]);
    expect(review.candidates.map(({ status }) => status)).toEqual([
      "new",
      "needs_review",
      "needs_review",
    ]);
  });

  it("keeps running balances informational and imports transactions idempotently", async () => {
    const result = normalize([
      ["11/10/2026", "Example purchase", "R", "20.40", null, "100.10 CR"],
      ["12/10/2026", "Example salary", "Q", null, "50.50", "150.60 CR"],
    ]);
    const review = await parseStatementCsv(result.csv, [account]);
    const plan = buildImportCommitPlan(review, [], { approved: true });
    expect(plan.transactions).toHaveLength(2);
    expect(plan.transactions.map(({ amount }) => amount)).toEqual([
      "20.40",
      "50.50",
    ]);
    expect(
      plan.transactions.every((transaction) => !("balance" in transaction)),
    ).toBe(true);
    const repeat = await parseStatementCsv(
      result.csv,
      [account],
      plan.transactions,
    );
    expect(
      buildImportCommitPlan(repeat, plan.transactions, { approved: true })
        .transactions,
    ).toEqual([]);
  });

  it("uses the latest chronological balance from a descending statement and reads DR correctly", () => {
    const result = normalize([
      ["12/10/2026", "Latest", "R", "20", null, "100.10 DR"],
      ["11/10/2026", "Earlier", "Q", null, "50", "200 CR"],
    ]);
    expect(result.summary).toEqual({
      firstDate: "2026-10-11",
      lastDate: "2026-10-12",
      closingBalance: "-100.10",
    });
  });

  it("does not skip ordinary purchases whose descriptions merely mention totals", () => {
    const result = normalize([
      ["11/10/2026", "Total supermarket", "R", "20", null, "100 CR"],
    ]);
    expect(result.rowNumbers).toEqual([2]);
  });

  it.each([
    "Statement Summary",
    "Statement Summary :",
    "Statement Summary : 01-10-2026 To 13-10-2026",
  ])(
    "ends the transaction table at standalone summary marker %s",
    async (marker) => {
      const result = normalize([
        ["11/10/2026", "Example purchase", "R", "20.40", null, "979.60 CR"],
        [marker],
        ["Dr Count", "Cr Count", "Debits", "Credits", "Closing Balance"],
        [1, 0, "20.40", "0.00", "979.60 CR"],
        [],
        ["Please contact the bank for assistance."],
        ["Please check your statement."],
      ]);
      expect(result.rowNumbers).toEqual([2]);
      expect(result.rowErrors).toEqual({});
      expect(result.summary?.closingBalance).toBe("979.60");
      const review = await parseStatementCsv(result.csv, [account]);
      expect(review.candidates).toHaveLength(1);
      expect(review.candidates[0].status).toBe("new");
    },
  );

  it("keeps dated transactions whose merchant happens to be named Statement Summary", async () => {
    const result = normalize([
      ["11/10/2026", "Statement Summary", "R", "20.40", null, "979.60 CR"],
      ["12/10/2026", "Example purchase", "Q", "10", null, "969.60 CR"],
    ]);
    expect(result.rowNumbers).toEqual([2, 3]);
    expect(result.rowErrors).toEqual({});
    const review = await parseStatementCsv(result.csv, [account]);
    expect(review.candidates).toHaveLength(2);
    expect(
      review.candidates.every((candidate) => candidate.status === "new"),
    ).toBe(true);
  });

  it("requires a bank selection, an early recognizable header and exactly one transaction sheet", () => {
    expect(
      normalizeStatementWorkbook(workbook([header]), "").errors[0],
    ).toContain("Choose the bank account");
    expect(
      normalizeStatementWorkbook(
        workbook(
          Array.from({ length: 51 }, (): StatementCell[] => []).concat([
            header,
          ]),
        ),
        account.id,
      ).errors[0],
    ).toContain("first 50 rows");
    const multi = {
      sheets: [
        { name: "One", rows: [header] },
        { name: "Two", rows: [header] },
      ],
    };
    expect(normalizeStatementWorkbook(multi, account.id).errors[0]).toContain(
      "More than one sheet",
    );
    expect(normalize([]).errors[0]).toContain("No transaction rows");
  });

  it("bounds transaction count while allowing metadata and blank physical rows", () => {
    const result = normalize(
      Array.from({ length: 1_001 }, () => [
        "11/10/2026",
        "Example purchase",
        "R",
        "10",
        null,
        "100 CR",
      ]),
    );
    expect(result.errors[0]).toContain("1,000-transaction");
    expect(result.csv).toBe("");
  });
});

describe("bounded browser Excel reader", () => {
  it("reads a genuine synthetic OOXML workbook with exact numeric strings", async () => {
    const xml = sheetXml([
      header,
      ["11/10/2026", "Example purchase", "R", null, null, "100 CR"],
    ]).replace('<c r="F2"', '<c r="D2"><v>999999999999.99</v></c><c r="F2"');
    const parsed = await readStatementWorkbook(excelFile(excelBytes([xml])));
    expect(parsed.sheets[0].rows[1][3]).toBe("999999999999.99");
    const normalized = normalizeStatementWorkbook(parsed, account.id);
    expect(normalized.rowErrors).toEqual({});
    const review = await parseStatementCsv(normalized.csv, [account]);
    expect(review.candidates[0].transaction?.amount).toBe("999999999999.99");
  });

  it("retains fractional cents from numeric XML as invalid instead of rounding them", async () => {
    const xml = sheetXml([
      header,
      ["11/10/2026", "Example purchase", "R", null, null, "100 CR"],
    ]).replace('<c r="F2"', '<c r="D2"><v>1.0000000000000001</v></c><c r="F2"');
    const parsed = await readStatementWorkbook(excelFile(excelBytes([xml])));
    expect(parsed.sheets[0].rows[1][3]).toBe("1.0000000000000001");
    expect(
      normalizeStatementWorkbook(parsed, account.id).rowErrors[2],
    ).toHaveLength(2);
  });

  it("reads Excel styled dates with UTC calendar fields", async () => {
    const xml = sheetXml([
      header,
      ["unused", "Example purchase", "R", 20.4, null, "100 CR"],
    ]).replace(
      '<c r="A2" t="inlineStr"><is><t>unused</t></is></c>',
      '<c r="A2" s="1"><v>46306</v></c>',
    );
    const styles =
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>';
    const bytes = excelBytes([xml], { "xl/styles.xml": strToU8(styles) });
    // Add a styles relationship so the reader can recognize numeric date cells.
    const { unzipSync } = await import("fflate");
    const archive = unzipSync(bytes);
    archive["xl/_rels/workbook.xml.rels"] = strToU8(
      new TextDecoder()
        .decode(archive["xl/_rels/workbook.xml.rels"])
        .replace(
          "</Relationships>",
          '<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        ),
    );
    const parsed = await readStatementWorkbook(excelFile(zipSync(archive)));
    expect(parsed.sheets[0].rows[1][0]).toBeInstanceOf(Date);
    const review = await parseStatementCsv(
      normalizeStatementWorkbook(parsed, account.id).csv,
      [account],
    );
    expect(review.candidates[0].transaction?.occurredOn).toBe("2026-10-11");
  });

  it.each(["statement.xls", "statement.csv", "statement.pdf"])(
    "rejects unsupported extension %s",
    async (name) => {
      await expect(
        readStatementWorkbook(excelFile(excelBytes(), name)),
      ).rejects.toThrow("Choose an .xlsx");
    },
  );

  it("rejects oversized files before reading them", async () => {
    const file = excelFile();
    Object.defineProperty(file, "size", { value: 2 * 1024 * 1024 + 1 });
    Object.defineProperty(file, "arrayBuffer", {
      value: () => {
        throw new Error("must not read");
      },
    });
    await expect(readStatementWorkbook(file)).rejects.toThrow("2 MB");
  });

  it.each([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), new Uint8Array(40)])(
    "rejects encrypted OLE or non-ZIP content without exposing parser internals",
    async (bytes) => {
      await expect(readStatementWorkbook(excelFile(bytes))).rejects.toThrow(
        "could not be read",
      );
    },
  );

  it("rejects corrupted archive directories", async () => {
    const bytes = excelBytes();
    bytes[bytes.length - 22] = 0;
    await expect(readStatementWorkbook(excelFile(bytes))).rejects.toThrow(
      "could not be read",
    );
  });

  it("rejects local archive sizes inconsistent with the directory", async () => {
    const bytes = excelBytes();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(22, 0xffffffff, true);
    await expect(readStatementWorkbook(excelFile(bytes))).rejects.toThrow(
      "could not be read",
    );
  });

  it("rejects encrypted ZIP entries before decompressing them", async () => {
    const bytes = excelBytes();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(6, 1, true);
    const central = view.getUint32(bytes.length - 6, true);
    view.setUint16(central + 8, 1, true);
    await expect(readStatementWorkbook(excelFile(bytes))).rejects.toThrow(
      "could not be read",
    );
  });

  it("rejects archive expansion beyond an entry or total limit before inflation", async () => {
    const tooLarge = excelBytes(undefined, {
      "padding.bin": new Uint8Array(8 * 1024 * 1024 + 1),
    });
    await expect(readStatementWorkbook(excelFile(tooLarge))).rejects.toThrow(
      "safe statement size limit",
    );
    const total = excelBytes(undefined, {
      "one.bin": new Uint8Array(8 * 1024 * 1024),
      "two.bin": new Uint8Array(8 * 1024 * 1024),
    });
    await expect(readStatementWorkbook(excelFile(total))).rejects.toThrow(
      "safe statement size limit",
    );
  });

  it.each([
    '<worksheet><sheetData><row r="5001"/></sheetData></worksheet>',
    '<worksheet><sheetData><row r="1"><c r="XFD1"/></row></sheetData></worksheet>',
    '<worksheet><dimension ref="A1:A1048576"/><sheetData/></worksheet>',
  ])(
    "rejects sparse worksheet coordinates before row allocation",
    async (xml) => {
      await expect(
        readStatementWorkbook(excelFile(excelBytes([xml]))),
      ).rejects.toThrow("supported statement range");
    },
  );

  it.each([
    '<worksheet><sheetData><row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>',
    '<worksheet><sheetProtection password="0000"/><sheetData/></worksheet>',
  ])(
    "rejects formula or protected sheets without executing anything",
    async (xml) => {
      await expect(
        readStatementWorkbook(excelFile(excelBytes([xml]))),
      ).rejects.toThrow("formulas or protected sheets");
    },
  );

  it("rejects XML entities and too many sheets", async () => {
    await expect(
      readStatementWorkbook(
        excelFile(
          excelBytes([
            '<!DOCTYPE worksheet [<!ENTITY a "example">]><worksheet><sheetData/></worksheet>',
          ]),
        ),
      ),
    ).rejects.toThrow("could not be read");
    await expect(
      readStatementWorkbook(
        excelFile(
          excelBytes(Array.from({ length: 6 }, () => sheetXml([header]))),
        ),
      ),
    ).rejects.toThrow("at most five sheets");
  });
});
