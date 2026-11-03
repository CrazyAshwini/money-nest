"use client";
import { Field } from "../ui";
import type { EditorState } from "./types";
import type { WorkspaceData } from "@/lib/types";
import { input } from "./input";
export function BillFields({
  editor,
  data,
  today,
}: {
  editor: Extract<EditorState, { type: "bill" }>;
  data: Pick<WorkspaceData, "accounts">;
  today: string;
}) {
  return (
    <>
      <Field label="Credit / Pay Later account" className="full">
        <select
          name="accountId"
          defaultValue={editor.record?.accountId}
          required
        >
          {data.accounts
            .filter((a) => a.kind === "credit_card" || a.kind === "pay_later")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Statement amount · ₹">
        {input(
          "statementAmount",
          editor.record?.statementAmount,
          "number",
          true,
        )}
      </Field>
      <Field label="Statement date">
        {input(
          "statementDate",
          editor.record?.statementDate || today,
          "date",
          true,
        )}
      </Field>
      <Field label="Period begins">
        {input(
          "periodStart",
          editor.record?.periodStart || `${today.slice(0, 7)}-01`,
          "date",
          true,
        )}
      </Field>
      <Field label="Period ends">
        {input("periodEnd", editor.record?.periodEnd || today, "date", true)}
      </Field>
      <Field label="Confirmed payment due date">
        {input("dueDate", editor.record?.dueDate, "date")}
      </Field>
      <Field label="Minimum due · ₹">
        {input("minimumDue", editor.record?.minimumDue, "number")}
      </Field>
      <Field label="Statement credits · ₹">
        {input("statementCredits", editor.record?.statementCredits, "number")}
      </Field>
      <p className="form-note full">
        Leave the due date blank until confirmed by the issuer. Statement date
        and payment due date are different.
      </p>
    </>
  );
}
