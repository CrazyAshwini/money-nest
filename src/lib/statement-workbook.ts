import Decimal from "decimal.js";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "./imports";

export type StatementCell = string | number | boolean | Date | null;
export interface StatementWorkbook {
  sheets: { name: string; rows: StatementCell[][] }[];
}
export interface NormalizedStatementWorkbook {
  csv: string;
  rowNumbers: number[];
  errors: string[];
  warnings: string[];
  rowErrors: Record<number, string[]>;
  summary?: { firstDate: string; lastDate: string; closingBalance?: string };
}

const MAX_ZIP_ENTRIES = 256;
const MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_SHEETS = 5;
const MAX_SHEET_ROWS = 5_000;
const MAX_SHEET_COLUMNS = 64;
const MAX_SHEET_CELLS = 50_000;
const UNREADABLE =
  "This Excel statement could not be read. Use an unprotected .xlsx file exported by your bank, or export it as CSV.";

function fail(message = UNREADABLE): never {
  throw new Error(message);
}

/** Inspect archive bounds before any decompression or worksheet allocation. */
function inspectArchive(bytes: Uint8Array): Map<string, number> {
  if (
    bytes.length < 22 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 3 ||
    bytes[3] !== 4
  )
    fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65_558) &&
    view.getUint32(end, true) !== 0x06054b50
  )
    end--;
  if (end < Math.max(0, bytes.length - 65_558)) fail();
  if (
    end + 22 + view.getUint16(end + 20, true) !== bytes.length ||
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true)
  )
    fail();
  const count = view.getUint16(end + 10, true);
  if (
    !count ||
    count > MAX_ZIP_ENTRIES ||
    view.getUint16(end + 8, true) !== count
  )
    fail();
  const directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (offset + directorySize !== end) fail();
  const names = new Map<string, number>();
  let totalSize = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      fail();
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const originalSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const next =
      offset +
      46 +
      nameLength +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (
      flags & 1 ||
      (method !== 0 && method !== 8) ||
      next > end ||
      local + 30 > offset ||
      view.getUint32(local, true) !== 0x04034b50
    )
      fail();
    if (
      view.getUint16(local + 6, true) !== flags ||
      view.getUint16(local + 8, true) !== method
    )
      fail();
    const body =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    if (
      body + compressedSize > offset ||
      (method === 0 && compressedSize !== originalSize)
    )
      fail();
    const localCompressedSize = view.getUint32(local + 18, true);
    const localOriginalSize = view.getUint32(local + 22, true);
    if (
      !(flags & 8) &&
      (localCompressedSize !== compressedSize ||
        localOriginalSize !== originalSize)
    )
      fail();
    if (
      flags & 8 &&
      ((localCompressedSize && localCompressedSize !== compressedSize) ||
        (localOriginalSize && localOriginalSize !== originalSize))
    )
      fail();
    totalSize += originalSize;
    if (originalSize > MAX_ENTRY_BYTES || totalSize > MAX_UNCOMPRESSED_BYTES)
      fail(
        "This Excel file expands beyond the safe statement size limit. Export a smaller date range or use CSV.",
      );
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (
      !name ||
      names.has(name) ||
      name.includes("\\") ||
      name.startsWith("/") ||
      name.split("/").includes("..")
    )
      fail();
    const localName = new TextDecoder().decode(
      bytes.subarray(local + 30, local + 30 + view.getUint16(local + 26, true)),
    );
    if (localName !== name) fail();
    names.set(name, originalSize);
    offset = next;
  }
  if (
    offset !== end ||
    !names.has("xl/workbook.xml") ||
    !names.has("xl/_rels/workbook.xml.rels") ||
    !names.has("[Content_Types].xml")
  )
    fail();
  return names;
}

function columnNumber(letters: string): number {
  return [...letters].reduce(
    (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
    0,
  );
}

function inspectWorksheet(xml: string): void {
  if (/<(?:\w+:)?(?:f|sheetProtection)(?:\s|\/?>)/i.test(xml))
    fail(
      "Excel files with formulas or protected sheets are not supported. Export the bank's original statement or a CSV containing values only.",
    );
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail();
  let cells = 0;
  let rows = 0;
  for (const match of xml.matchAll(
    /<(?:\w+:)?(?:c|row|dimension)\b([^>]*)>/g,
  )) {
    if (/^<(?:\w+:)?c\b/.test(match[0]) && ++cells > MAX_SHEET_CELLS)
      fail(
        "This worksheet contains too many cells. Export a smaller date range.",
      );
    if (/^<(?:\w+:)?row\b/.test(match[0]) && ++rows > MAX_SHEET_ROWS)
      fail(
        "This worksheet contains too many rows. Export a smaller date range.",
      );
    const reference = /\b(?:r|ref)\s*=\s*["']([^"']+)["']/.exec(match[1])?.[1];
    if (!reference) continue;
    if (/^\d+$/.test(reference)) {
      if (Number(reference) > MAX_SHEET_ROWS || Number(reference) < 1)
        fail("This worksheet extends beyond the supported statement range.");
      continue;
    }
    for (const address of reference.split(":")) {
      const cell = /^([A-Z]{1,3})(\d{1,7})$/.exec(address);
      if (
        !cell ||
        Number(cell[2]) > MAX_SHEET_ROWS ||
        Number(cell[2]) < 1 ||
        columnNumber(cell[1]) > MAX_SHEET_COLUMNS
      )
        fail("This worksheet extends beyond the supported statement range.");
    }
  }
}

/** The parser stays on the device; no bank workbook is sent to an AI service. */
export async function readStatementWorkbook(
  file: File,
): Promise<StatementWorkbook> {
  if (!/\.xlsx$/i.test(file.name))
    fail(
      "Choose an .xlsx bank statement. Older .xls and password-protected files must be exported as .xlsx or CSV first.",
    );
  if (file.size > MAX_IMPORT_BYTES)
    fail("Excel statement exceeds the 2 MB upload limit.");
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_IMPORT_BYTES)
    fail("Excel statement exceeds the 2 MB upload limit.");
  try {
    const entrySizes = inspectArchive(new Uint8Array(buffer));
    const { unzipSync } = await import("fflate");
    const archive = unzipSync(new Uint8Array(buffer));
    let actualSize = 0;
    for (const [name, content] of Object.entries(archive)) {
      actualSize += content.byteLength;
      if (
        content.byteLength !== entrySizes.get(name) ||
        content.byteLength > MAX_ENTRY_BYTES ||
        actualSize > MAX_UNCOMPRESSED_BYTES
      )
        fail();
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const workbook = decoder.decode(archive["xl/workbook.xml"]);
    if (/<(?:\w+:)?workbookProtection\b|<!DOCTYPE|<!ENTITY/i.test(workbook))
      fail();
    const sheetCount = [...workbook.matchAll(/<(?:\w+:)?sheet\b/g)].length;
    if (!sheetCount || sheetCount > MAX_SHEETS)
      fail("Import an Excel statement containing at most five sheets.");
    for (const [name, content] of Object.entries(archive)) {
      if (!/\.xml$|\.rels$/i.test(name)) continue;
      const xml = decoder.decode(content);
      if (/<(?:\w+:)?worksheet\b/.test(xml)) inspectWorksheet(xml);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail();
    }
    const { readSheet } = await import("read-excel-file/browser");
    const sheets: StatementWorkbook["sheets"] = [];
    for (let index = 1; index <= sheetCount; index++) {
      const rows = await readSheet<string>(buffer, index, {
        parseNumber: (value) => {
          // Keep the exact decimal digits from the XML, including fractional cents.
          const decimal = new Decimal(value);
          return decimal.isFinite() && decimal.e <= 20 && decimal.e >= -20
            ? decimal.toFixed()
            : value;
        },
      });
      sheets.push({
        name: `Sheet ${index}`,
        rows: rows as unknown as StatementCell[][],
      });
    }
    return { sheets };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === UNREADABLE ||
        /^(This Excel|This worksheet|Excel files|Import an Excel)/.test(
          error.message,
        ))
    )
      throw error;
    fail();
  }
}

function text(value: StatementCell | undefined): string {
  return value === null || value === undefined
    ? ""
    : value instanceof Date
      ? ""
      : String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
}

function headerName(value: StatementCell | undefined): string {
  return text(value)
    .toLowerCase()
    .replace(/[./_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Columns = {
  date: number;
  description: number;
  debit: number;
  credit: number;
  reference?: number;
  balance?: number;
};
const aliases = {
  date: ["date", "txn date", "transaction date", "posting date", "value date"],
  description: [
    "details",
    "description",
    "narration",
    "particulars",
    "transaction details",
  ],
  debit: [
    "debit",
    "debit amount",
    "withdrawal",
    "withdrawals",
    "withdrawal amount",
    "withdrawals amount",
  ],
  credit: [
    "credit",
    "credit amount",
    "deposit",
    "deposits",
    "deposit amount",
    "deposits amount",
  ],
  reference: [
    "ref no cheque no",
    "reference",
    "reference no",
    "ref no",
    "cheque no",
    "chq no",
    "transaction id",
  ],
  balance: ["balance", "closing balance", "running balance"],
};

function headerColumns(row: StatementCell[]): Columns | null {
  const columns: Partial<Columns> = {};
  const headings = row.map(headerName);
  for (const [field, names] of Object.entries(aliases)) {
    const found = headings
      .map((heading, index) => (names.includes(heading) ? index : -1))
      .filter((index) => index >= 0);
    if (found.length > 1) return null;
    if (found.length) columns[field as keyof Columns] = found[0];
  }
  return [
    columns.date,
    columns.description,
    columns.debit,
    columns.credit,
  ].every((column) => column !== undefined)
    ? (columns as Columns)
    : null;
}

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1)
    return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
}

function statementDate(value: StatementCell | undefined): string | null {
  if (value instanceof Date)
    return Number.isNaN(value.getTime())
      ? null
      : validDate(
          value.getUTCFullYear(),
          value.getUTCMonth() + 1,
          value.getUTCDate(),
        );
  const input = text(value);
  let matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (matched)
    return validDate(
      Number(matched[1]),
      Number(matched[2]),
      Number(matched[3]),
    );
  matched = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input);
  if (matched)
    return validDate(
      Number(matched[3]),
      Number(matched[2]),
      Number(matched[1]),
    );
  matched = /^(\d{1,2})[ -]([A-Za-z]{3})[ -](\d{4})$/.exec(input);
  if (matched) {
    const month =
      [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ].indexOf(matched[2].toLowerCase()) + 1;
    return validDate(Number(matched[3]), month, Number(matched[1]));
  }
  return null;
}

function money(
  value: StatementCell | undefined,
  balance = false,
): string | null {
  let input = text(value);
  if (!input || input === "-" || input === "—") return balance ? null : "0.00";
  let negative = false;
  if (balance) {
    const suffix = /\s*(CR|DR)$/i.exec(input);
    if (suffix) {
      negative = suffix[1].toUpperCase() === "DR";
      input = input.slice(0, suffix.index).trim();
    }
  }
  input = input.replace(/^(?:₹|INR\s*|Rs\.?\s*)/i, "").trim();
  const parts = input.split(".");
  if (
    parts.length > 2 ||
    (parts[1] !== undefined && !/^\d{1,2}$/.test(parts[1]))
  )
    return null;
  if (
    parts[0].includes(",") &&
    !/^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})$/.test(parts[0])
  )
    return null;
  const integer = parts[0].replaceAll(",", "");
  if (!/^\d{1,12}$/.test(integer)) return null;
  const whole = integer.replace(/^0+(?=\d)/, "");
  const result = `${whole}.${(parts[1] ?? "").padEnd(2, "0")}`;
  return negative && result !== "0.00" ? `-${result}` : result;
}

function isSummaryLabel(value: string): boolean {
  return /^(?:(?:opening|closing|brought forward|carried forward)(?: balance)?|(?:grand )?totals?)(?:\s*[:-]\s*.*)?$/i.test(
    value,
  );
}

function isFooterLabel(value: string): boolean {
  return /^(?:end of (?:the )?statement|(?:this is (?:a )?)?computer[ -]generated|statement (?:generated|downloaded)|generated (?:on|by)|page \d+ (?:of|\/)|please (?:note|contact)|note\s*:|disclaimer\s*:)/i.test(
    value,
  );
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function normalizeStatementWorkbook(
  workbook: StatementWorkbook,
  accountId: string,
): NormalizedStatementWorkbook {
  const result: NormalizedStatementWorkbook = {
    csv: "",
    rowNumbers: [],
    errors: [],
    warnings: [],
    rowErrors: {},
  };
  if (!accountId.trim()) {
    result.errors.push(
      "Choose the bank account for this statement before reviewing it.",
    );
    return result;
  }
  const tables = workbook.sheets.flatMap((sheet) => {
    const index = sheet.rows
      .slice(0, 50)
      .findIndex((row) => Boolean(headerColumns(row)));
    return index < 0
      ? []
      : [{ sheet, index, columns: headerColumns(sheet.rows[index])! }];
  });
  if (tables.length !== 1) {
    result.errors.push(
      tables.length
        ? "More than one sheet contains bank transactions. Export one account's statement into a separate file."
        : "Could not find Date, Details/Description, Debit and Credit columns in the first 50 rows. Export the bank's transaction statement or use the CSV template.",
    );
    return result;
  }
  const { sheet, index, columns } = tables[0];
  const lines = [
    "date,description,amount,type,account,reference,category,currency,status",
  ];
  const datedBalances: { date: string; row: number; balance: string | null }[] =
    [];
  let explicitClosingBalance: string | null = null;
  let skipped = 0;
  for (let rowIndex = index + 1; rowIndex < sheet.rows.length; rowIndex++) {
    const row = sheet.rows[rowIndex];
    const rowNumber = rowIndex + 1;
    if (!row.some((cell) => cell instanceof Date || text(cell))) continue;
    const nonempty = row.filter((cell) => cell instanceof Date || text(cell));
    if (
      nonempty.length === 1 &&
      /^statement summary(?:\s*:\s*(?:\d{2}-\d{2}-\d{4}\s+to\s+\d{2}-\d{2}-\d{4})?)?$/i.test(
        text(nonempty[0]),
      )
    ) {
      result.warnings.push(
        "Stopped at the labeled Statement Summary section; summary totals and notices are not transactions.",
      );
      break;
    }
    const description = text(row[columns.description]);
    const dateValue = text(row[columns.date]);
    const date = statementDate(row[columns.date]);
    if (headerColumns(row)) {
      skipped++;
      continue;
    }
    const summary = isSummaryLabel(dateValue) || isSummaryLabel(description);
    const footer =
      !date && (isFooterLabel(dateValue) || isFooterLabel(description));
    if (summary || footer) {
      if (
        /^closing(?: balance)?(?:\s*[:-]|$)/i.test(dateValue) ||
        /^closing(?: balance)?(?:\s*[:-]|$)/i.test(description)
      )
        explicitClosingBalance = money(
          columns.balance === undefined ? undefined : row[columns.balance],
          true,
        );
      skipped++;
      continue;
    }
    if (result.rowNumbers.length >= MAX_IMPORT_ROWS) {
      result.errors.push(
        "Excel statement exceeds the 1,000-transaction import limit. Export a smaller date range.",
      );
      result.csv = "";
      return result;
    }
    const debit = money(row[columns.debit]);
    const credit = money(row[columns.credit]);
    const debitPositive = debit !== null && debit !== "0.00";
    const creditPositive = credit !== null && credit !== "0.00";
    const issues: string[] = [];
    if (!date)
      issues.push(
        "Date must be a real DD/MM/YYYY, DD Mon YYYY or YYYY-MM-DD calendar date; it was not guessed.",
      );
    if (!description)
      issues.push("The statement row has no transaction description.");
    if (debit === null || credit === null)
      issues.push(
        "Debit and Credit must contain exact INR amounts with no more than two decimal places; values were not rounded.",
      );
    if (debitPositive === creditPositive)
      issues.push(
        "Exactly one of Debit or Credit must be positive. The transaction direction was not guessed.",
      );
    const amount =
      debit !== null && credit !== null && debitPositive !== creditPositive
        ? debitPositive
          ? debit
          : credit
        : "";
    while (lines.length < rowNumber - 1) lines.push("");
    lines.push(
      [
        date ?? dateValue,
        description,
        amount,
        creditPositive && !debitPositive ? "income" : "expense",
        accountId,
        columns.reference === undefined ? "" : text(row[columns.reference]),
        "Other",
        "INR",
        "posted",
      ]
        .map(csvCell)
        .join(","),
    );
    result.rowNumbers.push(rowNumber);
    if (issues.length) result.rowErrors[rowNumber] = issues;
    if (date && !issues.length)
      datedBalances.push({
        date,
        row: rowNumber,
        balance:
          columns.balance === undefined
            ? null
            : money(row[columns.balance], true),
      });
  }
  if (!result.rowNumbers.length) {
    result.errors.push(
      "No transaction rows were found in this Excel statement.",
    );
    return result;
  }
  result.csv = lines.join("\n") + "\n";
  result.warnings.push(
    "Debit rows are expenses and credit rows are income by default. Review transfers, refunds and bill payments before importing.",
  );
  if (skipped)
    result.warnings.push(
      `Skipped ${skipped} labeled summary, repeated header or footer ${skipped === 1 ? "row" : "rows"}.`,
    );
  const dates = datedBalances.map(({ date }) => date).sort();
  if (dates.length) {
    const descending =
      datedBalances[0].date > datedBalances[datedBalances.length - 1].date;
    const finalRows = datedBalances.filter(
      (row) => row.date === dates[dates.length - 1],
    );
    const final = descending ? finalRows[0] : finalRows[finalRows.length - 1];
    const closingBalance = explicitClosingBalance ?? final.balance;
    result.summary = {
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      ...(closingBalance !== null ? { closingBalance } : {}),
    };
  }
  return result;
}
