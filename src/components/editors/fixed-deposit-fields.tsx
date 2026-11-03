"use client";
import { Field } from "../ui";
import type { EditorState } from "./types";
import type { WorkspaceData } from "@/lib/types";
import type { ReactNode } from "react";
import { input } from "./input";
export function FixedDepositFields({
  editor,
  data,
  options,
}: {
  editor: Extract<EditorState, { type: "fd" }>;
  data: Pick<WorkspaceData, "accounts">;
  options: ReactNode;
}) {
  return (
    <>
      <Field label="Deposit label">
        {input("name", editor.record?.name, "text", true)}
      </Field>
      <Field label="Institution">
        {input("institution", editor.record?.institution, "text", true)}
      </Field>
      <Field label="Principal · ₹">
        {input("principal", editor.record?.principal, "number", true)}
      </Field>
      <Field label="Stated maturity value · ₹">
        {input("maturityAmount", editor.record?.maturityAmount, "number")}
      </Field>
      <Field label="Opening date">
        {input("openingDate", editor.record?.openingDate, "date")}
      </Field>
      <Field label="Maturity date">
        {input("maturityDate", editor.record?.maturityDate, "date")}
      </Field>
      <p className="form-note full">
        Leave contract dates blank until confirmed by the deposit advice. A
        funding payment does not confirm the opening date.
      </p>
      <Field label="Annual rate · %">
        {input("annualRate", editor.record?.annualRate, "number")}
      </Field>
      <Field label="Last four digits">
        {input("maskedSuffix", editor.record?.maskedSuffix)}
      </Field>
      <Field label="Pledged credit card">
        <select
          name="backingAccountId"
          defaultValue={
            editor.record?.pledged == null
              ? "__unknown__"
              : editor.record?.backingAccountId || ""
          }
        >
          <option value="__unknown__">Pledge unconfirmed</option>
          <option value="">Not pledged</option>
          {data.accounts
            .filter((a) => a.kind === "credit_card")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Payout account">
        <select
          name="payoutAccountId"
          defaultValue={editor.record?.payoutAccountId || ""}
        >
          <option value="">Unconfirmed</option>
          {options}
        </select>
      </Field>
      <Field label="Maturity instruction">
        <select
          name="maturityInstruction"
          defaultValue={editor.record?.maturityInstruction || "unconfirmed"}
        >
          <option value="unconfirmed">Unconfirmed</option>
          <option value="withdraw">Withdraw</option>
          <option value="reinvest">Reinvest</option>
        </select>
      </Field>
    </>
  );
}
