"use client";

import { useCallback, useSyncExternalStore } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bot, X } from "lucide-react";
import {
  dashboardFirstName,
  dashboardGreeting,
} from "@/lib/dashboard-greeting";
import { useFinance } from "./finance-provider";
import "./dashboard-welcome.css";

// A minute-aligned timer crosses 05:00, 12:00 and 17:00 without relying on a
// server clock. Rescheduling also picks up device clock/time-zone changes.
function subscribeToGreeting(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(timer);
    onChange();
    if (document.visibilityState !== "hidden") {
      timer = setTimeout(refresh, 60_000 - (Date.now() % 60_000));
    }
  };
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  refresh();
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}

// The server cannot know the browser's time zone. A stable initial snapshot
// hydrates safely, then React reads the local clock as soon as it subscribes.
const serverGreeting = () => null;

export function DashboardWelcome() {
  const { profile, mode } = useFinance();
  const authenticatedProfile =
    mode === "private" || mode === "cloud" ? profile : null;
  const timeZone = authenticatedProfile?.timezone;
  const readGreeting = useCallback(
    () => dashboardGreeting(new Date(), timeZone),
    [timeZone],
  );
  const greeting = useSyncExternalStore(
    subscribeToGreeting,
    readGreeting,
    serverGreeting,
  );
  const name = dashboardFirstName(authenticatedProfile?.displayName);

  return (
    <div className="dashboard-welcome">
      <h1 className="dashboard-welcome-heading">
        <span className="dashboard-greeting-prefix">
          {greeting || "Hello"},
        </span>{" "}
        <span className="dashboard-greeting-name">{name}</span>
      </h1>
      <Dialog.Root>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="nestbot-trigger"
            aria-label="Open NestBot"
          >
            <Bot size={19} aria-hidden="true" />
            <span>NestBot</span>
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="nestbot-overlay" />
          <Dialog.Content className="nestbot-panel" aria-modal="true">
            <div className="nestbot-heading">
              <div className="nestbot-title">
                <Bot size={22} aria-hidden="true" />
                <Dialog.Title>NestBot</Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="nestbot-close"
                  aria-label="Close NestBot"
                >
                  <X size={21} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <div className="nestbot-content">
              <span className="nestbot-status">Assistant unavailable</span>
              <Dialog.Description>
                NestBot chat is not available yet. MoneyNest does not currently
                have a connected chat assistant.
              </Dialog.Description>
              <p>
                You can continue managing your accounts and transactions in your
                workspace.
              </p>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
