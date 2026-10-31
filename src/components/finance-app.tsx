"use client";
import { BrandLockup } from "./brand-lockup";
import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import * as Dialog from "@radix-ui/react-dialog";
import {
  NAV_ITEMS,
  WorkspaceNavigation,
  MobileBottomBar,
} from "./workspace-navigation";
import { resolveAppPage } from "@/lib/page-metadata";
import { WorkspaceLoading } from "./workspace-loading";
import "./shell.css";
import "./fintech-screens.css";
import "./dashboard.css";
import "./workspace-layout.css";
import { FinancialCardCarousel } from "./financial-card-carousel";
import { VirtualAccountCard } from "./virtual-account-card";
import { AccountManagement } from "./account-management";
import {
  ownedAnalyticsData,
  type SpendingMode,
} from "@/lib/analytics-presentation";
import {
  getAggregateCreditAvailability,
  getAggregateCreditOutstanding,
} from "@/lib/credit-presentation";
import type { UsageSummary } from "@/lib/usage";
import { RecentAccountTransactions } from "./recent-account-transactions";
import { resolveSelectedAccountId } from "@/lib/account-presentation";
import { DashboardWelcome } from "./dashboard-welcome";
import { DashboardFinancialDetails } from "./dashboard-details";
import {
  Landmark,
  CreditCard,
  CalendarDays,
  ChartNoAxesCombined,
  Bell,
  Search,
  Plus,
  ArrowUpRight,
  ChevronRight,
  ChevronLeft,
  Wallet,
  MoreHorizontal,
  Menu,
  Check,
  Clock,
  X,
  Info,
  CircleAlert,
} from "lucide-react";
import { useFinance } from "./finance-provider";
import { NestBot } from "./nestbot";
import { PrivateProfilePage } from "./private-profile";
import { OrdersPage } from "./orders-page";
import { Section, Badge, Empty } from "./ui";
import { RecordEditor, type EditorState } from "./editors";
import {
  ImportsPage,
  GroupsPage,
  SettingsPage,
  LoginPage,
  PasswordRecoveryPage,
  NotificationsPage,
} from "./workspace-pages";
import {
  dashboardMetrics,
  formatMoney,
  formatDate,
  monthLabel,
  billSummary,
  emiSummary,
  sumMoney,
  transactionDirection,
  transactionNotionUrl,
} from "@/lib/finance";
import { TransactionsWorkspace } from "./transactions-workspace";
import { TransactionHistory } from "./unified-transaction-history";
import { TransactionIcon, transactionIconColor } from "./transaction-icon";
import { usageSummary } from "@/lib/usage";
import {
  type Account,
  type Bill,
  type Transaction,
  type WorkspaceData,
} from "@/lib/types";
const AnalyticsWorkspace = dynamic(
  () =>
    import("./analytics-workspace").then((module) => module.AnalyticsWorkspace),
  { ssr: false, loading: () => <div role="status">Loading analytics…</div> },
);
const kindLabel = (s: string) => s.replaceAll("_", " ");
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
  if (page === "profile" && mode !== "private" && mode !== "cloud")
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
type Open = (editor: EditorState) => void;
type FinancialSection = "bank" | "spending" | "credit" | "paylater";
function FinancialCard({
  section,
  title,
  value,
  valueLabel,
  caption,
  icon,
  active,
  onOpen,
  children,
}: {
  section: FinancialSection;
  title: string;
  value: string;
  valueLabel?: ReactNode;
  caption: string;
  icon: ReactNode;
  active: boolean;
  onOpen: (section: FinancialSection, trigger: HTMLButtonElement) => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={"stat financial-summary-card dashboard-card-" + section}
      aria-label={title + " details"}
      aria-describedby={`${valueLabel ? `financial-${section}-label ` : ""}financial-${section}-value${children ? ` financial-${section}-extra` : ""} financial-${section}-caption`}
      aria-haspopup="dialog"
      aria-expanded={active}
      onClick={(event) => onOpen(section, event.currentTarget)}
    >
      <span className="stat-top">
        <span>{title}</span>
        {icon}
      </span>
      {valueLabel && (
        <span
          id={`financial-${section}-label`}
          className="financial-value-label"
        >
          {valueLabel}
        </span>
      )}
      <strong id={`financial-${section}-value`}>{value}</strong>
      {children && <span id={`financial-${section}-extra`}>{children}</span>}
      <span id={`financial-${section}-caption`} className="stat-bottom">
        {caption}
      </span>
      <span className="financial-card-cue">
        <span>View details</span>
        <ChevronRight size={17} aria-hidden="true" />
      </span>
    </button>
  );
}
function creditStatusLabel(status: string, estimatedCount: number) {
  return status === "partial"
    ? estimatedCount
      ? "Partial · Estimated"
      : "Partial"
    : status === "estimated"
      ? "Estimated"
      : status === "verified"
        ? "Verified reports"
        : "";
}
function DashboardCreditAvailability({
  summary,
  payLater = false,
}: {
  summary: UsageSummary;
  payLater?: boolean;
}) {
  const availability = getAggregateCreditAvailability(summary.rows);
  const status = creditStatusLabel(
    availability.status,
    availability.estimatedCount,
  );
  const label = payLater ? "Available limit" : "Available credit";
  return (
    <span
      className="dashboard-credit-available"
      data-availability-status={availability.status}
    >
      <span>
        {availability.status === "partial"
          ? `Known ${label.toLowerCase()}`
          : label}
        {status && <small>{status}</small>}
      </span>
      <b>
        {availability.amount === null
          ? "Not available"
          : formatMoney(availability.amount)}
      </b>
    </span>
  );
}
function DashboardCreditLimit({
  summary,
  payLater = false,
}: {
  summary: UsageSummary;
  payLater?: boolean;
}) {
  const partial = summary.knownLimitCount < summary.count;
  const status = !summary.knownLimitCount
    ? "unknown"
    : partial
      ? "partial"
      : "known";
  return (
    <span className="dashboard-credit-limit" data-limit-status={status}>
      <span>
        {payLater ? "Total approved limit" : "Total credit limit"}
        {partial && summary.knownLimitCount > 0 && (
          <small>Known limits · Partial</small>
        )}
      </span>
      <b>
        {summary.knownLimitCount
          ? formatMoney(summary.limitTotal)
          : "Not available"}
      </b>
    </span>
  );
}
function Kpis() {
  const { data, month, today } = useFinance();
  const [details, setDetails] = useState<{
    section: FinancialSection;
    trigger: HTMLButtonElement;
  } | null>(null);
  const metrics = dashboardMetrics(data, month, today);
  const credit = usageSummary(data, "credit_card", today);
  const payLater = usageSummary(data, "pay_later", today);
  const show = (section: FinancialSection, trigger: HTMLButtonElement) =>
    setDetails({ section, trigger });
  const creditOutstanding = getAggregateCreditOutstanding(credit.rows);
  const payLaterOutstanding = getAggregateCreditOutstanding(payLater.rows);
  const outstandingLabel = (value: typeof creditOutstanding) => {
    const status = creditStatusLabel(value.status, value.estimatedCount);
    return (
      <>
        {value.label}
        {status && <small>{status}</small>}
      </>
    );
  };
  const accountCount = (
    summary: UsageSummary,
    singular: string,
    plural: string,
  ) =>
    summary.count
      ? `${summary.count} ${summary.count === 1 ? singular : plural}`
      : `No active ${plural}`;
  const bankCaption =
    (metrics.knownBankCount < metrics.totalBankCount
      ? `${metrics.knownBankCount}/${metrics.totalBankCount} balances known · Partial coverage`
      : `${metrics.totalBankCount} account${metrics.totalBankCount === 1 ? "" : "s"}`) +
    " · " +
    (metrics.bankAsOf
      ? metrics.updatedBankCount || metrics.openingBankCount
        ? "Calculated through " + formatDate(today)
        : "Reported from " + formatDate(metrics.bankAsOf)
      : "No balance reports");
  return (
    <>
      <section
        className="stats-grid home-kpis dashboard-financial-grid"
        aria-labelledby="financial-overview-title"
      >
        <FinancialCard
          section="bank"
          title="Total bank balance"
          value={
            metrics.knownBankCount > 0
              ? formatMoney(metrics.bankBalance)
              : "Not reported"
          }
          caption={bankCaption}
          icon={<Landmark size={20} aria-hidden="true" />}
          active={details?.section === "bank"}
          onOpen={show}
        />
        <FinancialCard
          section="spending"
          title={`Gross spending · ${monthLabel(month)}`}
          value={formatMoney(metrics.monthSpending)}
          caption={
            metrics.expenseCount + " posted expenses · " + monthLabel(month)
          }
          icon={<ArrowUpRight size={20} aria-hidden="true" />}
          active={details?.section === "spending"}
          onOpen={show}
        />
        <FinancialCard
          section="credit"
          title="Credit cards"
          value={
            creditOutstanding.amount === null
              ? "Not available"
              : formatMoney(creditOutstanding.amount)
          }
          valueLabel={outstandingLabel(creditOutstanding)}
          caption={accountCount(credit, "card", "cards")}
          icon={<CreditCard size={19} aria-hidden="true" />}
          active={details?.section === "credit"}
          onOpen={show}
        >
          <DashboardCreditAvailability summary={credit} />
          <DashboardCreditLimit summary={credit} />
        </FinancialCard>
        <FinancialCard
          section="paylater"
          title="Pay Later"
          value={
            payLaterOutstanding.amount === null
              ? "Not available"
              : formatMoney(payLaterOutstanding.amount)
          }
          valueLabel={outstandingLabel(payLaterOutstanding)}
          caption={accountCount(payLater, "provider", "providers")}
          icon={<Wallet size={19} aria-hidden="true" />}
          active={details?.section === "paylater"}
          onOpen={show}
        >
          <DashboardCreditAvailability summary={payLater} payLater />
          <DashboardCreditLimit summary={payLater} payLater />
        </FinancialCard>
      </section>
      {details && (
        <DashboardFinancialDetails
          section={details.section}
          trigger={details.trigger}
          onClose={() => setDetails(null)}
        />
      )}
    </>
  );
}
function Dashboard({ open }: { open: Open }) {
  const { data, month, today } = useFinance();
  const unpaid = data.bills
    .filter((b) => billSummary(data, b.id, today).remaining !== "0.00")
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const recent = data.transactions
    .filter((t) => t.occurredOn?.startsWith(month) && t.status !== "voided")
    .sort((a, b) => (b.occurredOn || "").localeCompare(a.occurredOn || ""))
    .slice(0, 4);
  return (
    <>
      <Kpis />
      <div className="dashboard-essential-grid">
        <Section title="Bills to pay" href="/bills" className="dashboard-bills">
          <div className="upcoming-list">
            {unpaid.slice(0, 3).map((b) => (
              <BillRow key={b.id} bill={b} />
            ))}
            {unpaid.length === 0 && (
              <Empty
                title="All caught up"
                description="No unpaid statements are recorded."
              />
            )}
          </div>
        </Section>
        <Section
          title="Recent transactions"
          href="/transactions"
          className="dashboard-activity"
        >
          {recent.length ? (
            <TransactionHistory
              transactions={recent}
              accounts={data.accounts}
              groupByDate={true}
              onSelectTransaction={(transaction) =>
                open({ type: "transaction", record: transaction })
              }
            />
          ) : (
            <Empty
              title="No activity this month"
              description="Add a transaction to get started."
            />
          )}
        </Section>
      </div>
      <Link href="/analytics" className="dashboard-insights text-link">
        <ChartNoAxesCombined size={14} /> Spending insights{" "}
        <ArrowUpRight size={13} />
      </Link>
    </>
  );
}
function BillRow({ bill }: { bill: Bill }) {
  const { data, today } = useFinance();
  const a = data.accounts.find((a) => a.id === bill.accountId);
  const summary = billSummary(data, bill.id, today);
  return (
    <Link href={`/bills/${bill.id}`} className="bill-row">
      <span
        className={`date-tile ${summary.status === "overdue" ? "red" : ""}`}
      >
        {bill.dueDate ? (
          <>
            <small>
              {new Date(bill.dueDate + "T00:00:00").toLocaleDateString(
                "en-GB",
                { month: "short" },
              )}
            </small>
            <strong>{bill.dueDate.slice(-2)}</strong>
          </>
        ) : (
          <Clock size={20} />
        )}
      </span>
      <div>
        <strong>{a?.name || "Statement"}</strong>
        <small>
          {bill.dueDate
            ? `Due ${formatDate(bill.dueDate)}`
            : "Due date not confirmed"}
        </small>
      </div>
      <div className="bill-row-end">
        <strong>{formatMoney(summary.remaining)}</strong>
        <Badge
          tone={
            summary.status === "overdue"
              ? "red"
              : summary.status === "partial"
                ? "amber"
                : "neutral"
          }
        >
          {summary.status}
        </Badge>
      </div>
    </Link>
  );
}
export function TransactionTable({
  transactions,
  onEdit,
}: {
  transactions: Transaction[];
  onEdit?: (t: Transaction) => void;
}) {
  const { data, mode, transactionSourceIds = {} } = useFinance();
  const accountsById = new Map(
    data.accounts.map((account) => [account.id, account]),
  );
  return transactions.length ? (
    <div className="table-wrap fintech-ledger">
      <table className="transaction-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Category</th>
            <th>Account</th>
            <th>Date</th>
            <th className="align-right">Amount</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const from = t.fromAccountId
              ? accountsById.get(t.fromAccountId)
              : undefined;
            const to = t.toAccountId
              ? accountsById.get(t.toAccountId)
              : undefined;
            const direction = transactionDirection(t);
            const incoming = direction === "incoming";
            const paired = direction === "between_accounts";
            const sourceIds = transactionSourceIds[t.id] ?? [];
            const notionUrls =
              mode === "demo"
                ? []
                : [
                    ...new Set(
                      [
                        transactionNotionUrl(t),
                        ...sourceIds.map((sourceObjectId) =>
                          transactionNotionUrl({
                            ...t,
                            sourceSystem: "notion",
                            sourceObjectId,
                          }),
                        ),
                      ].filter((url): url is string => Boolean(url)),
                    ),
                  ];
            const externalPayer =
              t.externalPayer && !/unconfirmed|unknown/i.test(t.externalPayer)
                ? t.externalPayer
                : null;
            return (
              <tr key={t.id}>
                <td>
                  <div className="transaction-description">
                    <span
                      className="txn-icon category-icon"
                      style={
                        {
                          "--category-color": transactionIconColor(t),
                        } as React.CSSProperties
                      }
                    >
                      <TransactionIcon transaction={t} />
                    </span>
                    <span>
                      <button className="row-link" onClick={() => onEdit?.(t)}>
                        {t.description}
                      </button>
                      <small>
                        {externalPayer
                          ? `Paid by ${externalPayer}`
                          : kindLabel(t.kind)}
                        {t.status === "pending_review" ? " · Needs review" : ""}
                      </small>
                      {notionUrls.length > 0 && (
                        <details>
                          <summary className="text-link">
                            Source details
                          </summary>
                          <small>
                            {notionUrls.map((notionUrl, index) => (
                              <a
                                key={notionUrl}
                                href={notionUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {index > 0 ? " · " : ""}View original Notion
                                record{" "}
                                <ArrowUpRight size={12} aria-hidden="true" />
                              </a>
                            ))}
                            {t.externalReference && (
                              <> · Reference: {t.externalReference}</>
                            )}
                          </small>
                        </details>
                      )}
                    </span>
                  </div>
                </td>
                <td>
                  <span className="category-pill">
                    {t.category || "Uncategorized"}
                  </span>
                </td>
                <td>
                  {paired
                    ? `${from?.name || "Unknown account"} → ${to?.name || "Unknown account"}`
                    : from?.name ||
                      to?.name ||
                      (externalPayer
                        ? `Paid by ${externalPayer}`
                        : "Payment account unknown")}
                </td>
                <td>
                  {t.occurredOn ? (
                    formatDate(t.occurredOn)
                  ) : (
                    <Badge tone="amber">Date needed</Badge>
                  )}
                </td>
                <td
                  className={`amount align-right ${incoming ? "green-text" : ""}`}
                >
                  {incoming
                    ? "+"
                    : direction === "outgoing"
                      ? "−"
                      : paired
                        ? "↔ "
                        : ""}
                  {formatMoney(t.amount)}
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${t.description}`}
                    onClick={() => onEdit?.(t)}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="No transactions here yet"
      description="Try another filter or add a transaction."
    />
  );
}
function AccountsPage({
  id,
  onlyPayLater,
  open,
}: {
  id?: string;
  onlyPayLater?: boolean;
  open: Open;
}) {
  const { data: workspace, today, userId } = useFinance();
  const data = useMemo(
    () => ownedAnalyticsData(workspace, userId),
    [workspace, userId],
  );
  const router = useRouter();
  const searchParams = useSearchParams();
  const [kind, setKind] = useState("all");
  const a = data.accounts.find((a) => a.id === id && a.userId === userId);
  if (id && !a)
    return (
      <>
        <Empty
          title="Account not found"
          description="It may have been archived or belongs to another workspace."
        />
        <Link href="/accounts" className="button">
          Return to accounts
        </Link>
      </>
    );
  if (a) {
    if (searchParams.get("manage") === "reports")
      return <AccountManagement account={a} onOpenEditor={open} />;
    const accounts = data.accounts.filter(
      (account) =>
        account.userId === userId &&
        account.kind === a.kind &&
        (account.active || account.id === a.id),
    );
    return (
      <div className="account-details-page">
        <Link href="/accounts" className="account-page-back">
          <ChevronLeft size={18} aria-hidden="true" /> Back
        </Link>
        <h1 className="sr-only">Account details</h1>
        <div className="account-group-panel account-detail-panel">
          <FinancialCardCarousel
            accounts={accounts}
            selectedId={a.id}
            onSelect={(nextId) =>
              router.replace(`/accounts/${encodeURIComponent(nextId)}`, {
                scroll: false,
              })
            }
            label={
              a.kind === "bank"
                ? "Bank accounts"
                : a.kind === "credit_card"
                  ? "Credit cards"
                  : a.kind === "pay_later"
                    ? "Pay Later accounts"
                    : "Wallets"
            }
            presentation="accounts"
            renderCard={(account) => (
              <VirtualAccountCard
                account={account}
                data={data}
                today={today}
                onEdit={(selected) =>
                  open({ type: "account", record: selected })
                }
              />
            )}
          />
          {data.loans.some((l) => l.repaymentAccountId === a.id) && (
            <Section
              title="Active EMI purchases"
              action={
                <Link href="/loans" className="text-link">
                  All loans & EMIs <ChevronRight size={14} />
                </Link>
              }
            >
              <div className="record-list">
                {data.loans
                  .filter((l) => l.repaymentAccountId === a.id)
                  .map((l) => (
                    <div className="record-row" key={l.id}>
                      <span className="grow">
                        <strong>{l.name}</strong>
                        <small>{l.notes || l.lender}</small>
                      </span>
                      <strong>
                        {formatMoney(l.contractualPrincipal || "0")}
                      </strong>
                      <Link href={`/loans/${l.id}`} className="button small">
                        Schedule
                      </Link>
                    </div>
                  ))}
              </div>
            </Section>
          )}
          <RecentAccountTransactions
            data={data}
            accountId={a.id}
            limit={5}
            variant="grouped"
            title="Statement history"
            onOpenTransaction={(transaction) =>
              open({ type: "transaction", record: transaction })
            }
          />
        </div>
      </div>
    );
  }
  const visibleAccounts = data.accounts.filter(
    (account) =>
      account.userId === userId &&
      (onlyPayLater
        ? account.kind === "pay_later"
        : kind === "all" || account.kind === kind),
  );
  const groups: { kind: Account["kind"]; label: string }[] = [
    { kind: "bank", label: "Bank accounts" },
    { kind: "credit_card", label: "Credit cards" },
    { kind: "pay_later", label: "Pay Later accounts" },
    { kind: "wallet", label: "Wallets" },
  ];
  const activeAccounts = visibleAccounts.filter((account) => account.active);
  const archivedAccounts = visibleAccounts.filter((account) => !account.active);
  const shownGroups = groups.filter((group) =>
    onlyPayLater
      ? group.kind === "pay_later"
      : kind === "all" || group.kind === kind,
  );
  return (
    <div className="accounts-overview">
      {!onlyPayLater && (
        <div
          className="account-kind-tabs"
          role="group"
          aria-label="Account kind"
        >
          {[
            { id: "all", label: "All" },
            { id: "bank", label: "Bank" },
            { id: "credit_card", label: "Cards" },
            { id: "pay_later", label: "Pay Later" },
            { id: "wallet", label: "Wallet" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={kind === item.id}
              className={kind === item.id ? "selected" : ""}
              onClick={() => setKind(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {shownGroups
        .filter(
          (group) =>
            kind !== "all" ||
            onlyPayLater ||
            activeAccounts.some((account) => account.kind === group.kind),
        )
        .map((group) => (
          <AccountGroup
            key={group.kind}
            label={group.label}
            open={open}
            data={data}
            today={today}
            accounts={activeAccounts.filter(
              (account) => account.kind === group.kind,
            )}
          />
        ))}
      {activeAccounts.length === 0 && kind === "all" && !onlyPayLater && (
        <Empty
          title="No active accounts"
          description="Add a bank, wallet, credit card or Pay Later provider. Archived accounts remain available below."
        />
      )}
      {archivedAccounts.length > 0 && (
        <details className="archived-accounts">
          <summary>Archived accounts ({archivedAccounts.length})</summary>
          {shownGroups
            .filter((group) =>
              archivedAccounts.some((account) => account.kind === group.kind),
            )
            .map((group) => (
              <AccountGroup
                key={group.kind}
                label={`Archived ${group.label.toLowerCase()}`}
                open={open}
                data={data}
                today={today}
                accounts={archivedAccounts.filter(
                  (account) => account.kind === group.kind,
                )}
              />
            ))}
        </details>
      )}
    </div>
  );
}

function AccountGroup({
  accounts,
  label,
  open,
  data,
  today,
}: {
  accounts: Account[];
  label: string;
  open: Open;
  data: WorkspaceData;
  today: string;
}) {
  const [selection, setSelection] = useState<string | null>(null);
  const selectedId = resolveSelectedAccountId(accounts, selection);
  return (
    <div className="account-group-panel">
      <FinancialCardCarousel
        accounts={accounts}
        selectedId={selectedId}
        onSelect={setSelection}
        label={label}
        presentation="accounts"
        renderCard={(account) => (
          <VirtualAccountCard
            account={account}
            data={data}
            today={today}
            onEdit={(selected) => open({ type: "account", record: selected })}
          />
        )}
      />
      {selectedId && (
        <RecentAccountTransactions
          data={data}
          accountId={selectedId}
          limit={4}
          variant="grouped"
          onOpenTransaction={(transaction) =>
            open({ type: "transaction", record: transaction })
          }
        />
      )}
    </div>
  );
}

function BillsPage({ id, open }: { id?: string; open: Open }) {
  const { data, today } = useFinance();
  const [status, setStatus] = useState("all");
  const bill = data.bills.find((b) => b.id === id);
  if (id && !bill)
    return (
      <>
        <Empty
          title="Statement not found"
          description="Return to Bills & payments to see your statements."
        />
        <Link href="/bills" className="button">
          Return to bills & payments
        </Link>
      </>
    );
  if (bill) {
    const a = data.accounts.find((a) => a.id === bill.accountId);
    const s = billSummary(data, bill.id, today);
    return (
      <>
        <DetailHeading
          title={a?.name || "Statement"}
          subtitle={`${formatDate(bill.periodStart)} — ${formatDate(bill.periodEnd)}`}
          back="/bills"
          action={
            <>
              <button
                className="button"
                onClick={() => open({ type: "bill", record: bill })}
              >
                Edit statement
              </button>
              <button
                className="button primary"
                onClick={() => open({ type: "allocation", bill })}
              >
                <Plus size={15} />
                Allocate payment
              </button>
            </>
          }
        />
        <Section
          title="Statement overview"
          action={
            <Badge
              tone={
                s.status === "paid"
                  ? "green"
                  : s.status === "overdue"
                    ? "red"
                    : "amber"
              }
            >
              {s.status}
            </Badge>
          }
        >
          <div className="bill-detail-grid">
            <div>
              <span>Statement amount</span>
              <strong>{formatMoney(s.statement)}</strong>
            </div>
            <div>
              <span>Already paid · verified</span>
              <strong className="green-text">{formatMoney(s.paid)}</strong>
            </div>
            <div>
              <span>Remaining bill</span>
              <strong>{formatMoney(s.remaining)}</strong>
            </div>
            <div>
              <span>Payment due date</span>
              <strong>
                {bill.dueDate ? formatDate(bill.dueDate) : "Not confirmed"}
              </strong>
            </div>
          </div>
          <div className="formula">
            Remaining = statement − verified payment allocations − statement
            credits ({formatMoney(s.credits)})
            {s.provisional !== "0.00" && (
              <> · {formatMoney(s.provisional)} remains provisional</>
            )}
          </div>
        </Section>
        <Section title="Payment allocations">
          <div className="record-list">
            {data.allocations
              .filter((x) => x.billId === bill.id)
              .map((x) => (
                <div className="record-row" key={x.id}>
                  <span>
                    <strong>
                      {
                        data.transactions.find((t) => t.id === x.transactionId)
                          ?.description
                      }
                    </strong>
                    <small>
                      Original ledger payment ·{" "}
                      {x.verified
                        ? "Confirmed by receiving statement"
                        : "Provisional match"}
                    </small>
                  </span>
                  <Badge tone={x.verified ? "green" : "amber"}>
                    {x.verified ? "Verified" : "Provisional"}
                  </Badge>
                  <strong>{formatMoney(x.amount)}</strong>
                </div>
              ))}
            {!data.allocations.some((x) => x.billId === bill.id) && (
              <Empty
                title="No payments applied"
                description="Match an existing bank payment to this statement."
              />
            )}
          </div>
        </Section>
      </>
    );
  }
  const bills = data.bills.filter(
    (b) => status === "all" || billSummary(data, b.id, today).status === status,
  );
  return (
    <>
      <div className="list-toolbar">
        <div className="tabs">
          {["all", "unpaid", "partial", "paid", "overdue"].map((s) => (
            <button
              key={s}
              className={status === s ? "selected" : ""}
              onClick={() => setStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <button className="button" onClick={() => open({ type: "bill" })}>
          <Plus size={15} />
          Add statement
        </button>
      </div>
      <div className="bills-grid">
        {bills.map((b) => {
          const s = billSummary(data, b.id, today);
          const a = data.accounts.find((a) => a.id === b.accountId);
          return (
            <Section
              key={b.id}
              title={a?.name || "Statement"}
              action={
                <Badge
                  tone={
                    s.status === "paid"
                      ? "green"
                      : s.status === "overdue"
                        ? "red"
                        : "amber"
                  }
                >
                  {s.status}
                </Badge>
              }
            >
              <p className="muted statement-period">
                Statement · {formatDate(b.statementDate)}
              </p>
              <div className="bill-values">
                <div>
                  <small>Statement amount</small>
                  <strong>{formatMoney(s.statement)}</strong>
                </div>
                <div>
                  <small>Already paid</small>
                  <strong>{formatMoney(s.paid)}</strong>
                </div>
                <div>
                  <small>Remaining bill</small>
                  <strong>{formatMoney(s.remaining)}</strong>
                </div>
                <div>
                  <small>Payment due</small>
                  <strong className="due-date">
                    {b.dueDate ? formatDate(b.dueDate) : "Unconfirmed"}
                  </strong>
                </div>
              </div>
              <Link href={`/bills/${b.id}`} className="panel-foot">
                View statement & payments <ArrowUpRight size={15} />
              </Link>
            </Section>
          );
        })}
      </div>
      {!bills.length && (
        <Empty
          title="No statements in this view"
          description="Add an actual issued statement to begin tracking payments."
          onAdd={() => open({ type: "bill" })}
        />
      )}
    </>
  );
}
function DepositsPage({ id, open }: { id?: string; open: Open }) {
  const { data } = useFinance();
  const fd = data.fixedDeposits.find((f) => f.id === id);
  if (id && !fd)
    return (
      <>
        <Empty
          title="Deposit not found"
          description="This deposit is not available in your workspace."
        />
        <Link href="/fixed-deposits" className="button">
          Return to fixed deposits
        </Link>
      </>
    );
  const rows = id
    ? data.fixedDeposits.filter((f) => f.id === id)
    : data.fixedDeposits;
  return (
    <>
      {fd && (
        <DetailHeading
          title={fd.name}
          subtitle={fd.institution}
          back="/fixed-deposits"
          action={
            <button
              className="button"
              onClick={() => open({ type: "fd", record: fd })}
            >
              Edit deposit
            </button>
          }
        />
      )}
      <div className="list-toolbar">
        <p className="muted">
          Pledged deposits are assets, and are excluded from available bank
          cash.
        </p>
        <button className="button" onClick={() => open({ type: "fd" })}>
          <Plus size={15} />
          Add deposit
        </button>
      </div>
      <div className="bills-grid">
        {rows.map((f) => (
          <Section
            key={f.id}
            title={f.name}
            action={
              <Badge
                tone={
                  f.pledged == null ? "neutral" : f.pledged ? "blue" : "green"
                }
              >
                {f.pledged == null
                  ? "Pledge unconfirmed"
                  : f.pledged
                    ? "Pledged"
                    : "Standalone"}
              </Badge>
            }
          >
            <p className="muted">
              {f.institution} · ••{f.maskedSuffix}
            </p>
            {(!f.openingDate || !f.maturityDate) && (
              <p className="muted">
                Contract dates remain unconfirmed until the deposit advice is
                available.
              </p>
            )}
            <div className="bill-values">
              <div>
                <small>Principal</small>
                <strong>{formatMoney(f.principal)}</strong>
              </div>
              <div>
                <small>Stated maturity value</small>
                <strong>{formatOptional(f.maturityAmount)}</strong>
              </div>
              <div>
                <small>Annual rate</small>
                <strong>
                  {f.annualRate ? `${f.annualRate}%` : "Unconfirmed"}
                </strong>
              </div>
              <div>
                <small>Opened on</small>
                <strong>{formatDate(f.openingDate)}</strong>
              </div>
              <div>
                <small>Matures on</small>
                <strong className="due-date">
                  {formatDate(f.maturityDate)}
                </strong>
              </div>
            </div>
            {f.backingAccountId && (
              <Link
                href={`/accounts/${f.backingAccountId}`}
                className="info-banner"
              >
                Backs{" "}
                {data.accounts.find((a) => a.id === f.backingAccountId)?.name}
                <ArrowUpRight size={14} />
              </Link>
            )}
            <div className="panel-foot">
              <Link className="text-link" href={`/fixed-deposits/${f.id}`}>
                View deposit <ChevronRight size={14} />
              </Link>
              <button
                className="text-link"
                onClick={() => open({ type: "fd", record: f })}
              >
                Edit
              </button>
            </div>
          </Section>
        ))}
      </div>
      {!rows.length && (
        <Empty
          title="A place for future plans"
          description="Add a fixed deposit and its actual maturity details."
          onAdd={() => open({ type: "fd" })}
        />
      )}
    </>
  );
}
function LoansPage({
  id,
  calendar,
  open,
}: {
  id?: string;
  calendar?: boolean;
  open: Open;
}) {
  const { data, today } = useFinance();
  const loan = data.loans.find((l) => l.id === id);
  if (id && !loan)
    return (
      <>
        <Empty
          title="Loan not found"
          description="This loan is not available in your workspace."
        />
        <Link href="/loans" className="button">
          Return to loans
        </Link>
      </>
    );
  const loans = id ? data.loans.filter((l) => l.id === id) : data.loans;
  return (
    <>
      {loan && (
        <DetailHeading
          title={loan.name}
          subtitle={`${loan.lender} · ${loan.kind}`}
          back="/loans"
          action={
            <>
              <button
                className="button"
                onClick={() => open({ type: "loan", record: loan })}
              >
                Edit loan
              </button>
              <button
                className="button primary"
                onClick={() => open({ type: "emi", loan })}
              >
                <Plus size={15} />
                Add installment
              </button>
            </>
          }
        />
      )}
      <div className="list-toolbar">
        <div className="tabs">
          <Link href="/loans" className={!calendar ? "selected" : ""}>
            Loans
          </Link>
          <Link href="/emi-calendar" className={calendar ? "selected" : ""}>
            EMI calendar
          </Link>
        </div>
        <button className="button" onClick={() => open({ type: "loan" })}>
          <Plus size={15} />
          Add loan
        </button>
      </div>
      {!calendar && (
        <div className="bills-grid">
          {loans.map((l) => (
            <Section key={l.id} title={l.name} action={<Badge>{l.kind}</Badge>}>
              <div className="bill-values">
                <div>
                  <small>Original principal</small>
                  <strong>{formatOptional(l.contractualPrincipal)}</strong>
                </div>
                <div>
                  <small>Net disbursed</small>
                  <strong>{formatOptional(l.netDisbursed)}</strong>
                </div>
                <div>
                  <small>Reported outstanding</small>
                  <strong>{formatOptional(l.reportedOutstanding)}</strong>
                </div>
                <div>
                  <small>Scheduled repayments</small>
                  <strong>
                    {formatMoney(
                      sumMoney(
                        data.emis
                          .filter((e) => e.loanId === l.id)
                          .map((e) => e.amount),
                      ),
                    )}
                  </strong>
                </div>
              </div>
              <div className="panel-foot">
                <Link href={`/loans/${l.id}`} className="text-link">
                  View schedule <ChevronRight size={14} />
                </Link>
                <button
                  className="text-link"
                  onClick={() => open({ type: "loan", record: l })}
                >
                  Edit
                </button>
              </div>
            </Section>
          ))}
        </div>
      )}
      <Section
        title={calendar ? "Upcoming installments" : "Repayment schedule"}
        subtitle="Payments are confirmed only through linked ledger allocations."
      >
        <div className="record-list">
          {data.emis
            .filter((e) => !id || e.loanId === id)
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
            .map((e) => {
              const s = emiSummary(data, e.id, today);
              return (
                <div className="record-row" key={e.id}>
                  <span className="date-tile">
                    <small>
                      {new Date(e.dueDate + "T00:00:00").toLocaleDateString(
                        "en-GB",
                        { month: "short" },
                      )}
                    </small>
                    <strong>{e.dueDate.slice(-2)}</strong>
                  </span>
                  <span className="grow">
                    <strong>
                      {data.loans.find((l) => l.id === e.loanId)?.name} · #
                      {e.number}
                    </strong>
                    <small>
                      {formatDate(e.dueDate)} · {formatMoney(s.paid)} paid
                    </small>
                  </span>
                  <Badge
                    tone={
                      s.status === "paid"
                        ? "green"
                        : s.status === "overdue"
                          ? "red"
                          : "neutral"
                    }
                  >
                    {kindLabel(s.status)}
                  </Badge>
                  <strong>{formatMoney(s.remaining)}</strong>
                  <button
                    className="button small"
                    onClick={() => open({ type: "allocation", emi: e })}
                  >
                    Match payment
                  </button>
                </div>
              );
            })}
          {!data.emis.length && (
            <Empty
              title="No installments recorded"
              description="Open a loan to add its confirmed repayment schedule."
            />
          )}
        </div>
      </Section>
    </>
  );
}
export function DetailHeading({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle: string;
  back: string;
  action?: ReactNode;
}) {
  return (
    <div className="detail-heading">
      <div>
        <Link className="text-link" href={back}>
          <ChevronLeft size={14} />
          Back
        </Link>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="page-actions">{action}</div>
    </div>
  );
}
function formatOptional(value: string | null | undefined) {
  return value != null ? formatMoney(value) : "Unknown";
}
