import type { WorkspaceData } from "./types";

/**
 * Sanitizes workspace transactions to remove confirmed duplicates and normalize
 * misclassified repayments and transfers that distort spending totals.
 */
export function sanitizeWorkspaceTransactions(workspace: WorkspaceData): WorkspaceData {
  if (!workspace || !Array.isArray(workspace.transactions)) return workspace;

  const toRemoveIds = new Set([
    "3ab044c8-1c87-44d7-94ca-cb3083846998", // DAWNTECH Samsung TV ₹32,990 duplicate
    "f9d70cd7-7724-45b3-886c-decb59177b95", // Acko duplicate ₹1,690
    "488c9f8c-08e7-47c3-aadb-8d29f3d1f969", // South Bihar Power duplicate ₹191
  ]);

  const sanitizedTransactions = workspace.transactions
    .filter((t) => {
      if (toRemoveIds.has(t.id)) return false;
      // Also match DAWNTECH ₹32,990 if under a different ID
      if (
        (t.merchant?.toLowerCase().includes("dawntech") ||
          t.description?.toLowerCase().includes("dawntech")) &&
        t.amount === "32990.00" &&
        t.occurredOn === "2026-10-18"
      ) {
        return false;
      }
      return true;
    })
    .map((t) => {
      // ATM cash withdrawal -> transfer
      if (
        t.id === "cf2554a0-3672-4081-ab64-bf1f6e07f730" ||
        (t.description?.includes("ATM Withdrawal") &&
          t.amount === "3500.00" &&
          t.occurredOn === "2026-10-20")
      ) {
        return {
          ...t,
          kind: "transfer" as const,
          category: null,
          notes: "ATM cash withdrawal: self-transfer from Federal Bank-FI to cash in hand.",
        };
      }

      // Utkarsh digital deposit -> transfer
      if (
        t.id === "28fe00b8-6eb1-41dd-9fdb-bc3b9eae2fee" ||
        (t.description?.includes("Digital Deposit transfer to Utkarsh") &&
          t.amount === "2000.00")
      ) {
        return {
          ...t,
          kind: "transfer" as const,
          category: null,
          notes: "Digital deposit transfer to Utkarsh Small Finance Bank recurring/fixed deposit.",
        };
      }

      // IDFC credit card bill payment -> bill_payment
      if (
        t.id === "4234c966-1214-42b1-9b12-25197b972bb7" ||
        (t.description?.includes("Credit Card Bill Payment · IDFC First Bank") &&
          t.amount === "121.10")
      ) {
        return {
          ...t,
          kind: "bill_payment" as const,
          toAccountId: t.toAccountId || "5d9bc626-5ee8-514f-a2ff-fca8b5618b74",
          category: null,
          notes: "Credit card bill payment for IDFC First Bank.",
        };
      }

      // IOB credit card bill payment -> bill_payment
      if (
        t.id === "df50998d-a0a1-4793-b743-3916a3bd17ab" ||
        (t.description?.includes("Bill payment for IOB") &&
          t.amount === "1273.00")
      ) {
        return {
          ...t,
          kind: "bill_payment" as const,
          toAccountId: t.toAccountId || "91a03483-ffae-59a8-ae34-9a66df28395f",
          category: null,
          notes: "Credit card bill payment for IOB ZET RuPay via POPTech.",
        };
      }

      // Suryoday credit card bill payment -> bill_payment
      if (
        t.id === "f25f639d-b1b9-4579-bcfa-90f169585650" ||
        (t.description?.includes("Bill payment for Suryoday") &&
          t.amount === "821.25")
      ) {
        return {
          ...t,
          kind: "bill_payment" as const,
          toAccountId: t.toAccountId || "8986e87f-8844-5af2-a7a5-31ef839fb72c",
          category: null,
          notes: "Credit card bill payment for Suryoday RuPay via POPTech.",
        };
      }

      // Amazon Pay Later ₹380 purchase on 2 Oct
      if (
        t.id === "3941fe6a-57a2-5c29-a768-b748102b2f33" ||
        (t.fromAccountId === "476fa60a-ab35-5769-a18c-839e8a88d283" &&
          t.amount === "380.00" &&
          t.occurredOn === "2026-10-02" &&
          t.kind === "expense")
      ) {
        return {
          ...t,
          description: "Amazon Pay Later — Amazon purchase ₹380 (item unknown)",
          notes: "Amazon purchase ₹380 | Other | Amazon Pay Later - refunded on same day (2 Oct 2026).",
        };
      }

      // Amazon Pay Later ₹380 refund -> link to purchase & set occurredOn to 2026-10-02 (same day)
      if (
        t.id === "1431fa01-5395-4515-ad3b-a1312ce6cb92" ||
        (t.toAccountId === "476fa60a-ab35-5769-a18c-839e8a88d283" &&
          t.amount === "380.00" &&
          t.kind === "refund")
      ) {
        return {
          ...t,
          occurredOn: "2026-10-02",
          refundOfTransactionId: "3941fe6a-57a2-5c29-a768-b748102b2f33",
          description: "Amazon Pay Later — ₹380 refund received",
          notes: "Confirmed same-day refund for 2 Oct 2026 Amazon purchase ₹380.",
        };
      }

      return t;
    });

  // Ensure ICICI statement entries from 25 Oct 2026 are present
  const iciciJayantRef = "512684732761";
  const iciciSwiggyRef = "588091285703";
  const iciciAccountId = "2e84b7fc-dc55-4052-a087-7910619c3f2e";
  const userId =
    workspace.accounts?.find((a) => a.id === iciciAccountId)?.userId ||
    workspace.transactions[0]?.userId ||
    "4aed7ac5-23e7-4878-aa7a-13ad6d24b597";

  const hasJayant = sanitizedTransactions.some(
    (t) =>
      t.externalReference === iciciJayantRef ||
      t.id === "c2607015-0017-4888-a001-512684732761",
  );
  if (!hasJayant) {
    sanitizedTransactions.push({
      id: "c2607015-0017-4888-a001-512684732761",
      userId,
      kind: "income",
      status: "posted",
      amount: "1500.00",
      currency: "INR",
      occurredOn: "2026-10-25",
      fromAccountId: null,
      toAccountId: iciciAccountId,
      category: null,
      merchant: "Jayant Kumar (Pralad)",
      description: "UPI/JAYANT KUM/XX6686@axl/Payment fr/UNION BANK/512684732761",
      externalReference: iciciJayantRef,
      notes: "Income from friend Pralad aka Jayant Kumar via UPI (UTR 512684732761).",
    });
  }

  const hasSwiggy = sanitizedTransactions.some(
    (t) =>
      t.externalReference === iciciSwiggyRef ||
      t.id === "c2607015-0018-4888-a002-588091285703",
  );
  if (!hasSwiggy) {
    sanitizedTransactions.push({
      id: "c2607015-0018-4888-a002-588091285703",
      userId,
      kind: "expense",
      status: "posted",
      amount: "67.00",
      currency: "INR",
      occurredOn: "2026-10-25",
      fromAccountId: iciciAccountId,
      toAccountId: null,
      category: "Food",
      platform: "Swiggy",
      merchant: "Swiggy / P Nilancha",
      description: "Swiggy — Food expense paid to P Nilancha",
      externalReference: iciciSwiggyRef,
      notes: "Food expense on Swiggy paid to friend P Nilancha via UPI (UTR 588091285703).",
    });
  }

  return {
    ...workspace,
    transactions: sanitizedTransactions,
  };
}
