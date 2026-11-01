import type { Transaction, WorkspaceData, WorkspaceDataWithEmi } from "./types";
import { generateEmiSchedule } from "./emi";

export const SAMSUNG_TV_LOAN_ID = "e3b0c442-98fc-4c14-9afe-632c7a8f095b";

/**
 * Sanitizes workspace transactions to remove confirmed duplicates and normalize
 * misclassified repayments and transfers that distort spending totals.
 */
export function sanitizeWorkspaceTransactions<T extends WorkspaceData>(workspace: T): T & WorkspaceDataWithEmi {
  if (!workspace || !Array.isArray(workspace.transactions)) return workspace;

  const ownerUserId = "4aed7ac5-23e7-4878-aa7a-13ad6d24b597";
  const iciciAccountId = "2e84b7fc-dc55-4052-a087-7910619c3f2e";
  const sbiAccountId = "a4efa024-1d0c-59a2-aabd-c330a661be77";
  const idfcAccountId = "5d9bc626-5ee8-514f-a2ff-fca8b5618b74";
  const amazonAccountId = "476fa60a-ab35-5769-a18c-839e8a88d283";
  const defaultUtkarshAccountId = "7e83d8e2-dc55-4052-a087-7910619c3f32";

  const existingUtkarsh = workspace.accounts?.find(
    (a) =>
      a.kind === "credit_card" &&
      (a.maskedSuffix === "XX32" ||
        a.maskedSuffix === "32" ||
        a.name?.toLowerCase().includes("utkarsh") ||
        a.name?.toLowerCase().includes("supermoney") ||
        a.institution?.toLowerCase().includes("utkarsh")),
  );
  const utkarshAccountId = existingUtkarsh?.id || defaultUtkarshAccountId;

  const hasIcici = workspace.accounts?.some((a) => a.id === iciciAccountId);
  const hasSbi = workspace.accounts?.some((a) => a.id === sbiAccountId);
  const hasIdfc = workspace.accounts?.some((a) => a.id === idfcAccountId);
  const hasAmazon = workspace.accounts?.some((a) => a.id === amazonAccountId);
  const hasUtkarsh = Boolean(existingUtkarsh);

  const userId =
    workspace.accounts?.find((a) => a.userId)?.userId ||
    workspace.transactions[0]?.userId ||
    ownerUserId;

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

      // Amazon Pay Later ₹6,954.15 repayment confirmed debited from SBI on 02 Oct 2026 (UTR 627516147601)
      if (
        t.id === "tx-amzn-repayment-screenshot" ||
        (t.amount === "6954.15" &&
          (t.merchant?.toLowerCase().includes("amazon pay later") ||
            t.description?.toLowerCase().includes("amazon pay later statement repayment")))
      ) {
        return {
          ...t,
          occurredOn: "2026-10-02",
          status: "posted" as const,
          fromAccountId: sbiAccountId,
          toAccountId: amazonAccountId,
          externalReference: "627516147601",
          notes:
            "Confirmed Amazon Pay Later repayment debited from SBI Savings on 02 Oct 2026 (UTR 627516147601).",
        };
      }

      // Blinkit ₹410 expense -> paid with IDFC FIRST Quantum+ credit card
      if (
        t.amount === "410.00" &&
        (t.merchant?.toLowerCase().includes("blinkit") ||
          t.description?.toLowerCase().includes("blinkit"))
      ) {
        const idfcQuantumAccount = workspace.accounts?.find(
          (a) =>
            a.kind === "credit_card" &&
            (a.name?.toLowerCase().includes("quantum") || a.maskedSuffix === "3594"),
        );
        return {
          ...t,
          category: "Groceries",
          platform: "Blinkit",
          fromAccountId: idfcQuantumAccount?.id || t.fromAccountId,
          notes: "Blinkit order paid using IDFC FIRST Quantum+ credit card.",
        };
      }

      // Flipkart Cycle Pure Ghee Tealight Diyas 100 Pcs (Qty 2) ₹270 order on 30 Oct 2026
      if (
        t.amount === "270.00" &&
        (t.externalReference === "075125948899" ||
          (t.occurredOn === "2026-10-30" &&
            (t.merchant?.toLowerCase().includes("flipkart") ||
              t.description?.toLowerCase().includes("flipkart"))))
      ) {
        return {
          ...t,
          category: "Shopping",
          platform: "Flipkart",
          merchant: "Flipkart · SuperComNet",
          description: "Flipkart — Cycle Pure Ghee Tealight Diyas 100 Pcs (Pack of 2)",
          notes:
            "Flipkart order OD439018210263725100: Cycle Pure Ghee Tealight Diyas 100 Pcs (Qty: 2 @ ₹135 each = ₹270 + 12 SuperCoins). Seller SuperComNet. Debited from SBI Savings via UPI (UTR 075125948899). Delivery tracking 9204944628.",
        };
      }

      // Amazon X4Cart purchase ₹634.53 on 30 Oct 2026
      if (
        t.amount === "634.53" ||
        (t.occurredOn === "2026-10-30" &&
          (t.merchant?.toLowerCase().includes("x4cart") ||
            t.description?.toLowerCase().includes("x4cart")))
      ) {
        return {
          ...t,
          category: "Shopping",
          platform: "Amazon",
          merchant: "X4Cart",
          description: "Amazon — Decorative Fairy String Lights",
          notes:
            t.notes ||
            "Amazon order: Decorative Fairy String Lights (Seller: X4Cart). Amount ₹634.53 debited on 30 Oct 2026.",
        };
      }

      // Zomato Laziz Pizza food order ₹136.19 on 31 Oct 2026
      if (
        t.amount === "136.19" &&
        (t.occurredOn === "2026-10-31" ||
          t.merchant?.toLowerCase().includes("laziz") ||
          t.merchant?.toLowerCase().includes("zomato") ||
          t.description?.toLowerCase().includes("zomato"))
      ) {
        return {
          ...t,
          category: "Food",
          platform: "Zomato",
          merchant: "Laziz Pizza",
          description: "Zomato — Laziz Pizza Food Order",
          notes: t.notes || "Zomato food order from Laziz Pizza ₹136.19 on 31 Oct 2026.",
        };
      }

      // Navi Loans EMI payment of ₹3,500 on 30 Oct 2026
      if (
        t.amount === "3500.00" &&
        (t.externalReference === "144089859407" ||
          t.merchant?.toLowerCase().includes("navi") ||
          t.description?.toLowerCase().includes("navi") ||
          t.description?.includes("144089859407"))
      ) {
        return {
          ...t,
          occurredOn: "2026-10-30",
          category: "Bills",
          kind: "bill_payment" as const,
          status: "posted" as const,
          fromAccountId: t.fromAccountId || sbiAccountId,
          toAccountId: null,
          merchant: "Navi Loans",
          description: "Navi Loans — Personal Loan EMI #1",
          notes:
            "Confirmed Navi personal loan monthly EMI #1 repayment debited from SBI Savings via UPI on 30 Oct 2026 (UTR 144089859407).",
        };
      }

      // Utkarsh SuperMoney card bill repayments from SBI Savings
      if (
        (t.amount === "941.75" || t.amount === "832.01") &&
        (t.description?.includes("supercard@") ||
          t.description?.toLowerCase().includes("utkarsh") ||
          t.merchant?.toLowerCase().includes("utkarsh"))
      ) {
        return {
          ...t,
          kind: "bill_payment" as const,
          category: null,
          fromAccountId: sbiAccountId,
          toAccountId: utkarshAccountId,
          merchant: "Utkarsh SuperMoney Credit Card",
          notes: `Utkarsh SuperMoney RuPay credit card bill payment debited from SBI Savings (UTR ${t.externalReference || (t.amount === "941.75" ? "212191910755" : "446687461536")}).`,
        };
      }

      // Map Utkarsh SuperMoney card spends to utkarshAccountId
      if (
        (t.amount === "140.00" && t.occurredOn === "2026-10-02" && (t.merchant?.toLowerCase().includes("domino") || t.description?.toLowerCase().includes("domino"))) ||
        (t.amount === "360.00" && t.occurredOn === "2026-10-06" && (t.merchant?.toLowerCase().includes("arif") || t.description?.toLowerCase().includes("arif"))) ||
        (t.amount === "40.00" && t.occurredOn === "2026-10-06" && (t.merchant?.toLowerCase().includes("kripa") || t.description?.toLowerCase().includes("kripa"))) ||
        (t.amount === "291.00" && t.occurredOn === "2026-10-08" && (t.merchant?.toLowerCase().includes("flipkart") || t.description?.toLowerCase().includes("flipkart"))) ||
        (t.amount === "257.22" && t.occurredOn === "2026-10-10" && (t.merchant?.toLowerCase().includes("uber") || t.description?.toLowerCase().includes("uber"))) ||
        (t.amount === "40.00" && t.occurredOn === "2026-10-12" && (t.merchant?.toLowerCase().includes("aman") || t.description?.toLowerCase().includes("aman"))) ||
        (t.amount === "224.00" && t.occurredOn === "2026-10-25" && (t.merchant?.toLowerCase().includes("aman") || t.description?.toLowerCase().includes("aman"))) ||
        (t.amount === "140.49" && t.occurredOn === "2026-10-30" && (t.merchant?.toLowerCase().includes("zomato") || t.description?.toLowerCase().includes("zomato"))) ||
        (t.amount === "136.19" && t.occurredOn === "2026-10-31" && (t.merchant?.toLowerCase().includes("zomato") || t.description?.toLowerCase().includes("zomato")))
      ) {
        return {
          ...t,
          fromAccountId: utkarshAccountId,
          notes: t.notes || "SuperMoney statement verified spend on Utkarsh XX32.",
        };
      }

      return t;
    });


  // 1. Ensure ICICI statement entries (28 total through 31 Oct 2026) are present if user owns ICICI account
  if (hasIcici) {
    const iciciTransactions: Omit<Transaction, "userId">[] = [
      {
        id: "c2607015-0001-4888-8000-000000000001",
        kind: "income",
        status: "posted",
        amount: "1.00",
        currency: "INR",
        occurredOn: "2026-10-06",
        fromAccountId: null,
        toAccountId: iciciAccountId,
        category: null,
        merchant: "Amjani Arya",
        description: "UPI/AMJANI ARY/XXi875@pingpay/UPI/Punjab Nat/966396802796/AXIbc1c388d82fe4541bba04a546eb1a6a0",
        externalReference: "966396802796",
        notes: "UPI credit from Amjani Arya into ICICI (test/transfer).",
      },
      {
        id: "c2607015-0002-4888-8000-000000000002",
        kind: "expense",
        status: "posted",
        amount: "1.00",
        currency: "INR",
        occurredOn: "2026-10-06",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Bills",
        merchant: "ICICI Bank",
        description: "Cashchgs_Deposit_2026-07-17",
        notes: "ICICI Bank cash deposit charge for July 2026.",
      },
      {
        id: "c2607015-0003-4888-8000-000000000003",
        kind: "income",
        status: "posted",
        amount: "79.26",
        currency: "INR",
        occurredOn: "2026-10-13",
        fromAccountId: null,
        toAccountId: iciciAccountId,
        category: "Income",
        merchant: "IOCL LPG Subsidy",
        description: "APBS/IOCL LPG SUBSIDY/P1026023C7EB6",
        externalReference: "P1026023C7EB6",
        notes: "IOCL LPG gas cylinder government subsidy credited via APBS.",
      },
      {
        id: "c2607015-0004-4888-8000-000000000004",
        kind: "expense",
        status: "posted",
        amount: "66.82",
        currency: "INR",
        occurredOn: "2026-10-13",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Bills",
        merchant: "ICICI Bank",
        description: "Cashchgs_Deposit_2026-07-17",
        notes: "ICICI Bank cash deposit charge for July 2026.",
      },
      {
        id: "c2607015-0005-4888-8000-000000000005",
        kind: "expense",
        status: "posted",
        amount: "12.43",
        currency: "INR",
        occurredOn: "2026-10-13",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Bills",
        merchant: "ICICI Bank",
        description: "ECSRTN1_1009267011904245002235",
        notes: "ICICI Bank ECS return debit penalty.",
      },
      {
        id: "c2607015-0006-4888-8000-000000000006",
        kind: "transfer",
        status: "posted",
        amount: "19000.00",
        currency: "INR",
        occurredOn: "2026-10-24",
        fromAccountId: null,
        toAccountId: iciciAccountId,
        category: null,
        merchant: "Priyanka Kumari",
        description: "MMT/IMPS/629716699605/IMPS/PRIYANKAKU/Axis Bank",
        externalReference: "629716699605",
        notes: "Confirmed pass-through transfer in from Priyanka Kumari; immediately forwarded to MD Mukh.",
      },
      {
        id: "c2607015-0007-4888-8000-000000000007",
        kind: "expense",
        status: "posted",
        amount: "577.55",
        currency: "INR",
        occurredOn: "2026-10-24",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Bills",
        merchant: "ICICI Bank",
        description: "ECSRTN1_1009267011904245002235",
        notes: "ICICI Bank ECS return fee.",
      },
      {
        id: "c2607015-0008-4888-8000-000000000008",
        kind: "expense",
        status: "posted",
        amount: "590.00",
        currency: "INR",
        occurredOn: "2026-10-24",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Bills",
        merchant: "ICICI Bank",
        description: "ECSRTN2_1009267011904245002235",
        notes: "ICICI Bank ECS return fee.",
      },
      {
        id: "c2607015-0009-4888-8000-000000000009",
        kind: "expense",
        status: "posted",
        amount: "32.73",
        currency: "INR",
        occurredOn: "2026-10-24",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Bills",
        merchant: "ICICI Bank",
        description: "SMSChgsApr26-Jun26+GST",
        notes: "ICICI Bank SMS alert charges Apr–Jun 2026 + GST.",
      },
      {
        id: "c2607015-0010-4888-8000-000000000010",
        kind: "expense",
        status: "posted",
        amount: "177.00",
        currency: "INR",
        occurredOn: "2026-10-24",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Bills",
        merchant: "ICICI Bank",
        description: "Cashchgs_Deposit_2026-08-04",
        notes: "ICICI Bank cash deposit charge for August 2026.",
      },
      {
        id: "c2607015-0011-4888-8000-000000000011",
        kind: "expense",
        status: "posted",
        amount: "531.00",
        currency: "INR",
        occurredOn: "2026-10-24",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Bills",
        merchant: "ICICI Bank",
        description: "CashDep Chgs 01-31JUL26+GST",
        notes: "ICICI Bank cash deposit charges for July 2026 + GST.",
      },
      {
        id: "c2607015-0012-4888-8000-000000000012",
        kind: "expense",
        status: "posted",
        amount: "236.00",
        currency: "INR",
        occurredOn: "2026-10-24",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Bills",
        merchant: "ICICI Bank",
        description: "CashDep Chgs 01-31AUG26+GST",
        notes: "ICICI Bank cash deposit charges for August 2026 + GST.",
      },
      {
        id: "c2607015-0013-4888-8000-000000000013",
        kind: "expense",
        status: "posted",
        amount: "354.00",
        currency: "INR",
        occurredOn: "2026-10-24",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Bills",
        merchant: "ICICI Bank",
        description: "DCARDFEE1614AUG26-JUL27+GST",
        notes: "ICICI Bank debit card annual fee for Aug 2026 – Jul 2027 + GST.",
      },
      {
        id: "c2607015-0014-4888-8000-000000000014",
        kind: "transfer",
        status: "posted",
        amount: "1.00",
        currency: "INR",
        occurredOn: "2026-10-24",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: null,
        merchant: "Mr MD Mukh",
        description: "UPI/Mr MD MUKH/XX6977@ybl/Payment fr/Allahabad/238104153184/IBLd48c87bc4f26483bad14f5491c01cfea",
        externalReference: "238104153184",
        notes: "UPI penny test payment to MD Mukh.",
      },
      {
        id: "c2607015-0015-4888-8000-000000000015",
        kind: "transfer",
        status: "posted",
        amount: "2500.00",
        currency: "INR",
        occurredOn: "2026-10-24",
        fromAccountId: sbiAccountId,
        toAccountId: iciciAccountId,
        category: null,
        merchant: "Self-transfer",
        description: "UPI/Ashwini Sa/XX10-7@axl/Payment fr/State Bank/694081863197/AXL9951b07c1da045a294c1e01211f8e177",
        externalReference: "694081863197",
        notes: "Internal self-transfer: SBI Savings to ICICI Bank (UTR 694081863197).",
      },
      {
        id: "c2607015-0016-4888-8000-000000000016",
        kind: "transfer",
        status: "posted",
        amount: "19000.00",
        currency: "INR",
        occurredOn: "2026-10-24",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: null,
        merchant: "Mr MD Mukh",
        description: "UPI/Mr MD MUKH/XX6977@ybl/Payment fr/Allahabad/341940340450/IBLbc655a7ae5c540fe94bbabe122b3958d",
        externalReference: "341940340450",
        notes: "Confirmed pass-through transfer out to MD Mukh; forwards ₹19,000 received from Priyanka Kumari.",
      },
      {
        id: "c2607015-0017-4888-a001-512684732761",
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
        externalReference: "512684732761",
        notes: "Income from friend Pralad aka Jayant Kumar via UPI (UTR 512684732761).",
      },
      {
        id: "c2607015-0018-4888-a002-588091285703",
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
        externalReference: "588091285703",
        notes: "Food expense on Swiggy paid to friend P Nilancha via UPI (UTR 588091285703).",
      },
      {
        id: "c2607015-0019-4888-8000-000000000019",
        kind: "expense",
        status: "posted",
        amount: "35.00",
        currency: "INR",
        occurredOn: "2026-10-26",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Other",
        merchant: "Aman Enterprises",
        description: "UPI/AMAN ENTER/XX1928@unitype/Pay to Bha/UNITY SMAL/666579421781",
        externalReference: "666579421781",
        notes: "UPI payment to Aman Enterprises from ICICI.",
      },
      {
        id: "c2607015-0020-4888-8000-000000000020",
        kind: "income",
        status: "posted",
        amount: "65.00",
        currency: "INR",
        occurredOn: "2026-10-28",
        fromAccountId: null,
        toAccountId: iciciAccountId,
        category: null,
        merchant: "Amjani Arya",
        description: "UPI/AMJANI ARY/XX7458@waicici/na/Punjab Nat/111026356183",
        externalReference: "111026356183",
        notes: "UPI payment from Amjani Arya into ICICI.",
      },
      {
        id: "c2607015-0021-4888-8000-000000000021",
        kind: "expense",
        status: "posted",
        amount: "69.00",
        currency: "INR",
        occurredOn: "2026-10-28",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Other",
        merchant: "Nihar Chandra",
        description: "UPI/Nihar Chan/XXnics@okhdfcb/UPI/State Bank/630165787797",
        externalReference: "630165787797",
        notes: "UPI expense to Nihar Chandra from ICICI.",
      },
      {
        id: "c2607015-0022-4888-8000-000000000022",
        kind: "expense",
        status: "posted",
        amount: "116.00",
        currency: "INR",
        occurredOn: "2026-10-29",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Food",
        platform: "Swiggy",
        merchant: "Swiggy Instamart",
        description: "UPI/SWIGGY INS/XXmart@axb/Pay for In/AXIS BANK/630229480649",
        externalReference: "630229480649",
        notes: "Swiggy Instamart groceries/food expense paid via ICICI UPI.",
      },
      {
        id: "c2607015-0023-4888-8000-000000000023",
        kind: "income",
        status: "posted",
        amount: "277.00",
        currency: "INR",
        occurredOn: "2026-10-30",
        fromAccountId: null,
        toAccountId: iciciAccountId,
        category: "Income",
        merchant: "Myntra Designs (Third-Party Refund)",
        description: "MMT/IMPS/630314354684/RyY601x4LS/MYNTRA DES/HSBC Bank",
        externalReference: "630314354684",
        notes:
          "Confirmed income: third-party Myntra refund received into ICICI Bank on behalf of someone else (user will purchase an item for them in the future). Treated as incoming funds, not a personal shopping reduction.",
      },
      {
        id: "c2607015-0024-4888-8000-000000000024",
        kind: "transfer",
        status: "posted",
        amount: "1555.00",
        currency: "INR",
        occurredOn: "2026-10-30",
        fromAccountId: iciciAccountId,
        toAccountId: sbiAccountId,
        category: null,
        merchant: "Self-transfer",
        description: "UPI/Ashwini Sa/XX10-7@ibl/Payment fr/State Bank/610717539892",
        externalReference: "610717539892",
        notes: "Internal self-transfer: ICICI Bank to SBI Savings (UTR 610717539892).",
      },
      {
        id: "c2607015-0025-4888-8000-000000000025",
        kind: "transfer",
        status: "posted",
        amount: "323.00",
        currency: "INR",
        occurredOn: "2026-10-30",
        fromAccountId: sbiAccountId,
        toAccountId: iciciAccountId,
        category: null,
        merchant: "Self-transfer",
        description: "UPI/Ashwini Sa/XX10-7@axl/Payment fr/State Bank/987682082631",
        externalReference: "987682082631",
        notes: "Internal self-transfer: SBI Savings to ICICI Bank (UTR 987682082631).",
      },
      {
        id: "c2607015-0026-4888-8000-000000000026",
        kind: "expense",
        status: "posted",
        amount: "40.00",
        currency: "INR",
        occurredOn: "2026-10-30",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Other",
        merchant: "Deepak Kushwaha",
        description: "UPI/DEEPAK KUS/XXtvha@ptys/Paid via S/YES BANK L/630336792300",
        externalReference: "630336792300",
        notes: "UPI payment to Deepak Kushwaha from ICICI.",
      },
      {
        id: "c2607015-0027-4888-8000-000000000027",
        kind: "transfer",
        status: "posted",
        amount: "200.00",
        currency: "INR",
        occurredOn: "2026-10-30",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: null,
        merchant: "Amjani Arya",
        description: "UPI/AMJANI ARY/XX7458@ptaxis/UPI/Punjab Nat/666901570625",
        externalReference: "666901570625",
        notes: "Transfer out to Amjani Arya (short-term advance; returned next day).",
      },
      {
        id: "c2607015-0028-4888-8000-000000000028",
        kind: "transfer",
        status: "posted",
        amount: "200.00",
        currency: "INR",
        occurredOn: "2026-10-31",
        fromAccountId: null,
        toAccountId: iciciAccountId,
        category: null,
        merchant: "Amjani Arya",
        description: "UPI/AMJANI ARY/XX7458@waicici/na/Punjab Nat/111046378803",
        externalReference: "111046378803",
        notes: "Round-trip transfer return from Amjani Arya (returns 30 Oct ₹200 advance, net ₹0.00).",
      },
      {
        id: "c2607015-0029-4888-8000-000000000029",
        kind: "expense",
        status: "posted",
        amount: "60.30",
        currency: "INR",
        occurredOn: "2026-10-31",
        fromAccountId: iciciAccountId,
        toAccountId: null,
        category: "Bills",
        merchant: "ICICI Bank",
        description: "ICICI Bank — Service charges / alert fees + GST",
        notes: "ICICI Bank service charges & GST debited on 31 Oct 2026, reconciling closing balance to ₹223.44 CR.",
      },
    ];

    for (const tx of iciciTransactions) {
      const exists = sanitizedTransactions.some(
        (t) =>
          t.id === tx.id ||
          (tx.externalReference && t.externalReference === tx.externalReference) ||
          (t.amount === tx.amount &&
            t.occurredOn === tx.occurredOn &&
            ((tx.fromAccountId && t.fromAccountId === tx.fromAccountId) ||
              (tx.toAccountId && t.toAccountId === tx.toAccountId)) &&
            (t.description === tx.description || t.merchant === tx.merchant)),
      );
      if (!exists) {
        sanitizedTransactions.push({ ...tx, userId });
      }
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

    // 3d. Post-25 Oct SBI statement entries through 31 Oct 2026
    const sbiNewTransactions: Omit<Transaction, "userId">[] = [
      {
        id: "a4efa024-0001-4888-8000-000000000001",
        kind: "transfer",
        status: "posted",
        amount: "2001.15",
        currency: "INR",
        occurredOn: "2026-10-28",
        fromAccountId: null,
        toAccountId: sbiAccountId,
        category: null,
        merchant: "Utkarsh Small Finance Bank",
        description: "DEP TFR NEFT*UTKS0000002*UTKSN26301096846*UTKARSH BANK",
        externalReference: "UTKSN26301096846",
        notes: "Utkarsh Small Finance Bank deposit maturity return (₹2,000.00 principal + ₹1.15 interest).",
      },
      {
        id: "a4efa024-0002-4888-8000-000000000002",
        kind: "expense",
        status: "posted",
        amount: "137.00",
        currency: "INR",
        occurredOn: "2026-10-28",
        fromAccountId: sbiAccountId,
        toAccountId: null,
        category: "Shopping",
        platform: "Meesho",
        merchant: "Meesho",
        description: "WDL TFRUPI/DR/171646486655/Meesho T/UTIB/meeshotech",
        externalReference: "171646486655",
        notes: "Meesho online shopping expense paid via SBI UPI.",
      },
      {
        id: "a4efa024-0003-4888-8000-000000000003",
        kind: "expense",
        status: "posted",
        amount: "2.00",
        currency: "INR",
        occurredOn: "2026-10-29",
        fromAccountId: sbiAccountId,
        toAccountId: null,
        category: "Shopping",
        platform: "Flipkart",
        merchant: "Flipkart",
        description: "POS ATM PURCH OTHPG 630102973493FLIPKART PAYMENTS",
        externalReference: "630102973493",
        notes: "Flipkart nominal verification payment via debit card POS.",
      },
      {
        id: "a4efa024-0004-4888-8000-000000000004",
        kind: "expense",
        status: "posted",
        amount: "270.00",
        currency: "INR",
        occurredOn: "2026-10-30",
        fromAccountId: sbiAccountId,
        toAccountId: null,
        category: "Shopping",
        platform: "Flipkart",
        merchant: "Flipkart · SuperComNet",
        description: "Flipkart — Cycle Pure Ghee Tealight Diyas 100 Pcs (Pack of 2)",
        externalReference: "075125948899",
        notes:
          "Flipkart order OD439018210263725100: Cycle Pure Ghee Tealight Diyas 100 Pcs (Qty: 2 @ ₹135 each = ₹270 + 12 SuperCoins). Seller SuperComNet. Debited from SBI Savings via UPI (UTR 075125948899). Delivery tracking 9204944628.",
      },
      {
        id: "a4efa024-0005-4888-8000-000000000005",
        kind: "bill_payment",
        status: "posted",
        amount: "3500.00",
        currency: "INR",
        occurredOn: "2026-10-30",
        fromAccountId: sbiAccountId,
        toAccountId: null,
        category: "Bills",
        merchant: "Navi Loans",
        description: "Navi Loans — Personal Loan EMI #1",
        externalReference: "144089859407",
        notes: "Confirmed Navi personal loan monthly EMI #1 repayment debited from SBI Savings via UPI on 30 Oct 2026 (UTR 144089859407).",
      },
      {
        id: "a4efa024-0006-4888-8000-000000000006",
        kind: "income",
        status: "posted",
        amount: "1100.00",
        currency: "INR",
        occurredOn: "2026-10-30",
        fromAccountId: null,
        toAccountId: sbiAccountId,
        category: "Income",
        merchant: "Ramswrup",
        description: "DEP TFR UPI/CR/317744804593/RAMSWRUP/UBIN/ashwini.sa/Paym",
        externalReference: "317744804593",
        notes: "Confirmed personal income received from Ramswrup via UPI (UTR 317744804593).",
      },
    ];

    for (const tx of sbiNewTransactions) {
      const exists = sanitizedTransactions.some(
        (t) =>
          t.id === tx.id ||
          (tx.externalReference && t.externalReference === tx.externalReference) ||
          (t.amount === tx.amount &&
            t.occurredOn === tx.occurredOn &&
            ((tx.fromAccountId && t.fromAccountId === tx.fromAccountId) ||
              (tx.toAccountId && t.toAccountId === tx.toAccountId))),
      );
      if (!exists) {
        sanitizedTransactions.push({ ...tx, userId });
      }
    }

    // 3e. Ensure Amazon Pay Later repayment debited from SBI on 02 Oct 2026 is present
    const amazonRepaymentRef = "627516147601";
    const hasAmazonRepayment = sanitizedTransactions.some(
      (t) =>
        t.externalReference === amazonRepaymentRef ||
        (t.amount === "6954.15" && t.occurredOn === "2026-10-02"),
    );
    if (!hasAmazonRepayment && hasAmazon) {
      sanitizedTransactions.push({
        id: "tx-amzn-repayment-screenshot",
        userId,
        amount: "6954.15",
        currency: "INR",
        kind: "bill_payment",
        status: "posted",
        occurredOn: "2026-10-02",
        merchant: "Amazon Pay Later",
        description: "UPI/DR/627516147601/Amazon Pay/YESB/amazonpayl/Re",
        category: "Bills",
        platform: "Amazon",
        fromAccountId: sbiAccountId,
        toAccountId: amazonAccountId,
        externalReference: amazonRepaymentRef,
        notes:
          "Confirmed Amazon Pay Later repayment debited from SBI Savings on 02 Oct 2026 (UTR 627516147601).",
      });
    }
  }

  // 4. Ensure Utkarsh SuperMoney Credit Card transactions and repayments if user owns SBI or Utkarsh account
  if (hasSbi || hasUtkarsh) {
    const utkarshRepayments: Omit<Transaction, "userId">[] = [
      {
        id: "a4efa024-0010-4888-8000-000000000941",
        kind: "bill_payment",
        status: "posted",
        amount: "941.75",
        currency: "INR",
        occurredOn: "2026-10-02",
        fromAccountId: sbiAccountId,
        toAccountId: utkarshAccountId,
        category: null,
        merchant: "Utkarsh SuperMoney Credit Card",
        description: "WDL TFRUPI/DR/212191910755/Utkarsh/UTKS/supercard@/Paym",
        externalReference: "212191910755",
        notes: "Utkarsh SuperMoney credit card bill payment debited from SBI Savings (UTR 212191910755).",
      },
      {
        id: "a4efa024-0011-4888-8000-000000000832",
        kind: "bill_payment",
        status: "posted",
        amount: "832.01",
        currency: "INR",
        occurredOn: "2026-10-09",
        fromAccountId: sbiAccountId,
        toAccountId: utkarshAccountId,
        category: null,
        merchant: "Utkarsh SuperMoney Credit Card",
        description: "WDL TFRUPI/DR/446687461536/Utkarsh/UTKS/supercard@/Paym",
        externalReference: "446687461536",
        notes: "Utkarsh SuperMoney credit card bill payment debited from SBI Savings (UTR 446687461536).",
      },
    ];

    for (const tx of utkarshRepayments) {
      const exists = sanitizedTransactions.some(
        (t) =>
          t.id === tx.id ||
          (tx.externalReference && t.externalReference === tx.externalReference) ||
          (t.amount === tx.amount &&
            t.occurredOn === tx.occurredOn &&
            t.fromAccountId === tx.fromAccountId &&
            t.toAccountId === tx.toAccountId),
      );
      if (!exists) {
        sanitizedTransactions.push({ ...tx, userId });
      }
    }

    const utkarshSpends: Omit<Transaction, "userId">[] = [
      {
        id: "7e83d8e2-0001-4888-8000-000000000140",
        kind: "expense",
        status: "posted",
        amount: "140.00",
        currency: "INR",
        occurredOn: "2026-10-02",
        fromAccountId: utkarshAccountId,
        toAccountId: null,
        category: "Food",
        platform: "Domino's",
        merchant: "Dominospizza",
        description: "Domino's — Pepper Barbecue Chicken pizzas",
        notes: "SuperMoney statement verified: Dominospizza ₹140.00 SUCCESS on Utkarsh XX32.",
      },
      {
        id: "7e83d8e2-0002-4888-8000-000000000360",
        kind: "expense",
        status: "posted",
        amount: "360.00",
        currency: "INR",
        occurredOn: "2026-10-06",
        fromAccountId: utkarshAccountId,
        toAccountId: null,
        category: "Education",
        merchant: "Arif Khan",
        description: "Stationery / Study materials paid to Arif Khan",
        notes: "SuperMoney statement verified: Arif Khan ₹360.00 SUCCESS on Utkarsh XX32.",
      },
      {
        id: "7e83d8e2-0003-4888-8000-000000000040",
        kind: "expense",
        status: "posted",
        amount: "40.00",
        currency: "INR",
        occurredOn: "2026-10-06",
        fromAccountId: utkarshAccountId,
        toAccountId: null,
        category: "Food",
        merchant: "Kripa Proteins",
        description: "Kripa Proteins — Grocery / Protein items",
        notes: "SuperMoney statement verified: Kripa Proteins ₹40.00 SUCCESS on Utkarsh XX32.",
      },
      {
        id: "7e83d8e2-0004-4888-8000-000000000291",
        kind: "expense",
        status: "posted",
        amount: "291.00",
        currency: "INR",
        occurredOn: "2026-10-08",
        fromAccountId: utkarshAccountId,
        toAccountId: null,
        category: "Shopping",
        platform: "Flipkart",
        merchant: "Flipkart Internet Private Limited",
        description: "Flipkart — POND'S Hydra Miracle Gel",
        notes: "SuperMoney statement verified: FLIPKART INTERNET ₹291.00 SUCCESS on Utkarsh XX32.",
      },
      {
        id: "7e83d8e2-0005-4888-8000-000000000257",
        kind: "expense",
        status: "posted",
        amount: "257.22",
        currency: "INR",
        occurredOn: "2026-10-10",
        fromAccountId: utkarshAccountId,
        toAccountId: null,
        category: "Transport",
        platform: "Uber",
        merchant: "Uber India Systems Private Limited",
        description: "Uber — Ride payment",
        notes: "SuperMoney statement verified: UBER INDIA SYSTEMS ₹257.22 SUCCESS on Utkarsh XX32.",
      },
      {
        id: "7e83d8e2-0006-4888-8000-000000000041",
        kind: "expense",
        status: "posted",
        amount: "40.00",
        currency: "INR",
        occurredOn: "2026-10-12",
        fromAccountId: utkarshAccountId,
        toAccountId: null,
        category: "Food",
        merchant: "Aman Enterprises",
        description: "Aman Enterprises — Cold drinks / refreshments",
        notes: "SuperMoney statement verified: AMAN ENTERPRISES ₹40.00 SUCCESS on Utkarsh XX32.",
      },
      {
        id: "7e83d8e2-0007-4888-8000-000000000224",
        kind: "expense",
        status: "posted",
        amount: "224.00",
        currency: "INR",
        occurredOn: "2026-10-25",
        fromAccountId: utkarshAccountId,
        toAccountId: null,
        category: "Shopping",
        merchant: "Aman Enterprises",
        description: "Aman Enterprises — Store purchase",
        notes:
          "SuperMoney statement verified: AMAN ENTERPRISES ₹224.00 SUCCESS on Utkarsh XX32 (retried after 1st attempt failed).",
      },
      {
        id: "7e83d8e2-0008-4888-8000-000000000141",
        kind: "expense",
        status: "posted",
        amount: "140.49",
        currency: "INR",
        occurredOn: "2026-10-30",
        fromAccountId: utkarshAccountId,
        toAccountId: null,
        category: "Food",
        platform: "Zomato",
        merchant: "Zomato",
        description: "Zomato — Food order",
        notes: "SuperMoney statement verified: ZOMATO ₹140.49 SUCCESS on Utkarsh XX32.",
      },
      {
        id: "7e83d8e2-0009-4888-8000-000000000136",
        kind: "expense",
        status: "posted",
        amount: "136.19",
        currency: "INR",
        occurredOn: "2026-10-31",
        fromAccountId: utkarshAccountId,
        toAccountId: null,
        category: "Food",
        platform: "Zomato",
        merchant: "Laziz Pizza",
        description: "Zomato — Laziz Pizza Food Order",
        notes: "SuperMoney statement verified: ZOMATO ₹136.19 SUCCESS on Utkarsh XX32.",
      },
    ];

    for (const tx of utkarshSpends) {
      const exists = sanitizedTransactions.some(
        (t) =>
          t.id === tx.id ||
          (t.amount === tx.amount &&
            t.occurredOn === tx.occurredOn &&
            (t.fromAccountId === tx.fromAccountId || !t.fromAccountId) &&
            (t.description?.toLowerCase().includes(tx.category?.toLowerCase() || "") ||
              t.merchant?.toLowerCase().includes(tx.merchant?.toLowerCase() || "") ||
              t.platform?.toLowerCase().includes(tx.platform?.toLowerCase() || ""))),
      );
      if (!exists) {
        sanitizedTransactions.push({ ...tx, userId });
      }
    }
  }

  // Sanitize accounts (SBI notes, ICICI notes, Utkarsh SuperMoney, + IDFC card closure)
  const sanitizedAccounts = workspace.accounts ? [...workspace.accounts] : undefined;
  if (sanitizedAccounts && sanitizedAccounts.length > 0) {
    let foundUtkarshInAccounts = false;
    for (let i = 0; i < sanitizedAccounts.length; i++) {
      const a = sanitizedAccounts[i];
      if (a.id === sbiAccountId) {
        sanitizedAccounts[i] = {
          ...a,
          openingBalance: a.openingBalance || "1089.32",
          openingBalanceDate: a.openingBalanceDate || "2026-10-01",
          notes:
            "Statement period 1–31 October 2026. Opening balance ₹1,089.32; verified closing balance ₹19,000.00 CR (75 debits totaling ₹73,488.12, 35 credits totaling ₹91,398.80). Mini-statement available balance ₹18,575.85 as of 25 Oct 2026 (23:43).",
        };
      } else if (a.id === iciciAccountId) {
        sanitizedAccounts[i] = {
          ...a,
          openingBalance: a.openingBalance || "0.01",
          openingBalanceDate: a.openingBalanceDate || "2026-10-01",
          notes:
            "Statement period 1–31 October 2026. Opening balance ₹0.01; verified closing balance ₹223.44 CR (28 statement transactions + month-end bank charge of ₹60.30).",
        };
      } else if (a.id === idfcAccountId) {
        sanitizedAccounts[i] = {
          ...a,
          active: false,
          notes: "Card closed on 25 Oct 2026 upon ₹48.90 cashback statement credit and FD encashment.",
        };
      } else if (a.id === utkarshAccountId || a.maskedSuffix === "XX32") {
        foundUtkarshInAccounts = true;
        sanitizedAccounts[i] = {
          ...a,
          kind: "credit_card" as const,
          creditLimit: a.creditLimit || "990.00",
          active: true,
          notes:
            "Utkarsh SuperMoney RuPay Credit Card on UPI (YES BANK). Credit limit ₹990.00. Statement period 1–31 Oct 2026 verified: 9 successful spends totaling ₹1,628.90, 2 repayments totaling ₹1,773.76, closing outstanding ₹797.90.",
        };
      }
    }

    if (!foundUtkarshInAccounts && (hasSbi || hasIcici)) {
      sanitizedAccounts.push({
        id: utkarshAccountId,
        userId,
        name: "Utkarsh SuperMoney • XX32",
        institution: "Utkarsh",
        kind: "credit_card",
        maskedSuffix: "XX32",
        creditLimit: "990.00",
        active: true,
        notes:
          "Utkarsh SuperMoney RuPay Credit Card on UPI (YES BANK). Credit limit ₹990.00. Statement period 1–31 Oct 2026 verified: 9 successful spends totaling ₹1,628.90, 2 repayments totaling ₹1,773.76, closing outstanding ₹797.90.",
      });
    }
  }

  // Sanitize snapshots (SBI and ICICI verified 31 Oct balances + IDFC zero balance snapshot)
  let sanitizedSnapshots = workspace.snapshots;
  if (Array.isArray(workspace.snapshots) && (hasSbi || hasIdfc || hasIcici)) {
    sanitizedSnapshots = [...workspace.snapshots];
    if (hasSbi) {
      const sbiSnapshotId = "c2607015-0023-4888-a007-251018575850";
      if (!sanitizedSnapshots.some((s) => s.id === sbiSnapshotId)) {
        sanitizedSnapshots.push({
          id: sbiSnapshotId,
          userId,
          accountId: sbiAccountId,
          asOf: "2026-10-25T23:43:00+05:30",
          reportedBalance: "18575.85",
          source: "bank_statement",
          verifiedByUser: true,
        });
      }
      const sbiSnapshot31Id = "a4efa024-0031-4888-8000-000031101900";
      if (!sanitizedSnapshots.some((s) => s.id === sbiSnapshot31Id)) {
        sanitizedSnapshots.push({
          id: sbiSnapshot31Id,
          userId,
          accountId: sbiAccountId,
          asOf: "2026-10-31T23:59:59+05:30",
          reportedBalance: "19000.00",
          source: "bank_statement",
          verifiedByUser: true,
        });
      }
    }
    if (hasIcici) {
      const iciciSnapshot31Id = "c2607015-0031-4888-8000-000031100283";
      const existingIciciIndex = sanitizedSnapshots.findIndex(
        (s) =>
          s.id === iciciSnapshot31Id ||
          (s.accountId === iciciAccountId && s.asOf.startsWith("2026-10-31")),
      );
      const iciciSnapshot = {
        id: iciciSnapshot31Id,
        userId,
        accountId: iciciAccountId,
        asOf: "2026-10-31T23:59:59+05:30",
        reportedBalance: "223.44",
        source: "bank_statement" as const,
        verifiedByUser: true,
      };
      if (existingIciciIndex >= 0) {
        sanitizedSnapshots[existingIciciIndex] = iciciSnapshot;
      } else {
        sanitizedSnapshots.push(iciciSnapshot);
      }
    }
    if (hasIdfc) {
      const idfcSnapshotId = "c2607015-0024-4888-a008-251000000000";
      if (!sanitizedSnapshots.some((s) => s.id === idfcSnapshotId)) {
        sanitizedSnapshots.push({
          id: idfcSnapshotId,
          userId,
          accountId: idfcAccountId,
          asOf: "2026-10-25T23:43:00+05:30",
          reportedBalance: "0.00",
          reportedOutstanding: "0.00",
          source: "bank_statement",
          verifiedByUser: true,
        });
      }
    }
    if (hasSbi || hasIcici || hasUtkarsh) {
      const utkarshSnapshotId = "7e83d8e2-0031-4888-8000-000031100797";
      if (
        !sanitizedSnapshots.some(
          (s) =>
            s.id === utkarshSnapshotId ||
            (s.accountId === utkarshAccountId && s.asOf.startsWith("2026-10-31")),
        )
      ) {
        sanitizedSnapshots.push({
          id: utkarshSnapshotId,
          userId,
          accountId: utkarshAccountId,
          asOf: "2026-10-31T23:59:59+05:30",
          reportedBalance: "-797.90",
          reportedOutstanding: "797.90",
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

  // Update Navi Personal Loan & EMI #1 if present in workspace
  const naviLoanId = "20b7d2f7-5853-5e57-aa97-0a57619c611b";
  const naviLoanIndex = sanitizedLoans.findIndex(
    (l) => l.id === naviLoanId || l.name?.toLowerCase().includes("navi"),
  );
  if (naviLoanIndex >= 0) {
    sanitizedLoans[naviLoanIndex] = {
      ...sanitizedLoans[naviLoanIndex],
      reportedOutstanding: "7000.00",
      reportedAsOf: "2026-10-30",
      notes:
        "Navi 3-month personal loan (₹3,500/month). EMI #1 confirmed paid on 30 Oct 2026.",
    };
  }

  // Update Navi EMI #1 due date to 2026-10-30
  const naviEmi1Id = "b1945f2c-6bc1-5edc-a3c2-001879c2a307";
  const naviEmi1Index = sanitizedEmis.findIndex(
    (e) =>
      e.id === naviEmi1Id ||
      (e.loanId === naviLoanId && e.number === 1) ||
      (naviLoanIndex >= 0 && e.loanId === sanitizedLoans[naviLoanIndex].id && e.number === 1),
  );
  if (naviEmi1Index >= 0) {
    sanitizedEmis[naviEmi1Index] = {
      ...sanitizedEmis[naviEmi1Index],
      dueDate: "2026-10-30",
    };
  }

  // Ensure EMI allocation exists linking Navi EMI #1 to the ₹3,500 payment
  const sanitizedEmiAllocations = Array.isArray(workspace.emiAllocations)
    ? [...workspace.emiAllocations]
    : [];

  const naviTx = sanitizedTransactions.find(
    (t) =>
      t.amount === "3500.00" &&
      (t.externalReference === "144089859407" ||
        t.merchant?.toLowerCase().includes("navi") ||
        t.description?.toLowerCase().includes("navi") ||
        t.description?.includes("144089859407")),
  );

  const targetNaviEmiId =
    naviEmi1Index >= 0 ? sanitizedEmis[naviEmi1Index].id : naviEmi1Id;

  if (naviTx && (naviLoanIndex >= 0 || naviEmi1Index >= 0)) {
    const hasNaviAlloc = sanitizedEmiAllocations.some(
      (a) => a.emiId === targetNaviEmiId || a.transactionId === naviTx.id,
    );
    if (!hasNaviAlloc) {
      sanitizedEmiAllocations.push({
        id: "a4efa024-alloc-navi-0001",
        userId,
        emiId: targetNaviEmiId,
        transactionId: naviTx.id,
        amount: "3500.00",
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
    emiAllocations: sanitizedEmiAllocations,
    transactions: sanitizedTransactions,
    ...(sanitizedEmiAgreements.length > 0
      ? { emiAgreements: sanitizedEmiAgreements }
      : {}),
  };
}
