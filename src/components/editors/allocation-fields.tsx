"use client";
import { Field } from "../ui";
import type { EditorState } from "./types";
import type { WorkspaceData } from "@/lib/types";
import { input } from "./input";
export function AllocationFields({
  editor,
  data,
}: {
  editor: Extract<EditorState, { type: "allocation" }>;
  data: Pick<WorkspaceData, "transactions">;
}) {
  return (
    <>
      <Field label="Existing posted payment" className="full">
        <select name="transactionId" required>
          <option value="">Choose a ledger transaction</option>
          {data.transactions
            .filter(
              (t) =>
                t.status === "posted" &&
                (t.kind === "bill_payment" || t.kind === "transfer"),
            )
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.description} · ₹{t.amount} · {t.occurredOn}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Amount to apply · ₹">
        {input("amount", "", "number", true)}
      </Field>
      {editor.bill && (
        <Field label="Verification">
          <span className="check-row">
            <input name="verified" type="checkbox" defaultChecked /> Receiving
            statement confirms payment
          </span>
        </Field>
      )}
      <p className="form-note full">
        Allocations cannot exceed the payment or the remaining bill. Unverified
        card allocations remain provisional.
      </p>
    </>
  );
}
