"use client";

import { useEffect, useState, useRef } from "react";
import { RefreshCw, X } from "lucide-react";
import styles from "./update-banner.module.css";

export function UpdateBanner() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const currentVersion = useRef<string | null>(null);

  useEffect(() => {
    let unmounted = false;

    async function checkVersion() {
      try {
        const res = await fetch("/api/version", {
          cache: "no-store",
          headers: { Pragma: "no-cache" },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.version) return;

        if (!currentVersion.current) {
          currentVersion.current = data.version;
        } else if (currentVersion.current !== data.version && !unmounted) {
          setHasUpdate(true);
        }
      } catch {
        /* Network errors are ignored silently */
      }
    }

    // Check on initial load
    checkVersion();

    // Check when user returns to the tab/PWA
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        checkVersion();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    // Periodic poll every 2 minutes
    const interval = setInterval(checkVersion, 120_000);

    return () => {
      unmounted = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
    };
  }, []);

  if (!hasUpdate || dismissed) return null;

  function reloadApp() {
    window.location.reload();
  }

  return (
    <aside
      className={styles.banner}
      role="status"
      aria-live="polite"
      aria-label="App update available"
    >
      <div className={styles.content}>
        <RefreshCw size={16} className={styles.icon} aria-hidden="true" />
        <span className={styles.text}>New update available</span>
        <button
          type="button"
          onClick={reloadApp}
          className={styles.updateButton}
        >
          Update now
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className={styles.dismissButton}
          aria-label="Dismiss update notification"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
