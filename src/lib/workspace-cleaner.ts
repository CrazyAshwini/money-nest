import type { WorkspaceData, WorkspaceDataWithEmi } from "./types";
import { generateEmiSchedule } from "./emi";

export const SAMSUNG_TV_LOAN_ID = "e3b0c442-98fc-4c14-9afe-632c7a8f095b";

/**
 * Sanitizes workspace transactions to remove confirmed duplicates and normalize
 * misclassified repayments and transfers that distort spending totals.
 */
export function sanitizeWorkspaceTransactions<T extends WorkspaceData>(workspace: T): T & WorkspaceDataWithEmi {
  if (!workspace || !Array.isArray(workspace.transactions)) return workspace;

  const toRemoveIds = new Set([
    "3ab044c8-1c87-44d7-94ca-cb3083846998", // DAWNTECH Samsung TV ₹32,990 duplicate
    "f9d70cd7-7724-45b3-886c-decb59177b95", // Acko duplicate ₹1,690
    "488c9f8c-08e7-47c3-aadb-8d29f3d1f969", // South Bihar Power duplicate ₹191
    "700f5d71-0977-48ab-8d06-0e8e1b91023f", // Duplicate Navi Finance ₹1 credit
    "359d2e27-0ca3-4eab-acb8-5b016a9d6206", // Duplicate DCB Bank ₹2,000 credit
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

      // Suryoday credit card bill payment -> bill_payment (exact statement amount ₹820.19)
      if (
        t.id === "f25f639d-b1b9-4579-bcfa-90f169585650" ||
        (t.description?.includes("Bill payment for Suryoday") &&
          (t.amount === "821.25" || t.amount === "820.19"))
      ) {
        return {
          ...t,
          amount: "820.19",
          kind: "bill_payment" as const,
          toAccountId: t.toAccountId || "8986e87f-8844-5af2-a7a5-31ef839fb72c",
          category: null,
          notes: "Credit card bill payment for Suryoday RuPay via POPTech (exact statement debit ₹820.19).",
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

  const ownerUserId = "4aed7ac5-23e7-4878-aa7a-13ad6d24b597";
  const iciciAccountId = "2e84b7fc-dc55-4052-a087-7910619c3f2e";
  const sbiAccountId = "a4efa024-1d0c-59a2-aabd-c330a661be77";
  const idfcAccountId = "5d9bc626-5ee8-514f-a2ff-fca8b5618b74";
  const amazonAccountId = "476fa60a-ab35-5769-a18c-839e8a88d283";

  const hasIcici = workspace.accounts?.some((a) => a.id === iciciAccountId);
  const hasSbi = workspace.accounts?.some((a) => a.id === sbiAccountId);
  const hasIdfc = workspace.accounts?.some((a) => a.id === idfcAccountId);
  const hasAmazon = workspace.accounts?.some((a) => a.id === amazonAccountId);

  const userId =
    workspace.accounts?.find((a) => a.userId)?.userId ||
    workspace.transactions[0]?.userId ||
    ownerUserId;

  // 1. Ensure ICICI statement entries from 25 Oct 2026 are present if user owns ICICI account
  if (hasIcici) {
    const iciciJayantRef = "512684732761";
    const iciciSwiggyRef = "588091285703";

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
  }

  // 2. Ensure IDFC Cashback Statement Credit on 19 Oct 2026 if user owns IDFC Hello Cashback card
  if (hasIdfc) {
    const idfcCashbackId = "c2607015-0019-4888-a003-191020260048";
    const hasCashback = sanitizedTransactions.some(
      (t) =>
        t.id === idfcCashbackId ||
        (t.toAccountId === idfcAccountId &&
          t.amount === "48.90" &&
          t.occurredOn === "2026-10-19"),
    );
    if (!hasCashback) {
      sanitizedTransactions.push({
        id: idfcCashbackId,
        userId,
        kind: "adjustment",
        status: "posted",
        amount: "48.90",
        currency: "INR",
        occurredOn: "2026-10-19",
        fromAccountId: null,
        toAccountId: idfcAccountId,
        category: null,
        merchant: "IDFC FIRST Bank",
        description: "IDFC FIRST Hello Cashback — ₹48.90 cashback statement credit applied",
        notes: "Cashback statement credit of ₹48.90 clears card outstanding to ₹0.00 prior to card closure.",
      });
    }
  }

  // 3. Ensure SBI Mini-Statement items on 25 Oct 2026 if user owns SBI account
  if (hasSbi) {
    // 3a. Rapido expense ₹50.00
    const rapidoId = "c2607015-0020-4888-a004-251020260050";
    const hasRapido = sanitizedTransactions.some(
      (t) =>
        t.id === rapidoId ||
        (t.fromAccountId === sbiAccountId &&
          t.amount === "50.00" &&
          t.occurredOn === "2026-10-25" &&
          t.description?.toLowerCase().includes("rapido")),
    );
    if (!hasRapido) {
      sanitizedTransactions.push({
        id: rapidoId,
        userId,
        kind: "expense",
        status: "posted",
        amount: "50.00",
        currency: "INR",
        occurredOn: "2026-10-25",
        fromAccountId: sbiAccountId,
        toAccountId: null,
        category: "Transport",
        platform: "Rapido",
        merchant: "Rapido",
        description: "Rapido — Ride payment",
        notes: "Rapido ride expense paid from SBI.",
      });
    }

    // 3b. FD withdrawal into SBI ₹10,289.00
    const fdWithdrawalId = "c2607015-0021-4888-a005-251010289000";
    const hasFdWithdrawal = sanitizedTransactions.some(
      (t) =>
        t.id === fdWithdrawalId ||
        (t.toAccountId === sbiAccountId &&
          t.amount === "10289.00" &&
          t.occurredOn === "2026-10-25"),
    );
    if (!hasFdWithdrawal) {
      sanitizedTransactions.push({
        id: fdWithdrawalId,
        userId,
        kind: "transfer",
        status: "posted",
        amount: "10289.00",
        currency: "INR",
        occurredOn: "2026-10-25",
        fromAccountId: null,
        toAccountId: sbiAccountId,
        category: null,
        merchant: "IDFC FIRST Bank",
        description: "BY TRFR — IDFC Fixed Deposit withdrawal (₹10,000 principal + ₹289 interest)",
        notes: "Fixed deposit encashment credited into SBI upon IDFC card closure.",
      });
    }

    // 3c. Bank verification credit ₹1.00
    const bankVerificationId = "c2607015-0022-4888-a006-251000000001";
    const hasBankVerification = sanitizedTransactions.some(
      (t) =>
        t.id === bankVerificationId ||
        (t.toAccountId === sbiAccountId &&
          t.amount === "1.00" &&
          t.occurredOn === "2026-10-25" &&
          t.description?.toLowerCase().includes("verification")),
    );
    if (!hasBankVerification) {
      sanitizedTransactions.push({
        id: bankVerificationId,
        userId,
        kind: "adjustment",
        status: "posted",
        amount: "1.00",
        currency: "INR",
        occurredOn: "2026-10-25",
        fromAccountId: null,
        toAccountId: sbiAccountId,
        category: null,
        merchant: "Bank Verification",
        description: "BY TRFR for bank verification",
        notes: "Bank penny-drop verification credit into SBI.",
      });
    }
  }

  // Sanitize accounts (SBI notes + IDFC card closure)
  const sanitizedAccounts = workspace.accounts?.map((a) => {
    if (a.id === sbiAccountId) {
      return {
        ...a,
        notes:
          "Statement period 1–21 October 2026. Opening balance ₹1,089.32; verified closing balance ₹6,469.45 (60 debits, 23 credits). Mini-statement available balance ₹18,575.85 as of 25 Oct 2026 (23:43).",
      };
    }
    if (a.id === idfcAccountId) {
      return {
        ...a,
        active: false,
        notes: "Card closed on 25 Oct 2026 upon ₹48.90 cashback statement credit and FD encashment.",
      };
    }
    return a;
  });

  // Sanitize snapshots (SBI available balance snapshot + IDFC zero balance snapshot)
  let sanitizedSnapshots = workspace.snapshots;
  if (Array.isArray(workspace.snapshots) && (hasSbi || hasIdfc)) {
    sanitizedSnapshots = [...workspace.snapshots];
    if (hasSbi) {
      const sbiSnapshotId = "c2607015-0023-4888-a007-251018575850";
      if (!sanitizedSnapshots.some((s) => s.id === sbiSnapshotId)) {
        sanitizedSnapshots.push({
          id: sbiSnapshotId,
          userId,
          accountId: sbiAccountId,
          asOf: "2026-10-25T23:43:00Z",
          reportedBalance: "18575.85",
          source: "bank_statement",
          verifiedByUser: true,
        });
      }
    }
    if (hasIdfc) {
      const idfcSnapshotId = "c2607015-0024-4888-a008-251000000000";
      if (!sanitizedSnapshots.some((s) => s.id === idfcSnapshotId)) {
        sanitizedSnapshots.push({
          id: idfcSnapshotId,
          userId,
          accountId: idfcAccountId,
          asOf: "2026-10-25T23:43:00Z",
          reportedBalance: "0.00",
          reportedOutstanding: "0.00",
          source: "bank_statement",
          verifiedByUser: true,
        });
      }
    }
  }

  // Sanitize fixed deposits (unpledge IDFC FD and record encashment value)
  const sanitizedFixedDeposits = workspace.fixedDeposits?.map((fd) => {
    if (fd.id === "0ed85bdd-233c-508d-ac8d-b6722773ff34") {
      return {
        ...fd,
        pledged: false,
        payoutAccountId: sbiAccountId,
        reportedEncashmentValue: "10289.00",
        reportedAsOf: "2026-10-25",
        notes:
          "Encashed/withdrawn into SBI on 25 Oct 2026 upon closure of IDFC card (₹10,000 principal + ₹289 interest).",
      };
    }
    return fd;
  });

  // Attach structured Samsung TV Loan and EMI installments
  const sanitizedLoans = Array.isArray(workspace.loans)
    ? [...workspace.loans]
    : [];
  const sanitizedEmis = Array.isArray(workspace.emis)
    ? [...workspace.emis]
    : [];

  const samsungInstallments = hasAmazon
    ? generateEmiSchedule({
        agreementId: "agr-samsung-tv",
        userId,
        financedPrincipal: "30509.79",
        annualInterestRate: "20.00",
        durationMonths: 9,
        monthlyEmi: "3678.70",
        processingFee: "360.02",
        firstBillingDate: "2026-11-01",
        firstDueDate: "2026-11-05",
      })
    : [];

  if (hasAmazon) {
    const hasSamsungLoan = sanitizedLoans.some(
      (l) =>
        l.id === SAMSUNG_TV_LOAN_ID ||
        l.name?.toLowerCase().includes("samsung"),
    );
    if (!hasSamsungLoan) {
      sanitizedLoans.push({
        id: SAMSUNG_TV_LOAN_ID,
        userId,
        name: 'Samsung 43" TV (Amazon Pay Later EMI)',
        lender: "Amazon Pay Later",
        kind: "institutional",
        contractualPrincipal: "30509.79",
        netDisbursed: "30509.79",
        reportedOutstanding: "30509.79",
        reportedAsOf: "2026-10-18",
        annualRate: "20.0000",
        scheduledTotal: "33468.31",
        repaymentAccountId: amazonAccountId,
        disbursedOn: "2026-10-18",
        notes:
          'Samsung 43" Mini LED TV + 2 items (Orders 406-2479955-3587539 / 406-6855707-5582708 / 406-0628731-9190704). 9-month EMI @ 20% p.a., ₹3,678.70/month.',
      });
    }

    const hasSamsungEmis = sanitizedEmis.some(
      (e) => e.loanId === SAMSUNG_TV_LOAN_ID,
    );
    if (!hasSamsungEmis) {
      for (const inst of samsungInstallments) {
        sanitizedEmis.push({
          id: `b001000${inst.installmentNumber}-4061-4000-8000-00000000000${inst.installmentNumber}`,
          userId,
          loanId: SAMSUNG_TV_LOAN_ID,
          number: inst.installmentNumber,
          dueDate: inst.dueDate,
          amount: inst.totalDue,
          principalPortion: inst.principalComponent,
          interestPortion: inst.interestComponent,
        });
      }
    }
  }

  // Attach structured Samsung TV EMI agreement if Amazon Pay Later account exists
  const sanitizedEmiAgreements =
    "emiAgreements" in workspace &&
    Array.isArray((workspace as WorkspaceDataWithEmi).emiAgreements)
      ? [...(workspace as WorkspaceDataWithEmi).emiAgreements!]
      : [];

  if (hasAmazon) {
    const hasSamsungEmi = sanitizedEmiAgreements.some(
      (e) =>
        e.accountId === amazonAccountId &&
        e.description?.toLowerCase().includes("samsung"),
    );
    if (!hasSamsungEmi) {
      sanitizedEmiAgreements.push({
        id: "agr-samsung-tv",
        userId,
        accountId: amazonAccountId,
        orderIds: [
          "406-2479955-3587539",
          "406-6855707-5582708",
          "406-0628731-9190704",
        ],
        purchaseDate: "2026-10-18",
        merchant: "Amazon",
        description: "Samsung 43-inch television plus two additional items",
        financedPrincipal: "30509.79",
        annualInterestRate: "20.00",
        totalScheduledInterest: "2598.50",
        processingFee: "360.02",
        totalScheduledRepayment: "33468.31",
        emiCount: 9,
        monthlyPayment: "3678.70",
        principalOutstanding: "30509.79",
        principalRepaid: "0.00",
        interestBilled: "0.00",
        interestPaid: "0.00",
        unbilledFutureInterest: "2598.50",
        feesBilled: "0.00",
        feesPaid: "0.00",
        firstBillingDate: "2026-11-01",
        firstDueDate: "2026-11-05",
        status: "active",
        installments: samsungInstallments,
        notes:
          '9-month EMI agreement for Samsung 43" TV + 2 items. Only principal consumes credit limit upfront.',
      });
    }
  }

  return {
    ...workspace,
    accounts: sanitizedAccounts || workspace.accounts,
    snapshots: sanitizedSnapshots || workspace.snapshots,
    fixedDeposits: sanitizedFixedDeposits || workspace.fixedDeposits,
    loans: sanitizedLoans,
    emis: sanitizedEmis,
    transactions: sanitizedTransactions,
    ...(sanitizedEmiAgreements.length > 0
      ? { emiAgreements: sanitizedEmiAgreements }
      : {}),
  };
}
