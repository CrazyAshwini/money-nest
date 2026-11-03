import type {
  Account,
  Transaction,
  TransactionKind,
  Bill,
  FixedDeposit,
  Loan,
  ExpenseGroup,
  Emi,
} from "@/lib/types";
export type TransactionValues = {
  description: string;
  amount: string;
  occurredOn: string;
  kind: string;
  category: string;
  platform: string;
  merchant: string;
  fromAccountId: string;
  toAccountId: string;
  externalPayer: string;
  externalReference: string;
  status: string;
  refundOfTransactionId: string;
  externalLender: string;
  externalRepayment: boolean;
  notes: string;
};
export type EditorState =
  | { type: "account"; record?: Account }
  | { type: "transaction"; record?: Transaction; kind?: TransactionKind }
  | { type: "bill"; record?: Bill }
  | { type: "fd"; record?: FixedDeposit }
  | { type: "loan"; record?: Loan }
  | { type: "group"; record?: ExpenseGroup }
  | { type: "allocation"; bill?: Bill; emi?: Emi }
  | { type: "snapshot"; record: Account }
  | { type: "emi"; loan: Loan };
