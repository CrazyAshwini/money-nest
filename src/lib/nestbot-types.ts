import type { Money, TransactionKind } from "./types";

export interface ProposedTransaction {
  id: string;
  amount: Money;
  currency: string;
  kind: TransactionKind;
  occurredOn: string;
  description: string;
  merchant?: string;
  category: string;
  platform?: string;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  fromAccountName?: string;
  toAccountName?: string;
  externalReference?: string;
  sourceObjectId?: string;
  sourceSystem: string;
  notes?: string;
}

export interface NestBotMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  suggestedActions?: string[];
  proposedTransaction?: ProposedTransaction;
  confirmedTransactionId?: string;
  duplicateWarning?: {
    existingId: string;
    description: string;
    date: string;
    amount: string;
  };
  error?: string;
}

export interface BotRequestPayload {
  message: string;
  history?: NestBotMessage[];
  image?: {
    data: string; // base64
    mimeType: string;
    name?: string;
  };
  action?: "chat" | "confirm_transaction";
  confirmedTransaction?: ProposedTransaction;
}

export interface BotResponsePayload {
  configured: boolean;
  reply: string;
  message: NestBotMessage;
  proposedTransaction?: ProposedTransaction;
  confirmedTransactionId?: string;
  error?: string;
}
