"use client";
import { Field } from "../ui";
import type { EditorState } from "./types";
import type { ReactNode } from "react";
import { input } from "./input";
export function LoanFields({
  editor,
  options,
}: {
  editor: Extract<EditorState, { type: "loan" }>;
  options: ReactNode;
}) {
  return (
    <>
      <Field label="Loan name">
        {input("name", editor.record?.name, "text", true)}
      </Field>
      <Field label="Lender / person">
        {input("lender", editor.record?.lender, "text", true)}
      </Field>
      <Field label="Loan type">
        <select
          name="kind"
          defaultValue={editor.record?.kind || "institutional"}
        >
          <option value="institutional">Institutional</option>
          <option value="lent">Money lent</option>
          <option value="borrowed">Money borrowed</option>
        </select>
      </Field>
      <Field label="Original contractual principal · ₹">
        {input(
          "contractualPrincipal",
          editor.record?.contractualPrincipal,
          "number",
        )}
      </Field>
      <Field label="Net disbursed · ₹">
        {input("netDisbursed", editor.record?.netDisbursed, "number")}
      </Field>
      <Field label="Reported outstanding · ₹">
        {input(
          "reportedOutstanding",
          editor.record?.reportedOutstanding,
          "number",
        )}
      </Field>
      <Field label="Reported as of">
        {input("reportedAsOf", editor.record?.reportedAsOf, "date")}
      </Field>
      <Field label="Annual rate · %">
        {input("annualRate", editor.record?.annualRate, "number")}
      </Field>
      <Field label="Disbursed on">
        {input("disbursedOn", editor.record?.disbursedOn, "date")}
      </Field>
      <Field label="Repayment account">
        <select
          name="repaymentAccountId"
          defaultValue={editor.record?.repaymentAccountId || ""}
        >
          <option value="">Unconfirmed</option>
          {options}
        </select>
      </Field>
      <p className="form-note full">
        Unknown values can stay blank. A disbursement is a liability; scheduled
        repayments do not establish an interest breakdown.
      </p>
    </>
  );
}
