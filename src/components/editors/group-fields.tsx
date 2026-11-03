"use client";
import { Field } from "../ui";
import type { WorkspaceData } from "@/lib/types";
import { input } from "./input";
export function GroupFields({
  data,
}: {
  data: Pick<WorkspaceData, "transactions">;
}) {
  return (
    <>
      <Field label="Event name" className="full">
        {input("title", "", "text", true)}
      </Field>
      <Field label="Existing purchase" className="full">
        <select name="transactionId" required>
          <option value="">Choose a posted expense</option>
          {data.transactions
            .filter(
              (t) =>
                t.kind === "expense" && t.status === "posted" && t.occurredOn,
            )
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.description} · ₹{t.amount}
              </option>
            ))}
        </select>
      </Field>
      <p className="form-note full">
        Add people and their shares from the group detail page. Contributions
        are matched to existing ledger transfers.
      </p>
    </>
  );
}
