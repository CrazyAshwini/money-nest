"use client";
import { Field } from "../ui";
import type { EditorState } from "./types";
import type { WorkspaceData } from "@/lib/types";
import { input } from "./input";
export function EmiFields({
  editor,
  data,
}: {
  editor: Extract<EditorState, { type: "emi" }>;
  data: Pick<WorkspaceData, "emis">;
}) {
  return (
    <>
      <Field label="Installment number">
        {input(
          "number",
          data.emis.filter((e) => e.loanId === editor.loan.id).length + 1,
          "number",
          true,
        )}
      </Field>
      <Field label="Scheduled amount · ₹">
        {input("amount", "", "number", true)}
      </Field>
      <Field label="Exact due date">{input("dueDate", "", "date", true)}</Field>
      <p className="form-note full">
        An installment becomes paid only when an existing payment is allocated.
      </p>
    </>
  );
}
