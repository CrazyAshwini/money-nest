"use client";

import { useState } from "react";
import { latestAccountBalanceSnapshot, localDateISO } from "@/lib/finance";
import { type AppliedReceipt } from "../receipt-scanner";
import {
  getCategoryPlatformOptions,
  OTHER_PLATFORM,
} from "@/lib/category-platforms";
import type { WorkspaceData } from "@/lib/types";
import type { EditorState, TransactionValues } from "./types";
import { transactionValues } from "./values";
export function useTransactionEditorState({
  editor,
  data,
  today,
  setError,
}: {
  editor: EditorState;
  data: WorkspaceData;
  today: string;
  setError: (message: string) => void;
}) {
  const allocatedLoan =
    editor.type === "transaction"
      ? data.loans.find((loan) =>
          data.emis.some(
            (emi) =>
              emi.loanId === loan.id &&
              data.emiAllocations.some(
                (allocation) =>
                  allocation.emiId === emi.id &&
                  allocation.transactionId === editor.record?.id,
              ),
          ),
        )
      : undefined;
  const externalLender =
    editor.type === "transaction"
      ? editor.record?.notes?.match(
          /^Confirmed external lender: (.*?)\./,
        )?.[1] ||
        allocatedLoan?.lender ||
        ""
      : "";
  const [transaction, setTransaction] = useState(() =>
    transactionValues(
      editor.type === "transaction" ? editor.record : undefined,
      today,
      externalLender,
      editor.type === "transaction" ? editor.kind : undefined,
    ),
  );
  const [receipt, setReceipt] = useState<AppliedReceipt | null>(null);
  const [receiptQueue, setReceiptQueue] = useState<
    Array<{ receipt: AppliedReceipt; id: string }>
  >([]);
  const [receiptIndex, setReceiptIndex] = useState(0);
  const [otherPlatform, setOtherPlatform] = useState(
    editor.type === "transaction" && editor.record?.platform === OTHER_PLATFORM,
  );
  const [receiptReviewed, setReceiptReviewed] = useState(false);
  const [receiptPaymentConfirmed, setReceiptPaymentConfirmed] = useState(false);
  const [pendingConfirmed, setPendingConfirmed] = useState(false);
  const [externalPayerChosen, setExternalPayerChosen] = useState(
    Boolean(
      editor.type === "transaction" &&
      editor.record?.externalPayer &&
      !editor.record.fromAccountId,
    ),
  );
  const [balanceChoices, setBalanceChoices] = useState<Record<string, string>>(
    {},
  );
  const sameDayBalances = (["from", "to"] as const).flatMap((side) => {
    const accountId = transaction[`${side}AccountId`];
    const snapshot = latestAccountBalanceSnapshot(data, accountId, today);
    const account = data.accounts.find((item) => item.id === accountId);
    if (
      !snapshot ||
      !account ||
      localDateISO(snapshot.asOf) !== transaction.occurredOn
    )
      return [];
    const key = `${side}:${accountId}:${snapshot.id}:${transaction.occurredOn}`;
    const previous = editor.type === "transaction" ? editor.record : undefined;
    const previousMatches =
      previous?.[`${side}AccountId`] === accountId &&
      previous.occurredOn === transaction.occurredOn;
    const choice =
      balanceChoices[key] ??
      (previousMatches && previous?.[`${side}BalanceSnapshotId`] === snapshot.id
        ? "excluded"
        : previousMatches && previous?.status === "posted"
          ? "included"
          : "");
    return [{ side, account, snapshot, key, choice }];
  });
  function updateTransaction<K extends keyof TransactionValues>(
    key: K,
    value: TransactionValues[K],
  ) {
    setTransaction((current) => ({ ...current, [key]: value }));
    setReceiptReviewed(false);
    setReceiptPaymentConfirmed(false);
    setPendingConfirmed(false);
    if (
      key === "fromAccountId" ||
      key === "toAccountId" ||
      key === "occurredOn"
    )
      setBalanceChoices({});
  }
  function applyReceiptFields(applied: AppliedReceipt) {
    const draft = applied.draft;
    setTransaction({
      ...transactionValues(undefined, "", ""),
      description: draft.description || "",
      amount: draft.amount || "",
      occurredOn: draft.occurredOn || "",
      merchant: draft.merchant || "",
      platform: draft.platform || "",
      externalReference: draft.externalReference || "",
      kind: draft.kind || transaction.kind,
      category: draft.category || "Other",
      status: "pending_review",
    });
    setReceipt(applied);
    setOtherPlatform(false);
    setExternalPayerChosen(false);
    setReceiptReviewed(false);
    setReceiptPaymentConfirmed(false);
    setPendingConfirmed(false);
    setBalanceChoices({});
    setError("");
  }
  function applyReceipt(applied: AppliedReceipt) {
    setReceiptQueue([]);
    setReceiptIndex(0);
    applyReceiptFields(applied);
  }
  function applyReceiptBatch(receipts: AppliedReceipt[]) {
    if (!receipts.length) return;
    setReceiptQueue(
      receipts.map((receipt) => ({ receipt, id: crypto.randomUUID() })),
    );
    setReceiptIndex(0);
    applyReceiptFields(receipts[0]);
  }
  function changeCategory(category: string) {
    setTransaction((current) => {
      const previousPresets = getCategoryPlatformOptions(current.category);
      const nextPresets = getCategoryPlatformOptions(category);
      const incompatiblePreset =
        !otherPlatform &&
        current.platform !== OTHER_PLATFORM &&
        previousPresets.includes(current.platform) &&
        !nextPresets.includes(current.platform);
      return {
        ...current,
        category,
        platform: incompatiblePreset ? "" : current.platform,
      };
    });
    setReceiptReviewed(false);
    setReceiptPaymentConfirmed(false);
    setPendingConfirmed(false);
  }
  function changePlatform(platform: string) {
    setOtherPlatform(platform === OTHER_PLATFORM);
    setTransaction((current) => ({
      ...current,
      platform:
        platform === OTHER_PLATFORM
          ? getCategoryPlatformOptions(current.category).includes(
              current.platform,
            ) &&
            current.platform !== OTHER_PLATFORM &&
            !otherPlatform
            ? ""
            : current.platform
          : platform,
    }));
    setReceiptReviewed(false);
    setReceiptPaymentConfirmed(false);
    setPendingConfirmed(false);
  }
  return {
    transaction,
    setTransaction,
    receipt,
    receiptQueue,
    receiptIndex,
    setReceiptIndex,
    otherPlatform,
    receiptReviewed,
    setReceiptReviewed,
    receiptPaymentConfirmed,
    setReceiptPaymentConfirmed,
    pendingConfirmed,
    setPendingConfirmed,
    externalPayerChosen,
    setExternalPayerChosen,
    balanceChoices,
    setBalanceChoices,
    sameDayBalances,
    updateTransaction,
    applyReceiptFields,
    applyReceipt,
    applyReceiptBatch,
    changeCategory,
    changePlatform,
  };
}
export type TransactionEditorController = ReturnType<
  typeof useTransactionEditorState
>;
