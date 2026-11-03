"use client";
import Link from "next/link";
import { Field } from "../ui";
import { ACCOUNT_KINDS } from "@/lib/types";
import type { EditorState } from "./types";
import { human } from "./values";
import { input } from "./input";
export function AccountFields({
  editor,
  onClose,
}: {
  editor: Extract<EditorState, { type: "account" }>;
  onClose: () => void;
}) {
  return (
    <>
      <Field label="Account name">
        {input("name", editor.record?.name, "text", true)}
      </Field>
      <Field label="Institution">
        {input("institution", editor.record?.institution, "text", true)}
      </Field>
      <Field label="Account type">
        <select name="kind" defaultValue={editor.record?.kind || "bank"}>
          {ACCOUNT_KINDS.map((k) => (
            <option key={k} value={k}>
              {human(k)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Last four digits only">
        {input("maskedSuffix", editor.record?.maskedSuffix)}
      </Field>
      <Field label="Opening balance · ₹ (optional)">
        {input("openingBalance", editor.record?.openingBalance, "number")}
      </Field>
      <Field label="Opening balance date">
        {input("openingBalanceDate", editor.record?.openingBalanceDate, "date")}
      </Field>
      <Field label="Credit limit · ₹ (optional)">
        {input("creditLimit", editor.record?.creditLimit, "number")}
      </Field>
      <Field label="Status">
        <span className="check-row">
          <input
            type="checkbox"
            name="active"
            defaultChecked={editor.record?.active ?? true}
          />{" "}
          Active account
        </span>
      </Field>
      <Field label="Notes" className="full">
        {input("notes", editor.record?.notes)}
      </Field>
      {editor.record && (
        <Link
          href={`/accounts/${encodeURIComponent(editor.record.id)}?manage=reports`}
          onClick={onClose}
          className="account-management-editor-link full"
        >
          Statements and reports
        </Link>
      )}
    </>
  );
}
