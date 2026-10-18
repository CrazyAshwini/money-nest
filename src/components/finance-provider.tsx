"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  Fragment,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { cloneDemoData, DEMO_USER_ID } from "@/lib/seed";
import { validateWorkspaceRecord } from "@/lib/validation";
import { resolveAppPage } from "@/lib/page-metadata";
import type { WorkspaceData, OwnedRecord } from "@/lib/types";
import type { UserProfile } from "@/lib/profile-types";

const STORAGE_KEY = "finance-os:fictional-demo:v1";
const emptyWorkspace = (): WorkspaceData => ({
  accounts: [],
  snapshots: [],
  transactions: [],
  bills: [],
  allocations: [],
  fixedDeposits: [],
  loans: [],
  emis: [],
  emiAllocations: [],
  groups: [],
  shares: [],
  settlements: [],
  reminders: [],
  auditEvents: [],
});
type Mode = "loading" | "demo" | "cloud" | "private" | "login" | "error";
type ContextValue = {
  data: WorkspaceData;
  mode: Mode;
  backend: "local" | "supabase" | null;
  profile: UserProfile | null;
  needsSetup: boolean;
  emailRequired: boolean;
  signupEnabled: boolean;
  transactionSourceIds: Record<string, string[]>;
  userId: string;
  month: string;
  setMonth: (month: string) => void;
  today: string;
  toast: (message: string, kind?: "success" | "error" | "info") => void;
  message: string;
  messageKind: "success" | "error" | "info";
  dismissMessage: () => void;
  save: <K extends keyof WorkspaceData>(
    collection: K,
    record: WorkspaceData[K][number],
  ) => Promise<void>;
  refresh: () => Promise<boolean>;
  resetDemo: () => void;
  commitImport: (
    transactions: WorkspaceData["transactions"],
    inputHash: string,
    fileName: string,
  ) => Promise<number>;
};
const Context = createContext<ContextValue | null>(null);
const localDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function FinanceProvider({
  children,
  allowTestFixtures = false,
}: {
  children: React.ReactNode;
  allowTestFixtures?: boolean;
}) {
  const [data, setData] = useState<WorkspaceData>(emptyWorkspace);
  const currentData = useRef(data);
  const [mode, setMode] = useState<Mode>("loading");
  const [month, setMonth] = useState("2026-10");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error" | "info">(
    "success",
  );
  const [authUserId, setAuthUserId] = useState("");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [backend, setBackend] = useState<"local" | "supabase" | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [emailRequired, setEmailRequired] = useState(false);
  const [signupEnabled, setSignupEnabled] = useState(false);
  const [transactionSourceIds, setTransactionSourceIds] = useState<
    Record<string, string[]>
  >({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshGeneration = useRef(0);
  const activeIdentity = useRef("signed-out");
  const path = usePathname();
  const router = useRouter();
  const replaceData = useCallback((next: WorkspaceData) => {
    currentData.current = next;
    setData(next);
  }, []);
  const toast = useCallback(
    (text: string, kind: "success" | "error" | "info" = "success") => {
      setMessage(text);
      setMessageKind(kind);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(
        () => setMessage(""),
        kind === "error" ? 10_000 : 5000,
      );
    },
    [],
  );
  const dismissMessage = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setMessage("");
  }, []);
  const clearWorkspace = useCallback(() => {
    activeIdentity.current = "signed-out";
    replaceData(emptyWorkspace());
    setAuthUserId("");
    setProfile(null);
    setTransactionSourceIds({});
    setMonth(localDate().slice(0, 7));
    dismissMessage();
  }, [replaceData, dismissMessage]);
  const enterDemo = useCallback(() => {
    if (!allowTestFixtures) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : null;
      replaceData(
        parsed &&
          Object.keys(cloneDemoData()).every(
            (key) =>
              Array.isArray(parsed[key]) &&
              parsed[key].every(
                (row: OwnedRecord) => row.userId === DEMO_USER_ID,
              ),
          )
          ? parsed
          : cloneDemoData(),
      );
    } catch {
      replaceData(cloneDemoData());
    }
    setMode("demo");
    activeIdentity.current = "demo";
    setAuthUserId("");
    setBackend(null);
    setProfile(null);
  }, [allowTestFixtures, replaceData]);
  const refresh = useCallback(async () => {
    // A response belongs to the refresh that requested it. A delayed response
    // from a previous session must never replace the next user's workspace.
    const generation = ++refreshGeneration.current;
    // Browser storage cannot choose an authenticated workspace. Only an explicitly
    // isolated server permits this legacy flag for synthetic UI regression tests.
    try {
      if (!allowTestFixtures) sessionStorage.removeItem("finance-os:mode");
      else if (
        sessionStorage.getItem("finance-os:mode") === "demo" &&
        !window.location.pathname.startsWith("/profile") &&
        window.location.pathname !== "/login"
      ) {
        enterDemo();
        return true;
      }
    } catch {
      // Unavailable browser storage must still fall through to server authentication.
    }
    try {
      const res = await fetch("/api/workspace", { cache: "no-store" });
      const result = await res.json();
      if (generation !== refreshGeneration.current) return false;
      setBackend(
        result.backend === "local"
          ? "local"
          : result.configured === false
            ? null
            : "supabase",
      );
      setNeedsSetup(result.needsSetup === true);
      setSignupEnabled(result.signupEnabled === true);
      setTransactionSourceIds(
        result.backend === "supabase"
          ? (result.transactionSourceIds ?? {})
          : {},
      );
      setEmailRequired(
        result.emailRequired === true || Boolean(result.profile?.email),
      );
      if (result.configured === false) {
        clearWorkspace();
        setMode("login");
        return false;
      }
      if (!res.ok && res.status !== 401)
        throw new Error(result.error || "Your workspace could not be loaded.");
      if (!result.authenticated) {
        clearWorkspace();
        setMode("login");
        return false;
      }
      if (
        !res.ok ||
        !result.workspace ||
        typeof result.userId !== "string" ||
        !result.userId
      )
        throw new Error(result.error || "Your workspace could not be loaded.");
      const identity = `${result.backend === "local" ? "local" : "supabase"}:${result.userId}`;
      if (identity !== activeIdentity.current) {
        dismissMessage();
        setMonth(localDate().slice(0, 7));
      }
      activeIdentity.current = identity;
      replaceData(result.workspace);
      setAuthUserId(result.userId);
      setProfile(result.profile ?? null);
      setMode(result.backend === "local" ? "private" : "cloud");
      return true;
    } catch (error) {
      if (generation !== refreshGeneration.current) return false;
      clearWorkspace();
      setMode("error");
      toast(
        error instanceof Error
          ? error.message
          : "Unable to connect. Please retry.",
        "error",
      );
      return false;
    }
  }, [
    allowTestFixtures,
    enterDemo,
    toast,
    replaceData,
    clearWorkspace,
    dismissMessage,
  ]);
  // Hydration loads authenticated server state, or explicitly isolated test fixtures.
  useEffect(() => {
    const requests = refreshGeneration;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return () => {
      requests.current++;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);
  useEffect(() => {
    if (mode !== "cloud") return;
    const reload = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", reload);
    return () => {
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", reload);
    };
  }, [mode, refresh]);
  // Surface a browser-storage quota failure to the user when persisting the external store fails.
  useEffect(() => {
    if (mode === "demo") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        toast(
          "Browser storage is full. Export your demo changes before closing.",
          "error",
        );
      }
    }
  }, [data, mode, toast]);
  useEffect(() => {
    const resolved = resolveAppPage(path.split("/").filter(Boolean));
    if (
      mode === "login" &&
      resolved &&
      resolved.page !== "login" &&
      resolved.page !== "profile"
    )
      router.replace("/login");
  }, [mode, path, router]);
  async function save<K extends keyof WorkspaceData>(
    collection: K,
    record: WorkspaceData[K][number],
  ) {
    if (mode !== "demo" && mode !== "cloud" && mode !== "private")
      throw new Error("Your workspace is not ready.");
    const identity = mode === "demo" ? "demo" : `${backend}:${authUserId}`;
    if (identity !== activeIdentity.current)
      throw new Error(
        "Your sign-in changed. Reopen the editor in your current workspace.",
      );
    if (collection === "auditEvents")
      throw new Error("Audit history is recorded automatically.");
    const owner = mode === "demo" ? DEMO_USER_ID : authUserId;
    const current = currentData.current;
    const checked = validateWorkspaceRecord(current, collection, record, owner);
    if (mode === "cloud" || mode === "private") {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection, record: checked }),
      });
      const result = await res.json();
      if (identity !== activeIdentity.current)
        throw new Error("Your sign-in changed. Reopen your current workspace.");
      if (!res.ok)
        throw new Error(result.error || "Changes could not be saved.");
      const refreshed = await refresh();
      if (identity !== activeIdentity.current)
        throw new Error(
          "Your change was saved, but your session changed. Reopen your current workspace before trying again.",
        );
      if (!refreshed) {
        const message =
          "Your change was saved, but balances could not be refreshed. Reload the workspace before trying again.";
        toast(message, "error");
        throw new Error(message);
      }
      return;
    }
    const rows = current[collection] as OwnedRecord[];
    const exists = rows.some((row) => row.id === checked.id);
    replaceData({
      ...current,
      [collection]: exists
        ? rows.map((row) => (row.id === checked.id ? checked : row))
        : [...rows, checked],
      auditEvents: [
        ...current.auditEvents,
        {
          id: crypto.randomUUID(),
          userId: owner,
          entityType: collection,
          entityId: checked.id,
          action: exists ? "updated" : "created",
          description: `${collection} ${exists ? "updated" : "created"}`,
          occurredAt: new Date().toISOString(),
        },
      ],
    });
  }
  function resetDemo() {
    if (mode !== "demo") return;
    replaceData(cloneDemoData());
    toast("Fictional demo restored.");
  }
  async function commitImport(
    transactions: WorkspaceData["transactions"],
    inputHash: string,
    fileName: string,
  ) {
    if (mode !== "demo" && mode !== "cloud" && mode !== "private")
      throw new Error("Your workspace is not ready.");
    const identity = mode === "demo" ? "demo" : `${backend}:${authUserId}`;
    if (identity !== activeIdentity.current)
      throw new Error(
        "Your sign-in changed. Reopen the import in your current workspace.",
      );
    const owner = mode === "demo" ? DEMO_USER_ID : authUserId;
    const current = currentData.current;
    const checked = transactions.map((t) =>
      validateWorkspaceRecord(current, "transactions", t, owner),
    );
    if (mode === "cloud" || mode === "private") {
      const res = await fetch("/api/imports/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions: checked, inputHash, fileName }),
      });
      const result = await res.json();
      if (identity !== activeIdentity.current)
        throw new Error("Your sign-in changed. Reopen your current workspace.");
      if (!res.ok)
        throw new Error(result.error || "Import could not be saved.");
      const refreshed = await refresh();
      if (identity !== activeIdentity.current)
        throw new Error(
          "Your import was saved, but your session changed. Reopen your current workspace before trying again.",
        );
      if (!refreshed) {
        const message =
          "Your import was saved, but balances could not be refreshed. Reload the workspace before trying again.";
        toast(message, "error");
        throw new Error(message);
      }
      return result.count || 0;
    }
    const existing = new Set(
      current.transactions
        .filter((t) => t.sourceSystem && t.sourceObjectId)
        .map((t) => `${t.sourceSystem}:${t.sourceObjectId}`),
    );
    const fresh = checked.filter((t) => {
      if (!t.sourceSystem || !t.sourceObjectId)
        throw new Error(
          "Imported rows need their reviewed source identifiers.",
        );
      const key = `${t.sourceSystem}:${t.sourceObjectId}`;
      if (
        existing.has(key) ||
        current.transactions.some((row) => row.id === t.id)
      )
        return false;
      existing.add(key);
      return true;
    });
    replaceData({
      ...current,
      transactions: [...current.transactions, ...fresh],
      auditEvents: [
        ...current.auditEvents,
        {
          id: crypto.randomUUID(),
          userId: owner,
          entityType: "imports",
          entityId: inputHash,
          action: "committed",
          description: `${fileName}: ${fresh.length} reviewed rows imported`,
          occurredAt: new Date().toISOString(),
        },
      ],
    });
    return fresh.length;
  }
  const identity = authUserId
    ? `${backend}:${authUserId}`
    : mode === "demo"
      ? "demo"
      : "signed-out";
  const sessionToast = useCallback(
    (text: string, kind?: "success" | "error" | "info") => {
      if (activeIdentity.current === identity) toast(text, kind);
    },
    [identity, toast],
  );
  return (
    <Context.Provider
      value={{
        data,
        mode,
        backend,
        profile,
        needsSetup,
        emailRequired,
        signupEnabled,
        transactionSourceIds: mode === "cloud" ? transactionSourceIds : {},
        userId: mode === "demo" ? DEMO_USER_ID : authUserId,
        month,
        setMonth,
        today: mode === "demo" ? "2026-10-09" : localDate(),
        toast: sessionToast,
        message,
        messageKind,
        dismissMessage,
        save,
        refresh,
        resetDemo,
        commitImport,
      }}
    >
      <Fragment key={identity}>{children}</Fragment>
    </Context.Provider>
  );
}
export function useFinance() {
  const value = useContext(Context);
  if (!value) throw new Error("FinanceProvider is required");
  return value;
}
