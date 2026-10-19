"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { AppBrandIcon } from "./brand-lockup";
import styles from "./workspace-loading.module.css";

export type WorkspaceLoadingStage =
  | "initializing"
  | "checking-session"
  | "loading-records"
  | "preparing-dashboard";

const stageMessages: Record<WorkspaceLoadingStage, string> = {
  initializing: "Starting MoneyNest…",
  "checking-session": "Checking your session…",
  "loading-records": "Loading your financial records…",
  "preparing-dashboard": "Preparing your financial workspace…",
};

const quotes = [
  "Every rupee has a story. Make yours count.",
  "Small savings today, more possibilities tomorrow.",
  "A clearer picture of your money starts here.",
  "Your money, your goals, your nest.",
];

export function WorkspaceLoading({
  stage,
  error,
  onRetry,
}: {
  stage: WorkspaceLoadingStage;
  error?: string;
  onRetry?: () => void;
}) {
  const [quoteIndex, setQuoteIndex] = useState(0);
  useEffect(() => {
    if (error) return;
    const timer = window.setInterval(() => {
      setQuoteIndex((current) => (current + 1) % quotes.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [error]);

  return (
    <main
      className={styles.screen}
      data-workspace-loading=""
      data-stage={stage}
      aria-busy={!error}
    >
      <div className={styles.content}>
        <AppBrandIcon size={160} />
        <h1 className={styles.wordmark}>
          Money <span>NEST</span>
        </h1>
        {error ? (
          <div className={styles.failure}>
            <h2>Let’s try that again</h2>
            <p role="alert">{error}</p>
            <button className="button primary" type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <p className={styles.message} role="status" aria-live="polite">
              {stageMessages[stage]}
            </p>
            <div className={styles.progress}>
              <span className={styles.progressLabel} aria-hidden="true">
                Loading…
              </span>
              {/* The workspace endpoint combines session and data loading. It does
                  not report measurable progress, so a percentage would be invented. */}
              <div
                className={styles.track}
                role="progressbar"
                aria-label={stageMessages[stage]}
                aria-valuetext="Loading"
              >
                <span className={styles.indicator} />
              </div>
            </div>
            <div className={styles.quotes}>
              <p key={quoteIndex} className={styles.quote} data-loading-quote="">
                “{quotes[quoteIndex]}”
              </p>
              <div className={styles.dots} aria-hidden="true">
                {quotes.map((quote, index) => (
                  <span
                    key={quote}
                    className={index === quoteIndex ? styles.activeDot : undefined}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      <footer className={styles.footer}>
        <ShieldCheck size={16} aria-hidden="true" />
        <span>Your private financial workspace</span>
      </footer>
    </main>
  );
}
