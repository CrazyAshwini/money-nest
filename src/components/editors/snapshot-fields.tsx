"use client";
import { Field } from "../ui";
import { input } from "./input";
export function SnapshotFields({ today }: { today: string }) {
  return (
    <>
      <Field label="Reported as of · India time">
        {input("asOf", `${today}T12:00`, "datetime-local", true)}
      </Field>
      <Field label="Reported cash balance · ₹">
        {input("reportedBalance", "", "number")}
      </Field>
      <Field label="Reported outstanding · ₹">
        {input("reportedOutstanding", "", "number")}
      </Field>
      <Field label="Reported utilized · ₹">
        {input("reportedUtilized", "", "number")}
      </Field>
      <Field label="Reported available credit · ₹">
        {input("reportedAvailable", "", "number")}
      </Field>
      <Field label="Next statement date (not due date)">
        {input("nextStatementDate", "", "date")}
      </Field>
      <p className="form-note full">
        Saved as user reported. Enter at least one reported amount. This
        snapshot does not change ledger history.
      </p>
    </>
  );
}
