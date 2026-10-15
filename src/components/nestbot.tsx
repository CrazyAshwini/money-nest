"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import {
  Bot,
  X,
  Minimize2,
  Maximize2,
  Send,
  Upload,
  AlertCircle,
  CheckCircle,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useFinance } from "./finance-provider";
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

export function NestBot({ onReceiptRequest }: { onReceiptRequest: () => void }) {
  const { refresh } = useFinance();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
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

  // Auto-scroll to latest message
  useEffect(() => {
    if (isOpen && !isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isMinimized]);

  // Listen for external trigger events (e.g. from header button)
  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      setIsMinimized(false);
    };
    window.addEventListener("open-nestbot", handleOpen);
    return () => window.removeEventListener("open-nestbot", handleOpen);
  }, []);

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
    <>
      {/* Floating launcher trigger */}
      {!isOpen && (
        <button
          type="button"
          className="nestbot-floating-trigger"
          onClick={() => {
            setIsOpen(true);
            setIsMinimized(false);
          }}
          aria-label="Open Money Nest Bot"
        >
          <Bot size={20} aria-hidden="true" />
          <span>Ask NestBot</span>
        </button>
      )}

      {/* Main chat window */}
      {isOpen && (
        <div className={`nestbot-chat-window ${isMinimized ? "minimized" : ""}`}>
          <div className="nestbot-chat-header">
            <div className="nestbot-chat-header-info">
              <Bot size={20} aria-hidden="true" />
              <h3>Money Nest Bot</h3>
              <span className="nestbot-chat-header-badge">AI Assistant</span>
            </div>
            <div className="nestbot-chat-header-actions">
              <button
                type="button"
                className="nestbot-icon-btn"
                onClick={() => setIsMinimized((v) => !v)}
                aria-label={isMinimized ? "Maximize NestBot" : "Minimize NestBot"}
              >
                {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
              </button>
              <button
                type="button"
                className="nestbot-icon-btn"
                onClick={() => setIsOpen(false)}
                aria-label="Close NestBot"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Message scroll container */}
              <div className="nestbot-messages">
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
                          <AlertCircle size={14} style={{ marginRight: 4, display: "inline" }} />
                          Existing match on {m.duplicateWarning.date}: {m.duplicateWarning.description} ({m.duplicateWarning.amount})
                        </div>
                      )}

                      {/* Proposed transaction confirmation card */}
                      {m.proposedTransaction && (
                        <div className="nestbot-confirm-card">
                          <h4>Confirm New Transaction</h4>
                          <div className="nestbot-confirm-meta">
                            <div>Amount: <strong>₹{m.proposedTransaction.amount}</strong></div>
                            <div>Date: <strong>{m.proposedTransaction.occurredOn}</strong></div>
                            <div>Merchant: <strong>{m.proposedTransaction.merchant || m.proposedTransaction.description}</strong></div>
                            {m.proposedTransaction.fromAccountName && (
                              <div>Account: <strong>{m.proposedTransaction.fromAccountName}</strong></div>
                            )}
                            <div>Category: <strong>{m.proposedTransaction.category}</strong></div>
                          </div>
                          <div className="nestbot-confirm-actions">
                            <button
                              type="button"
                              className="nestbot-btn-confirm"
                              onClick={() => handleConfirmTransaction(m.proposedTransaction!)}
                              disabled={isLoading}
                            >
                              <CheckCircle size={14} style={{ marginRight: 4, display: "inline" }} />
                              Confirm & Save
                            </button>
                            <button
                              type="button"
                              className="nestbot-btn-cancel"
                              onClick={() => handleCancelTransaction(m.proposedTransaction!.id)}
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
                    <div className="nestbot-bubble" style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                    setIsOpen(false);
                    onReceiptRequest();
                  }}
                  title="Open receipt scanner"
                  aria-label="Upload receipt screenshot"
                  disabled={isLoading}
                >
                  <Upload size={17} />
                </button>
                <input
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
            </>
          )}
        </div>
      )}
    </>
  );
}
