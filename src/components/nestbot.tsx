"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  Send,
  Upload,
  AlertCircle,
  CheckCircle,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useFinance } from "./finance-provider";
import { NestBotAvatar } from "./brand-lockup";
import type {
  BotRequestPayload,
  BotResponsePayload,
  NestBotMessage,
  ProposedTransaction,
} from "@/lib/nestbot-types";
import "./nestbot.css";

const QUICK_PROMPTS = [
  "How much money do I have?",
  "What did I spend this month?",
  "Show my credit-card outstanding",
  "How much Amazon Pay Later credit is available?",
  "Which bills are due next?",
];

export function NestBot({
  open,
  onOpenChange,
  trigger,
  onReceiptRequest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: HTMLElement | null;
  onReceiptRequest: () => void;
}) {
  const { refresh } = useFinance();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<NestBotMessage[]>([
    {
      id: "initial-greeting",
      role: "assistant",
      content:
        "Hello! I'm Money Nest Bot. Ask me about your bank balances, monthly spending, credit card outstandings, or upcoming bills. The receipt button opens the transaction scanner form, where you can upload a screenshot, choose the correct account, and review the payment before saving.",
      createdAt: new Date().toISOString(),
      suggestedActions: QUICK_PROMPTS,
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipFocusRestore = useRef(false);

  useEffect(() => {
    if (open) {
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      messagesEndRef.current?.scrollIntoView({
        behavior: reducedMotion ? "instant" : "smooth",
        block: "end",
      });
    }
  }, [messages, open]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isLoading) return;

    const userMsg: NestBotMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const payload: BotRequestPayload = {
        message: query,
        history: messages.slice(-6),
        action: "chat",
      };

      const res = await fetch("/api/ai/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Error ${res.status}`);
      }

      const botResp: BotResponsePayload = await res.json();
      setMessages((prev) => [...prev, botResp.message]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            err instanceof Error
              ? err.message
              : "Unable to process your request. Please try again.",
          createdAt: new Date().toISOString(),
          error: "request_failed",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmTransaction = async (draft: ProposedTransaction) => {
    setIsLoading(true);
    try {
      const payload: BotRequestPayload = {
        message: "Confirm transaction",
        action: "confirm_transaction",
        confirmedTransaction: draft,
      };

      const res = await fetch("/api/ai/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Confirmation failed");
      }

      const botResp: BotResponsePayload = await res.json();
      setMessages((prev) => [
        ...prev.map((m) =>
          m.proposedTransaction?.id === draft.id
            ? { ...m, proposedTransaction: undefined }
            : m,
        ),
        botResp.message,
      ]);

      // Refresh financial data immediately
      await refresh();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Failed to post transaction: ${err instanceof Error ? err.message : "Unknown error"}`,
          createdAt: new Date().toISOString(),
          error: "posting_failed",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelTransaction = (draftId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.proposedTransaction?.id === draftId
          ? {
              ...m,
              proposedTransaction: undefined,
              content: `${m.content}\n*(Transaction discarded)*`,
            }
          : m,
      ),
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="nestbot-overlay" />
        <Dialog.Content
          className="nestbot-chat-window"
          aria-modal="true"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            skipFocusRestore.current = false;
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!skipFocusRestore.current && trigger?.isConnected) {
              trigger.focus({ preventScroll: true });
            }
          }}
        >
          <header className="nestbot-chat-header">
            <div className="nestbot-chat-header-info">
              <NestBotAvatar size={32} />
              <div>
                <Dialog.Title>Money Nest Bot</Dialog.Title>
                <Dialog.Description>
                  Ask about your saved finances or review a receipt.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="nestbot-icon-btn"
                aria-label="Close NestBot"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>
          {/* Message scroll container */}
          <div
            className="nestbot-messages"
            role="log"
            aria-label="NestBot conversation"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {messages.map((m) => (
              <div key={m.id} className={`nestbot-msg ${m.role}`}>
                <div className="nestbot-bubble">
                  <p>{m.content}</p>

                  {/* Quick prompt suggestions */}
                  {m.suggestedActions && m.suggestedActions.length > 0 && (
                    <div className="nestbot-quick-prompts">
                      {m.suggestedActions.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          className="nestbot-quick-pill"
                          onClick={() => handleSend(prompt)}
                          disabled={isLoading}
                        >
                          <Sparkles size={11} style={{ marginRight: 4 }} />
                          {prompt}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Duplicate warning banner */}
                  {m.duplicateWarning && (
                    <div className="nestbot-warning">
                      <AlertCircle
                        size={14}
                        style={{ marginRight: 4, display: "inline" }}
                      />
                      Existing match on {m.duplicateWarning.date}:{" "}
                      {m.duplicateWarning.description} (
                      {m.duplicateWarning.amount})
                    </div>
                  )}

                  {/* Proposed transaction confirmation card */}
                  {m.proposedTransaction && (
                    <div className="nestbot-confirm-card">
                      <h4>Confirm New Transaction</h4>
                      <div className="nestbot-confirm-meta">
                        <div>
                          Amount:{" "}
                          <strong>₹{m.proposedTransaction.amount}</strong>
                        </div>
                        <div>
                          Date:{" "}
                          <strong>{m.proposedTransaction.occurredOn}</strong>
                        </div>
                        <div>
                          Merchant:{" "}
                          <strong>
                            {m.proposedTransaction.merchant ||
                              m.proposedTransaction.description}
                          </strong>
                        </div>
                        {m.proposedTransaction.fromAccountName && (
                          <div>
                            Account:{" "}
                            <strong>
                              {m.proposedTransaction.fromAccountName}
                            </strong>
                          </div>
                        )}
                        <div>
                          Category:{" "}
                          <strong>{m.proposedTransaction.category}</strong>
                        </div>
                      </div>
                      <div className="nestbot-confirm-actions">
                        <button
                          type="button"
                          className="nestbot-btn-confirm"
                          onClick={() =>
                            handleConfirmTransaction(m.proposedTransaction!)
                          }
                          disabled={isLoading}
                        >
                          <CheckCircle
                            size={14}
                            style={{ marginRight: 4, display: "inline" }}
                          />
                          Confirm & Save
                        </button>
                        <button
                          type="button"
                          className="nestbot-btn-cancel"
                          onClick={() =>
                            handleCancelTransaction(m.proposedTransaction!.id)
                          }
                          disabled={isLoading}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="nestbot-msg assistant">
                <div
                  className="nestbot-bubble"
                  role="status"
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <Loader2 size={16} className="animate-spin" />
                  <span>Thinking & checking records...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <form
            className="nestbot-input-area"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <button
              type="button"
              className="nestbot-upload-btn"
              onClick={() => {
                skipFocusRestore.current = true;
                onOpenChange(false);
                onReceiptRequest();
              }}
              title="Open receipt scanner"
              aria-label="Upload receipt screenshot"
              disabled={isLoading}
            >
              <Upload size={17} />
            </button>
            <input
              ref={inputRef}
              aria-label="Message NestBot"
              type="text"
              className="nestbot-input"
              placeholder="Ask a question or request a change..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
            />
            <button
              type="submit"
              className="nestbot-send-btn"
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
