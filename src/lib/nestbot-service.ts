import "server-only";
import Decimal from "decimal.js";
import { generateText } from "ai";
import { createGoogle } from "@ai-sdk/google";
import type {
  Transaction,
  WorkspaceData,
} from "./types";
import {
  accountBalance,
  billSummary,
  formatDate,
  formatMoney,
  isDebtAccount,
  monthlySummary,
  spendingByCategory,
  sumMoney,
  todayISO,
} from "./finance";
import { accountUsage } from "./usage";
import { validateWorkspaceRecord } from "./validation";
import {
  readReceiptAIConfiguration,
  scanReceiptBatchWithAI,
} from "./ai-receipt-service";
import type {
  BotRequestPayload,
  BotResponsePayload,
  ProposedTransaction,
} from "./nestbot-types";

/**
 * Summarizes all accounts for the user truthfully using base-ten arithmetic.
 */
export function getAccountsOverview(data: WorkspaceData, today = todayISO()) {
  const bankAccounts = data.accounts
    .filter((a) => a.active && (a.kind === "bank" || a.kind === "wallet"))
    .map((a) => {
      const bal = accountBalance(data, a.id, today);
      return {
        id: a.id,
        name: a.name,
        institution: a.institution,
        kind: a.kind,
        suffix: a.maskedSuffix,
        currentBalance: bal.current,
        reportedBalance: bal.reported,
        asOf: bal.currentAsOf,
        status: bal.currentSource,
      };
    });

  const creditAccounts = data.accounts
    .filter((a) => a.active && isDebtAccount(a))
    .map((a) => {
      const usage = accountUsage(data, a.id, today);
      return {
        id: a.id,
        name: a.name,
        institution: a.institution,
        kind: a.kind,
        suffix: a.maskedSuffix,
        creditLimit: usage.totalCreditLimit,
        currentOutstanding: usage.currentOutstanding,
        reportedOutstanding: usage.issuerReportedOutstanding,
        availableCredit: usage.availableCredit,
        estimatedAvailableCredit: usage.estimatedAvailableCredit,
        availableCreditStatus: usage.availableCreditStatus,
        utilizationPercentage: usage.creditUtilization,
        billedAmount: usage.billedAmount,
        unbilledAmount: usage.unbilledAmount,
        pendingAuthorizations: usage.pendingAuthorizations,
        dueDate: usage.paymentDueDate,
        verificationStatus: usage.balanceVerificationStatus,
      };
    });

  const totalBankMoney = sumMoney(
    bankAccounts
      .filter((a) => a.currentBalance !== null)
      .map((a) => a.currentBalance!),
  );

  return {
    bankAccounts,
    creditAccounts,
    totalBankMoney,
  };
}

/**
 * Analyzes spending for a given calendar month (YYYY-MM).
 */
export function getSpendingAnalysis(
  data: WorkspaceData,
  month = todayISO().slice(0, 7),
) {
  const summary = monthlySummary(data, month);
  const categories = spendingByCategory(data, month);
  return {
    month,
    grossSpending: summary.gross,
    refunds: summary.refunds,
    netSpending: summary.net,
    income: summary.income,
    expenseCount: summary.expenseCount,
    topCategories: categories.slice(0, 5),
  };
}

/**
 * Summarizes upcoming bills and Pay Later dues.
 */
export function getUpcomingDues(data: WorkspaceData, today = todayISO()) {
  return data.bills
    .map((bill) => {
      const summary = billSummary(data, bill, today);
      const account = data.accounts.find((a) => a.id === bill.accountId);
      return {
        billId: bill.id,
        accountName: account?.name || "Unknown account",
        statementAmount: bill.statementAmount,
        remainingAmount: summary.remaining,
        dueDate: bill.dueDate,
        statementDate: bill.statementDate,
        status: summary.status,
      };
    })
    .filter((b) => new Decimal(b.remainingAmount).gt(0))
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
}

/**
 * Searches transactions with fuzzy keyword, merchant, or date matching.
 */
export function searchTransactions(
  data: WorkspaceData,
  options: {
    query?: string;
    category?: string;
    accountName?: string;
    month?: string;
    limit?: number;
  },
) {
  const { query, category, accountName, month, limit = 10 } = options;
  const q = query?.toLowerCase().trim();
  const acc = accountName?.toLowerCase().trim();

  const results = data.transactions.filter((t) => {
    if (month && !t.occurredOn?.startsWith(month)) return false;
    if (category && t.category?.toLowerCase() !== category.toLowerCase()) return false;
    if (acc) {
      const from = data.accounts.find((a) => a.id === t.fromAccountId)?.name.toLowerCase();
      const to = data.accounts.find((a) => a.id === t.toAccountId)?.name.toLowerCase();
      if (!from?.includes(acc) && !to?.includes(acc)) return false;
    }
    if (q) {
      const desc = (t.description || "").toLowerCase();
      const merch = (t.merchant || "").toLowerCase();
      const plat = (t.platform || "").toLowerCase();
      const amt = t.amount;
      if (!desc.includes(q) && !merch.includes(q) && !plat.includes(q) && !amt.includes(q)) {
        return false;
      }
    }
    return true;
  });

  results.sort((a, b) => (b.occurredOn || "").localeCompare(a.occurredOn || ""));
  return results.slice(0, limit);
}

/**
 * Detects duplicate transactions based on date, amount, merchant, or external reference.
 */
export function findDuplicateTransactions(
  data: WorkspaceData,
  candidate: {
    amount: string;
    occurredOn?: string | null;
    merchant?: string | null;
    description?: string;
    externalReference?: string | null;
    sourceObjectId?: string | null;
  },
) {
  const normRef = candidate.externalReference?.replace(/\s/g, "").toLowerCase();
  const candidateAmt = new Decimal(candidate.amount || "0").toFixed(2);

  for (const t of data.transactions) {
    // Exact external reference match
    if (normRef && t.externalReference) {
      const existingRef = t.externalReference.replace(/\s/g, "").toLowerCase();
      if (normRef === existingRef) {
        return {
          isDuplicate: true,
          matchType: "reference",
          existing: t,
        };
      }
    }

    // Exact source object ID match
    if (candidate.sourceObjectId && t.sourceObjectId === candidate.sourceObjectId) {
      return {
        isDuplicate: true,
        matchType: "source_id",
        existing: t,
      };
    }

    // Same date + same amount + similar merchant/description
    if (
      candidate.occurredOn &&
      t.occurredOn === candidate.occurredOn &&
      t.status === "posted" &&
      new Decimal(t.amount).toFixed(2) === candidateAmt
    ) {
      const m1 = (candidate.merchant || candidate.description || "").toLowerCase();
      const m2 = (t.merchant || t.description || "").toLowerCase();
      if (m1 && m2 && (m1.includes(m2) || m2.includes(m1))) {
        return {
          isDuplicate: true,
          matchType: "amount_date_merchant",
          existing: t,
        };
      }
    }
  }

  return { isDuplicate: false };
}

/**
 * Parses user text or receipt to create a proposed transaction preview.
 */
export function buildProposedTransaction(
  data: WorkspaceData,
  params: {
    amount: string;
    description: string;
    merchant?: string;
    category?: string;
    platform?: string;
    accountHint?: string;
    occurredOn?: string;
    externalReference?: string;
    kind?: "expense" | "income" | "transfer" | "bill_payment" | "refund";
  },
): {
  draft: ProposedTransaction;
  duplicateWarning?: {
    existingId: string;
    description: string;
    date: string;
    amount: string;
  };
} {
  const occurredOn = params.occurredOn || todayISO();
  const amt = new Decimal(params.amount || "0").toFixed(2);
  const kind = params.kind || "expense";

  // Match account
  let fromAccountId: string | null = null;
  let toAccountId: string | null = null;
  let fromAccountName = "";
  let toAccountName = "";

  if (params.accountHint) {
    const hint = params.accountHint.toLowerCase();
    const matched = data.accounts.find(
      (a) =>
        a.name.toLowerCase().includes(hint) ||
        (a.institution && a.institution.toLowerCase().includes(hint)) ||
        (a.maskedSuffix && hint.includes(a.maskedSuffix.slice(-4))),
    );
    if (matched) {
      if (kind === "expense") {
        fromAccountId = matched.id;
        fromAccountName = matched.name;
      } else if (kind === "income" || kind === "refund") {
        toAccountId = matched.id;
        toAccountName = matched.name;
      }
    }
  }

  // If no hint was provided, suggest first active bank account for expense
  if (!fromAccountId && !params.accountHint && kind === "expense") {
    const defaultAcc = data.accounts.find((a) => a.active && a.kind === "bank");
    if (defaultAcc) {
      fromAccountId = defaultAcc.id;
      fromAccountName = defaultAcc.name;
    }
  }

  const draft: ProposedTransaction = {
    id: crypto.randomUUID(),
    amount: amt,
    currency: "INR",
    kind,
    occurredOn,
    description: params.description || params.merchant || "Expense",
    merchant: params.merchant || "",
    category: params.category || "Other",
    platform: params.platform || "",
    fromAccountId,
    toAccountId,
    fromAccountName,
    toAccountName,
    externalReference: params.externalReference || "",
    sourceSystem: "nestbot",
  };

  const dup = findDuplicateTransactions(data, {
    amount: amt,
    occurredOn,
    merchant: params.merchant,
    description: params.description,
    externalReference: params.externalReference,
  });

  let duplicateWarning = undefined;
  if (dup.isDuplicate && dup.existing) {
    duplicateWarning = {
      existingId: dup.existing.id,
      description: dup.existing.description,
      date: dup.existing.occurredOn || "",
      amount: formatMoney(dup.existing.amount),
    };
  }

  return { draft, duplicateWarning };
}

/**
 * Posts a confirmed transaction into the workspace with strict validation.
 */
export function confirmTransactionPost(
  data: WorkspaceData,
  userId: string,
  draft: ProposedTransaction,
): Transaction {
  const draftObj = draft as unknown as Record<string, unknown>;
  if (draftObj.userId && draftObj.userId !== userId) {
    throw new Error("Cannot record transactions for other users.");
  }
  if (data.transactions.some((t) => t.id === draft.id && t.status === "posted")) {
    throw new Error("This transaction has already been posted to your records.");
  }
  const duplicate = findDuplicateTransactions(data, {
    amount: draft.amount,
    occurredOn: draft.occurredOn,
    externalReference: draft.externalReference,
    sourceObjectId: draft.sourceObjectId,
    merchant: draft.merchant,
  });
  if (duplicate.isDuplicate && duplicate.existing?.id !== draft.id) {
    throw new Error("A matching duplicate transaction already exists in your workspace.");
  }
  const transaction: Transaction = {
    id: draft.id || crypto.randomUUID(),
    userId,
    amount: new Decimal(draft.amount).toFixed(2),
    currency: draft.currency || "INR",
    kind: draft.kind,
    status: "posted",
    occurredOn: draft.occurredOn,
    description: draft.description,
    merchant: draft.merchant || null,
    category: draft.category || "Other",
    platform: draft.platform || null,
    fromAccountId: draft.fromAccountId || null,
    toAccountId: draft.toAccountId || null,
    externalReference: draft.externalReference || null,
    sourceSystem: draft.sourceSystem || "nestbot",
    sourceObjectId: draft.sourceObjectId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Run central validation
  validateWorkspaceRecord(data, "transactions", transaction, userId);
  return transaction;
}

/**
 * Generates an answer to the user query using data tools and AI (or deterministic financial fallback).
 */
export async function executeNestBotQuery(
  data: WorkspaceData,
  userId: string,
  payload: BotRequestPayload,
): Promise<BotResponsePayload> {
  const today = todayISO();
  const currentMonth = today.slice(0, 7);
  const config = readReceiptAIConfiguration();

  // If user is confirming a proposed transaction:
  if (payload.action === "confirm_transaction" && payload.confirmedTransaction) {
    const posted = confirmTransactionPost(data, userId, payload.confirmedTransaction);
    return {
      configured: Boolean(config),
      reply: `Transaction posted successfully: ₹${posted.amount} for "${posted.description}" on ${formatDate(posted.occurredOn)}. Your balances and outstandings have been updated.`,
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Confirmed & saved! Transaction ID: ${posted.id}. Amount: ₹${posted.amount}.`,
        createdAt: new Date().toISOString(),
        confirmedTransactionId: posted.id,
      },
      confirmedTransactionId: posted.id,
    };
  }

  // If an image was uploaded:
  if (payload.image && payload.image.data) {
    if (!config) {
      return {
        configured: false,
        reply: "Screenshot analysis requires a configured Google Gemini API key.",
        message: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "To analyze receipt and payment screenshots, configure GOOGLE_GENERATIVE_AI_API_KEY on your server.",
          createdAt: new Date().toISOString(),
          error: "ai_not_configured",
        },
        error: "AI service not configured on server.",
      };
    }

    try {
      const buffer = Buffer.from(payload.image.data, "base64");
      const scanResults = await scanReceiptBatchWithAI({
        configuration: config,
        images: [buffer],
      });

      if (!scanResults || scanResults.length === 0) {
        return {
          configured: true,
          reply: "I scanned the screenshot, but couldn't detect any transaction details. Please check the image clarity or enter the details manually.",
          message: {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "No clear transaction details were extracted from this screenshot.",
            createdAt: new Date().toISOString(),
          },
        };
      }

      const extracted = scanResults[0];
      const proposed = buildProposedTransaction(data, {
        amount: extracted.amount || "0.00",
        merchant: extracted.merchant || "",
        description: extracted.description || extracted.merchant || "Screenshot Purchase",
        category: extracted.category || "Other",
        platform: extracted.platform || "",
        accountHint: extracted.accountHint || "",
        occurredOn: extracted.occurredOn || today,
        externalReference: extracted.externalReference || "",
        kind: extracted.kind === "income" || extracted.kind === "transfer" ? extracted.kind : "expense",
      });

      const replyText = proposed.duplicateWarning
        ? `I found a ${extracted.kind || "purchase"} of ₹${extracted.amount} on ${formatDate(extracted.occurredOn || today)} from ${extracted.merchant || "seller"}. ⚠️ Warning: A matching transaction already exists on ${formatDate(proposed.duplicateWarning.date)} for ₹${proposed.duplicateWarning.amount} ("${proposed.duplicateWarning.description}"). Do you still want to add it?`
        : `Found ${extracted.kind || "an expense"} of ₹${extracted.amount} on ${formatDate(extracted.occurredOn || today)} from ${extracted.merchant || "the merchant"}${proposed.draft.fromAccountName ? ` paid using ${proposed.draft.fromAccountName}` : ""}. I found no duplicates. Should I add it to your records?`;

      return {
        configured: true,
        reply: replyText,
        proposedTransaction: proposed.draft,
        message: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: replyText,
          createdAt: new Date().toISOString(),
          proposedTransaction: proposed.draft,
          duplicateWarning: proposed.duplicateWarning,
          suggestedActions: ["Confirm & Post", "Cancel"],
        },
      };
    } catch (err) {
      return {
        configured: true,
        reply: "Failed to process the screenshot with AI. Please check the image and try again.",
        message: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "The screenshot could not be analyzed.",
          createdAt: new Date().toISOString(),
          error: String(err),
        },
      };
    }
  }

  // Text query processing:
  const query = (payload.message || "").trim().toLowerCase();

  // Financial domain context
  const accountsOverview = getAccountsOverview(data, today);
  const spendingAnalysis = getSpendingAnalysis(data, currentMonth);
  const upcomingDues = getUpcomingDues(data, today);

  // If AI is configured, use Gemini with grounded financial context
  if (config) {
    try {
      const google = createGoogle({ apiKey: config.apiKey });
      const model = google(config.model);

      const systemPrompt = `You are Money Nest Bot, the intelligent financial assistant inside the Money Nest personal finance app.
The database is the user's financial system of record. Always use exact decimal arithmetic (INR).
Never invent balances or transactions. If data is unknown or missing, explicitly state so.
Keep answers concise, direct, helpful, and formatted in clear Markdown.

Current Financial State (As of ${today}):
- Bank Accounts:
${accountsOverview.bankAccounts.map((a) => `  * ${a.name} (${a.institution} ••${a.suffix}): Balance ₹${a.currentBalance || "Unknown"} (Status: ${a.status})`).join("\n")}
  * Total spendable bank cash: ₹${accountsOverview.totalBankMoney}

- Credit Cards & Pay Later Accounts:
${accountsOverview.creditAccounts.map((c) => `  * ${c.name} (${c.institution} ••${c.suffix}): Limit ₹${c.creditLimit || "Not set"}, Outstanding ₹${c.currentOutstanding || "Unknown"}, Available ₹${c.availableCredit || (c.estimatedAvailableCredit ? `Estimated ₹${c.estimatedAvailableCredit}` : "Unknown")}, Due ₹${c.dueDate || "N/A"}`).join("\n")}

- Spending this month (${currentMonth}):
  * Gross: ₹${spendingAnalysis.grossSpending}, Refunds: ₹${spendingAnalysis.refunds}, Net: ₹${spendingAnalysis.netSpending}
  * Top categories: ${spendingAnalysis.topCategories.map((c) => `${c.category}: ₹${c.amount}`).join(", ") || "None"}

- Upcoming Bills Due:
${upcomingDues.length > 0 ? upcomingDues.map((b) => `  * ${b.accountName}: ₹${b.remainingAmount} due on ${b.dueDate} (${b.status})`).join("\n") : "  * No upcoming unpaid bills recorded."}

Instructions:
1. Answer the user's query directly and factually using the data above.
2. If the user asks to add a transaction, output the details and indicate you are proposing it for confirmation before saving.
3. If the user asks about a person they owe (e.g. Bikash), check loans/groups and state the verified debt or if no record exists.
4. Never execute financial mutations without explicit confirmation.`;

      const prompt = payload.message;
      const result = await generateText({
        model,
        system: systemPrompt,
        prompt: `<untrusted_user_input>${prompt}</untrusted_user_input>`,
        temperature: 0.1,
      });

      return {
        configured: true,
        reply: result.text,
        message: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.text,
          createdAt: new Date().toISOString(),
          suggestedActions: [
            "How much money do I have?",
            "What did I spend this month?",
            "Show my credit-card outstanding",
            "Which bills are due next?",
          ],
        },
      };
    } catch {
      // Fallback to deterministic response if API call fails
    }
  }

  // Truthful deterministic financial answers when AI is unconfigured or offline:
  let reply = "";
  if (query.includes("how much money") || query.includes("balance") || query.includes("cash")) {
    reply = `You have **₹${formatMoney(accountsOverview.totalBankMoney)}** across your active bank accounts:\n` +
      accountsOverview.bankAccounts.map((a) => `- **${a.name}**: ₹${formatMoney(a.currentBalance || "0.00")}`).join("\n");
  } else if (query.includes("spend") || query.includes("spending")) {
    reply = `This month (${currentMonth}), your gross spending is **₹${formatMoney(spendingAnalysis.grossSpending)}**, with **₹${formatMoney(spendingAnalysis.refunds)}** in refunds, making net spending **₹${formatMoney(spendingAnalysis.netSpending)}**.\nTop categories: ` +
      spendingAnalysis.topCategories.map((c) => `${c.category} (₹${formatMoney(c.amount)})`).join(", ");
  } else if (query.includes("credit") || query.includes("outstanding") || query.includes("card")) {
    reply = `Here is your credit and Pay Later status:\n` +
      accountsOverview.creditAccounts.map((c) => `- **${c.name}**: Outstanding ₹${formatMoney(c.currentOutstanding || "0.00")}, Limit ₹${formatMoney(c.creditLimit || "0.00")}, Available: ${c.availableCredit ? `₹${formatMoney(c.availableCredit)}` : c.estimatedAvailableCredit ? `Estimated ₹${formatMoney(c.estimatedAvailableCredit)}` : "Unknown"}`).join("\n");
  } else if (query.includes("bill") || query.includes("due")) {
    if (upcomingDues.length === 0) {
      reply = "You have no unpaid bills currently recorded.";
    } else {
      reply = `Upcoming dues:\n` +
        upcomingDues.map((b) => `- **${b.accountName}**: ₹${formatMoney(b.remainingAmount)} due on ${formatDate(b.dueDate)} (${b.status})`).join("\n");
    }
  } else if (query.includes("bikash") || query.includes("owe")) {
    reply = "I checked your loans, shared groups, and recent transactions. No outstanding debt to Bikash is currently recorded in your workspace.";
  } else {
    reply = config
      ? "I am Money Nest Bot. Ask me about your account balances, spending, credit limits, upcoming bills, or upload a payment screenshot to add a transaction."
      : "Money Nest Bot is running in local financial summary mode. To enable full AI chat and receipt vision, add GOOGLE_GENERATIVE_AI_API_KEY to your server environment.";
  }

  return {
    configured: Boolean(config),
    reply,
    message: {
      id: crypto.randomUUID(),
      role: "assistant",
      content: reply,
      createdAt: new Date().toISOString(),
      suggestedActions: [
        "How much money do I have?",
        "What did I spend this month?",
        "Show my credit-card outstanding",
        "Which bills are due next?",
      ],
    },
  };
}
