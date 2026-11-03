"use client";

import { BrandLockup } from "../brand-lockup";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import * as Dialog from "@radix-ui/react-dialog";
import {
  NAV_ITEMS,
  WorkspaceNavigation,
  MobileBottomBar,
} from "../workspace-navigation";
import { resolveAppPage } from "@/lib/page-metadata";
import { WorkspaceLoading } from "../workspace-loading";
import "../shell.css";
import "../fintech-screens.css";
import "../dashboard.css";
import "../workspace-layout.css";
import { type SpendingMode } from "@/lib/analytics-presentation";
import { DashboardWelcome } from "../dashboard-welcome";
import {
  CalendarDays,
  Bell,
  Search,
  Plus,
  ArrowUpRight,
  ChevronLeft,
  Menu,
  Check,
  X,
  Info,
  CircleAlert,
} from "lucide-react";
import { useFinance } from "../finance-provider";
import { NestBot } from "../nestbot";
import { PrivateProfilePage } from "../private-profile";
import { OrdersPage } from "../orders-page";
import { Empty } from "../ui";
import { RecordEditor, type EditorState } from "../editors";
import {
  ImportsPage,
  GroupsPage,
  SettingsPage,
  LoginPage,
  PasswordRecoveryPage,
  NotificationsPage,
} from "../workspace-pages";
import { dashboardMetrics, monthLabel } from "@/lib/finance";
import { TransactionsWorkspace } from "../transactions-workspace";
import { Dashboard } from "./dashboard";
import { AccountsPage } from "./accounts-page";
import { BillsPage } from "./bills-page";
import { DepositsPage } from "./deposits-page";
import { LoansPage } from "./loans-page";

const AnalyticsWorkspace = dynamic(
  () =>
    import("../analytics-workspace").then((module) => module.AnalyticsWorkspace),
  { ssr: false, loading: () => <div role="status">Loading analytics…</div> },
);

export function FinanceApp() {
  const {
    mode,
    backend,
    profile,
    data,
    month,
    setMonth,
    message,
    messageKind,
    dismissMessage,
    refresh,
    loadingStage,
    loadingError,
  } = useFinance();
  const pathname = usePathname();
  const [analyticsMode, setAnalyticsMode] = useState<SpendingMode>("gross");
  const [botOpen, setBotOpen] = useState(false);
  const [botTrigger, setBotTrigger] = useState<HTMLButtonElement | null>(null);
  const [mobile, setMobile] = useState(false);
  const navigationTrigger = useRef<HTMLButtonElement | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorTrigger, setEditorTrigger] = useState<HTMLElement | null>(null);
  const part = pathname.split("/").filter(Boolean);
  const pageInfo = resolveAppPage(part);
  const page = pageInfo?.page || "dashboard";
  const id = part[1];
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobile(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  if (mode === "loading") return <WorkspaceLoading stage={loadingStage} />;
  if (page === "reset-password") return <PasswordRecoveryPage />;
  if (mode === "error")
    return (
      <WorkspaceLoading
        stage={loadingStage}
        error={loadingError}
        onRetry={() => {
          setEditor(null);
          setMobile(false);
          void refresh();
        }}
      />
    );
  if (page === "login" || mode === "login")
    return backend === "local" ? <PrivateProfilePage /> : <LoginPage />;
  if (page === "profile" && mode !== "private" && mode !== "cloud" && mode !== "demo")
    return <PrivateProfilePage />;
  const title =
    page === "analytics"
      ? "Analytics"
      : page === "profile"
        ? "Profile"
        : pageInfo?.title || "Money Nest";
  const mainTab =
    !id &&
    ["dashboard", "accounts", "analytics", "profile", "transactions"].includes(
      page,
    );
  const detailRecords =
    page === "accounts"
      ? data.accounts
      : page === "bills"
        ? data.bills
        : page === "fixed-deposits"
          ? data.fixedDeposits
          : page === "loans"
            ? data.loans
            : [];
  const detailPage = Boolean(
    id && detailRecords.some((record) => record.id === id),
  );
  const metrics = dashboardMetrics(data, month);
  const open = (e: EditorState) => {
    setEditorTrigger(
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
    );
    setBotOpen(false);
    setEditor(e);
  };
  const openNestBot = (trigger: HTMLButtonElement) => {
    setBotTrigger(trigger);
    setBotOpen(true);
  };
  const active = NAV_ITEMS.find((n) => n.href === `/${page}`)?.title || title;
  return (
    <Dialog.Root open={mobile} onOpenChange={setMobile}>
      <div className="app-shell">
        <a href="#workspace-content" className="skip-link">
          Skip to content
        </a>
        <aside className="sidebar desktop-sidebar">
          <WorkspaceNavigation
            page={page}
            mode={mode}
            profile={profile}
            reviewCount={metrics.reviewCount}
            onNavigate={() => setMobile(false)}
          />
        </aside>
        <Dialog.Portal>
          <Dialog.Overlay className="navigation-overlay" />
          <Dialog.Content
            className="navigation-drawer"
            onCloseAutoFocus={(event) => {
              // The header and bottom bar share this dialog; restore the opener
              // used for this interaction rather than Radix's last trigger ref.
              if (navigationTrigger.current) {
                event.preventDefault();
                navigationTrigger.current.focus();
              }
            }}
          >
            <Dialog.Title className="sr-only">Workspace menu</Dialog.Title>
            <Dialog.Description className="sr-only">
              Choose a page in Money Nest.
            </Dialog.Description>
            <Dialog.Close
              className="icon-button navigation-close"
              aria-label="Close navigation"
            >
              <X size={20} />
            </Dialog.Close>
            <WorkspaceNavigation
              page={page}
              mode={mode}
              profile={profile}
              reviewCount={metrics.reviewCount}
              onNavigate={() => setMobile(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
        <div
          className={`app-main ${page === "dashboard" ? "dashboard-main" : ""}`}
        >
          {page === "dashboard" ? (
            <header className="topbar dashboard-topbar">
              <Link
                href="/dashboard"
                className="brand dashboard-mobile-brand"
                aria-label="Money Nest home"
              >
                <BrandLockup />
              </Link>
              <DashboardWelcome onOpenNestBot={openNestBot} />
              <div className="topbar-right">
                <Link
                  href="/transactions"
                  className="search-shortcut"
                  aria-label="Search transactions"
                >
                  <Search size={16} />
                  <span>Search transactions</span>
                </Link>
                <Link
                  href="/notifications"
                  aria-label="Notifications"
                  className="notification-button"
                >
                  <Bell size={19} />
                  {metrics.reviewCount > 0 && <i />}
                </Link>
                <button
                  type="button"
                  className="button primary dashboard-header-add"
                  onClick={() => open({ type: "transaction" })}
                >
                  <Plus size={16} aria-hidden="true" /> Add transaction
                </button>
              </div>
              <div className="dashboard-overview-heading">
                <h2 id="financial-overview-title">Financial overview</h2>
                <Link href="/analytics" className="overview-period">
                  {monthLabel(month)}
                </Link>
              </div>
            </header>
          ) : (
            !mainTab &&
            page !== "accounts" && (
              <header className="workspace-secondary-header">
                {!detailPage && (
                  <Link
                    href={id ? `/${page}` : "/profile"}
                    className="text-link secondary-back"
                  >
                    <ChevronLeft size={18} aria-hidden="true" /> Back
                  </Link>
                )}
                <span>{active}</span>
                <Dialog.Trigger asChild>
                  <button
                    className="icon-button mobile-menu"
                    aria-label="Open navigation"
                    onClick={(event) => {
                      navigationTrigger.current = event.currentTarget;
                    }}
                  >
                    <Menu size={20} />
                  </button>
                </Dialog.Trigger>
              </header>
            )
          )}
          {mode === "demo" && (
            <div className="demo-strip">
              <span className="demo-dot" />
              <span>
                <strong>Demo workspace</strong> · Fictional data, as of 9 Oct
                2026. Saved only in this browser.
              </span>
              <Link href="/login">
                Connect your workspace <ArrowUpRight size={12} />
              </Link>
            </div>
          )}
          <main
            id="workspace-content"
            tabIndex={-1}
            className={`main-content ${page === "dashboard" ? "home-content" : ""}`}
          >
            {page !== "dashboard" && page !== "transactions" && !detailPage && (
              <div
                className={`workspace-page-heading ${page === "profile" ? "workspace-profile-heading" : page === "analytics" ? "workspace-analytics-heading" : ""}`}
              >
                <h1>{title}</h1>
                <div className="workspace-context-actions">
                  {page === "analytics" && (
                    <>
                      <div className="month-picker">
                        <CalendarDays size={16} aria-hidden="true" />
                        <input
                          aria-label="Selected month"
                          type="month"
                          value={month}
                          onChange={(event) =>
                            setMonth(event.target.value || month)
                          }
                        />
                      </div>
                      <select
                        aria-label="Spending display"
                        className="small-select analytics-mode-select"
                        value={analyticsMode}
                        onChange={(event) =>
                          setAnalyticsMode(event.target.value as SpendingMode)
                        }
                      >
                        <option value="gross">Gross spending</option>
                        <option value="net">Net after refunds</option>
                      </select>
                    </>
                  )}
                  {(page === "accounts" || page === "pay-later") && (
                    <button
                      className="button primary"
                      onClick={() => open({ type: "account" })}
                    >
                      <Plus size={16} aria-hidden="true" /> Add account
                    </button>
                  )}
                </div>
              </div>
            )}
            {page === "dashboard" ? (
              <Dashboard open={open} />
            ) : page === "accounts" ? (
              <AccountsPage id={id} open={open} />
            ) : page === "transactions" ? (
              <TransactionsWorkspace
                onEdit={(transaction) =>
                  open({ type: "transaction", record: transaction })
                }
              />
            ) : page === "bills" ? (
              <BillsPage id={id} open={open} />
            ) : page === "pay-later" ? (
              <AccountsPage onlyPayLater open={open} />
            ) : page === "fixed-deposits" ? (
              <DepositsPage id={id} open={open} />
            ) : page === "loans" || page === "emi-calendar" ? (
              <LoansPage
                id={id}
                calendar={page === "emi-calendar"}
                open={open}
              />
            ) : page === "split-bills" ? (
              <GroupsPage id={id} open={open} />
            ) : page === "imports" ? (
              <ImportsPage />
            ) : page === "orders" ? (
              <OrdersPage />
            ) : page === "analytics" ? (
              <AnalyticsWorkspace
                mode={analyticsMode}
                onOpenTransaction={(transaction) =>
                  open({ type: "transaction", record: transaction })
                }
              />
            ) : page === "notifications" ? (
              <NotificationsPage />
            ) : page === "settings" ? (
              <SettingsPage />
            ) : page === "profile" ? (
              <PrivateProfilePage />
            ) : (
              <Empty
                title="Page not found"
                description="Use the sidebar to return to your workspace."
              />
            )}
            <footer className="page-footer">
              <span>
                <span className="status-dot" />{" "}
                {mode === "demo"
                  ? "Demo workspace · device-local"
                  : mode === "private"
                    ? "Private profile · this computer"
                    : "Secure workspace · Supabase"}
              </span>
              <span>
                ©{" "}
                {new Intl.DateTimeFormat("en", {
                  year: "numeric",
                  timeZone: "Asia/Kolkata",
                }).format(new Date())}{" "}
                Money Nest
              </span>
              <nav className="footer-links" aria-label="Footer navigation">
                <Link href="/settings">Settings</Link>
                {page !== "dashboard" && (
                  <button
                    type="button"
                    className="text-link footer-nestbot"
                    aria-label="Open Money Nest Bot"
                    aria-haspopup="dialog"
                    disabled={Boolean(editor)}
                    onClick={(event) => openNestBot(event.currentTarget)}
                  >
                    NestBot
                  </button>
                )}
                <Link href="/settings#data">Data & privacy</Link>
              </nav>
            </footer>
          </main>
        </div>
        <MobileBottomBar
          page={page}
          mode={mode}
          onAdd={() =>
            open({
              type: "transaction",
              kind: "expense",
            })
          }
        />
        <NestBot
          open={botOpen}
          onOpenChange={setBotOpen}
          trigger={botTrigger}
          onReceiptRequest={() => open({ type: "transaction" })}
        />
        {editor && (
          <RecordEditor
            editor={editor}
            onClose={() => setEditor(null)}
            returnFocusTo={editorTrigger}
          />
        )}
        <div
          className={`toast ${messageKind} ${message ? "visible" : ""}`}
          role={messageKind === "error" ? "alert" : "status"}
        >
          {messageKind === "error" ? (
            <CircleAlert size={16} />
          ) : messageKind === "info" ? (
            <Info size={16} />
          ) : (
            <Check size={16} />
          )}
          <span>{message}</span>
          {message && (
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={dismissMessage}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
    </Dialog.Root>
  );
}
