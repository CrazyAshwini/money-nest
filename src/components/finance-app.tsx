"use client";
import { useState, useMemo, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import * as Dialog from "@radix-ui/react-dialog";
import { NAV_ITEMS, WorkspaceNavigation } from "./workspace-navigation";
import { resolveAppPage } from "@/lib/page-metadata";
import "./shell.css";
import Decimal from "decimal.js";
import {
  Landmark,
  ArrowLeftRight,
  CreditCard,
  CalendarDays,
  Upload,
  ChartNoAxesCombined,
  Bell,
  Search,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronRight,
  ChevronLeft,
  Wallet,
  MoreHorizontal,
  Menu,
  ShieldCheck,
  Download,
  SlidersHorizontal,
  Check,
  LoaderCircle,
  Clock,
  X,
  Info,
  CircleAlert,
} from "lucide-react";
import { useFinance } from "./finance-provider";
import { PrivateProfilePage } from "./private-profile";
import { OrdersPage } from "./orders-page";
import { Section, Stat, Badge, Empty, downloadFile } from "./ui";
import {
  AccountBreakdown,
  BankAccountSummary,
  CreditUsageSummary,
  formatUsagePercentage,
  UsageMeter,
  UsageStatus,
} from "./account-summary";
import { RecordEditor, type EditorState } from "./editors";
import {
  ImportsPage,
  GroupsPage,
  SettingsPage,
  LoginPage,
  NotificationsPage,
} from "./workspace-pages";
import {
  dashboardMetrics,
  formatMoney,
  formatDate,
  monthLabel,
  accountBalance,
  latestSnapshot,
  billSummary,
  emiSummary,
  monthlySummary,
  spendingByCategory,
  dailySpending,
  sumMoney,
} from "@/lib/finance";
import { exportTransactionsCsv } from "@/lib/imports";
import { accountUsage, usageSummary } from "@/lib/usage";
import {
  TRANSACTION_KINDS,
  type Account,
  type Bill,
  type Transaction,
  type TransactionKind,
} from "@/lib/types";
const SpendingChart = dynamic(() => import("./charts"), {
  ssr: false,
  loading: () => <div className="spending-chart chart-placeholder" />,
});

const kindLabel = (s: string) => s.replaceAll("_", " ");
const tones = [
  "#a7b7ee",
  "#b4d9b5",
  "#d5b4e5",
  "#edc298",
  "#8bc6cf",
  "#cfb58a",
];
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
  } = useFinance();
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
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
  if (mode === "loading")
    return (
      <main className="loading">
        <div className="brand-icon">M</div>
        <LoaderCircle className="spin" />
        <p>Opening your finance workspace…</p>
      </main>
    );
  if (page === "login" || mode === "login")
    return backend === "local" ? <PrivateProfilePage /> : <LoginPage />;
  if (page === "profile" && mode !== "private") return <PrivateProfilePage />;
  if (mode === "error")
    return (
      <main className="loading">
        <h1>Unable to load your workspace</h1>
        <p role="alert">{message}</p>
        <button className="button primary" onClick={() => void refresh()}>
          Try again
        </button>
        <Link href="/login">Return to sign in</Link>
      </main>
    );
  const title = pageInfo?.title || "Money Nest";
  const metrics = dashboardMetrics(data, month);
  const open = (e: EditorState) => setEditor(e);
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
          <Dialog.Content className="navigation-drawer">
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
        <div className="app-main">
          <header className="topbar">
            <div className="breadcrumb">
              <Dialog.Trigger asChild>
                <button
                  className="icon-button mobile-menu"
                  aria-label="Open navigation"
                >
                  <Menu size={20} />
                </button>
              </Dialog.Trigger>
              <span>Workspace</span>
              <ChevronRight size={14} />
              <strong>{active}</strong>
            </div>
            <div className="topbar-right">
              <Link href="/transactions" className="search-shortcut">
                <Search size={16} />
                <span>Search transactions</span>
              </Link>
              <span className="topbar-divider" />
              <Link
                href="/notifications"
                aria-label="Notifications"
                className="notification-button"
              >
                <Bell size={19} />
                {metrics.reviewCount > 0 && <i />}
              </Link>
              <Link
                href={mode === "private" ? "/profile" : "/settings"}
                className="avatar mini"
                aria-label="Your profile"
              >
                {profile?.displayName.slice(0, 1).toUpperCase() || "P"}
              </Link>
            </div>
          </header>
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
            <div className="page-heading">
              <div>
                {page !== "dashboard" && (
                  <div className="eyebrow">YOUR MONEY, IN PERSPECTIVE</div>
                )}
                <h1>{title}</h1>
                {page !== "dashboard" && (
                  <p>
                    {page === "imports"
                      ? "Review every row. Keep your ledger clean."
                      : page === "transactions"
                        ? "Every movement, with the full story."
                        : "The details that keep your finances in balance."}
                  </p>
                )}
              </div>
              <div className="page-actions">
                <label className="month-picker">
                  <CalendarDays size={16} />
                  <input
                    aria-label="Selected month"
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value || "2026-10")}
                  />
                </label>
                {page !== "dashboard" && (
                  <Link href="/imports" className="button import-button">
                    <Upload size={15} />
                    Import
                  </Link>
                )}
                <button
                  className="button primary"
                  onClick={() => open({ type: "transaction" })}
                >
                  <Plus size={16} />
                  <span>Add transaction</span>
                </button>
              </div>
            </div>
            {page === "dashboard" ? (
              <Dashboard open={open} />
            ) : page === "accounts" ? (
              <AccountsPage id={id} open={open} />
            ) : page === "transactions" ? (
              <TransactionsPage open={open} create={id === "new"} />
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
              <AnalyticsPage />
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
                <Link href="/settings#data">Data & privacy</Link>
              </nav>
            </footer>
          </main>
        </div>
        {editor && (
          <RecordEditor editor={editor} onClose={() => setEditor(null)} />
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
function Kpis() {
  const { data, month, today } = useFinance();
  const m = dashboardMetrics(data, month, today);
  const credit = usageSummary(data, "credit_card", today);
  const payLater = usageSummary(data, "pay_later", today);
  return (
    <div className="stats-grid">
      <Stat
        title="Total bank balance"
        value={
          m.reportedBankCount > 0 ? formatMoney(m.bankBalance) : "Not reported"
        }
        caption={`${m.reportedBankCount < m.totalBankCount ? `${m.reportedBankCount}/${m.totalBankCount} reported` : "Reported"} · ${m.bankAsOf ? formatDate(m.bankAsOf) : "No snapshots"}`}
        icon={Landmark}
        tone="stat-highlight"
      >
        <AccountBreakdown count={m.totalBankCount} label="account">
          <BankAccountSummary data={data} today={today} />
        </AccountBreakdown>
      </Stat>
      <Stat
        title="This month's spending"
        value={formatMoney(m.monthSpending)}
        caption={`${m.expenseCount} posted expenses · ${monthLabel(month)}`}
        icon={ArrowUpRight}
      />
      <Stat
        title="Credit card usage"
        value={
          credit.knownUsageCount > 0
            ? formatMoney(credit.usedTotal)
            : "Not reported"
        }
        caption={`${credit.complete ? "Known usage" : "Partial usage"} · ${credit.knownUsageCount}/${credit.count} cards`}
        icon={CreditCard}
      >
        <CreditUsageSummary summary={credit} kind="credit_card" />
      </Stat>
      <Stat
        title="Pay Later usage"
        value={
          payLater.knownUsageCount > 0
            ? `${payLater.rows.some((row) => row.provenance === "partial") ? "At least " : ""}${formatMoney(payLater.usedTotal)}`
            : "Not reported"
        }
        caption={`${payLater.complete ? "Known usage" : "Known exposure · partial coverage"} · ${payLater.knownUsageCount}/${payLater.count} providers`}
        icon={Wallet}
      >
        <CreditUsageSummary summary={payLater} kind="pay_later" />
      </Stat>
    </div>
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
    .slice(0, 3);
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
          title="Recent activity"
          href="/transactions"
          className="dashboard-activity"
        >
          <div className="recent-activity-list">
            {recent.map((transaction) => (
              <RecentActivity
                key={transaction.id}
                transaction={transaction}
                open={open}
              />
            ))}
          </div>
          {recent.length === 0 && (
            <Empty
              title="No activity this month"
              description="Add a transaction to get started."
              onAdd={() => open({ type: "transaction" })}
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
function RecentActivity({
  transaction,
  open,
}: {
  transaction: Transaction;
  open: Open;
}) {
  const incoming =
    transaction.kind === "income" || transaction.kind === "refund";
  const outgoing =
    transaction.kind === "expense" || transaction.kind === "bill_payment";
  const Icon = incoming
    ? ArrowDownLeft
    : outgoing
      ? ArrowUpRight
      : ArrowLeftRight;
  return (
    <button
      className="recent-activity-row"
      aria-label={`Edit ${transaction.description}`}
      onClick={() => open({ type: "transaction", record: transaction })}
    >
      <span className={`activity-icon ${incoming ? "green-text" : ""}`}>
        <Icon size={15} />
      </span>
      <span className="activity-copy">
        <b title={transaction.description}>{transaction.description}</b>
        <small>
          {kindLabel(transaction.kind)} ·{" "}
          {transaction.occurredOn
            ? formatDate(transaction.occurredOn)
            : "Date unconfirmed"}
        </small>
        {transaction.status === "pending_review" && (
          <Badge tone="amber">Needs review</Badge>
        )}
      </span>
      <span className={`activity-amount ${incoming ? "green-text" : ""}`}>
        {incoming ? "+" : outgoing ? "−" : ""}
        {formatMoney(transaction.amount)}
      </span>
    </button>
  );
}
function BankCard({
  account,
  index = 0,
}: {
  account: Account;
  index?: number;
}) {
  const { data, today } = useFinance();
  const balance = accountBalance(data, account.id, today);
  return (
    <Link href={`/accounts/${account.id}`} className="bank-card">
      <div className="bank-top">
        <div
          className="institution-icon"
          style={
            {
              "--bank-color": account.accent || tones[index % tones.length],
            } as React.CSSProperties
          }
        >
          {account.institution.slice(0, 1)}
        </div>
        <ArrowUpRight size={16} />
      </div>
      <h3>{account.name}</h3>
      <span className="masked">
        {kindLabel(account.kind)} · ••{account.maskedSuffix || "—"}
      </span>
      <strong>
        {balance.reported !== null
          ? formatMoney(balance.reported)
          : "Not reported"}
      </strong>
      <div className="bank-card-footer">
        <span>
          <i />{" "}
          {balance.asOf
            ? `As of ${formatDate(balance.asOf)}`
            : "Snapshot needed"}
        </span>
        <ChevronRight size={13} />
      </div>
    </Link>
  );
}
function CreditCardItem({
  account,
  index = 0,
}: {
  account: Account;
  index?: number;
}) {
  const { data, today } = useFinance();
  const s = latestSnapshot(data, account.id, today);
  const usage = accountUsage(data, account.id, today);
  const used = usage.used;
  const bill = data.bills
    .filter((b) => b.accountId === account.id)
    .sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0];
  return (
    <Link href={`/accounts/${account.id}`} className="credit-card">
      <div className="credit-card-heading">
        <span
          className="card-chip"
          style={{ color: tones[index % tones.length] }}
        >
          <CreditCard size={22} />
        </span>
        <span className="credit-kind">
          {account.kind === "pay_later" ? "PAY LATER" : "CREDIT CARD"}
        </span>
        <ArrowUpRight size={15} />
      </div>
      <h3>{account.name}</h3>
      <span className="masked">
        {account.institution} · ••{account.maskedSuffix || "—"}
      </span>
      <div className="credit-amount">
        <strong>
          {used != null
            ? `${usage.provenance === "partial" ? "At least " : ""}${formatMoney(used)}`
            : "Unknown"}
        </strong>
        <span>
          /{" "}
          {account.creditLimit
            ? formatMoney(account.creditLimit, { decimals: 0 })
            : "limit unknown"}
        </span>
      </div>
      <div className="usage-level credit-usage-level">
        <span>
          {usage.percentage === null
            ? "Percentage unknown"
            : `${formatUsagePercentage(usage.percentage)} used`}
        </span>
        <UsageStatus band={usage.band} />
      </div>
      <UsageMeter {...usage} label={`${account.name} usage`} />
      <div className="credit-meta">
        <span>
          Usage source{" "}
          <b>
            {usage.provenance === "partial"
              ? "Known bill only"
              : usage.provenance === "inferred"
                ? "From available credit"
                : usage.provenance === "reported"
                  ? "Reported"
                  : "Unconfirmed"}
          </b>
        </span>
        <span>
          Available{" "}
          <b>
            {s?.reportedAvailable != null
              ? formatMoney(s.reportedAvailable)
              : "Unconfirmed"}
          </b>
        </span>
      </div>
      <div className="credit-date">
        <CalendarDays size={12} />
        {bill?.dueDate
          ? `Payment due ${formatDate(bill.dueDate)}`
          : s?.nextStatementDate
            ? `Next statement ${formatDate(s.nextStatementDate)}`
            : "Statement not received"}
        <ChevronRight size={13} />
      </div>
    </Link>
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
function SpendingPanel() {
  const { data, month } = useFinance();
  const [net, setNet] = useState(false);
  const summary = monthlySummary(data, month);
  const points = dailySpending(data, month, { net }).map((p) => ({
    label: p.day === 1 ? `1 ${monthLabel(month).split(" ")[0]}` : String(p.day),
    amount: Number(p.amount),
  }));
  return (
    <Section
      title="Monthly spending"
      subtitle="Small moments. The bigger picture."
      action={
        <select
          aria-label="Spending display"
          className="small-select"
          value={net ? "net" : "gross"}
          onChange={(e) => setNet(e.target.value === "net")}
        >
          <option value="gross">Gross spending</option>
          <option value="net">Net after refunds</option>
        </select>
      }
    >
      <div className="chart-summary">
        <strong>{formatMoney(net ? summary.net : summary.gross)}</strong>
        <span>
          {net ? "After explicitly matched refunds" : "Total posted expenses"}
        </span>
        <span className="chart-legend">
          <i /> {monthLabel(month)}
        </span>
      </div>
      <SpendingChart points={points} />
    </Section>
  );
}
function CategoryPanel() {
  const { data, month } = useFinance();
  const categories = spendingByCategory(data, month);
  const total = sumMoney(categories.map((c) => c.amount));
  let acc = 0;
  const gradient = categories
    .map((c, i) => {
      const start = acc;
      acc += c.percentage;
      return `${tones[i % tones.length]} ${start}% ${acc}%`;
    })
    .join(",");
  return (
    <Section
      title="Spending breakdown"
      subtitle="Where your money went."
      href="/analytics"
    >
      <div className="category-chart">
        <div
          className="donut"
          style={{
            background: categories.length
              ? `conic-gradient(${gradient})`
              : "#303035",
          }}
        >
          <div>
            <small>Total spent</small>
            <strong>{formatMoney(total, { decimals: 0 })}</strong>
          </div>
        </div>
        <div className="category-legend">
          {categories.slice(0, 5).map((c, i) => (
            <div key={c.category}>
              <span>
                <i style={{ background: tones[i % tones.length] }} />
                {c.category}
              </span>
              <strong>{c.percentage.toFixed(0)}%</strong>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
export function TransactionTable({
  transactions,
  onEdit,
}: {
  transactions: Transaction[];
  onEdit?: (t: Transaction) => void;
}) {
  const { data } = useFinance();
  return transactions.length ? (
    <div className="table-wrap">
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
            const a = data.accounts.find(
              (a) => a.id === (t.fromAccountId || t.toAccountId),
            );
            const incoming = t.kind === "income" || t.kind === "refund";
            return (
              <tr key={t.id}>
                <td>
                  <div className="transaction-description">
                    <span className={`txn-icon ${incoming ? "green" : ""}`}>
                      {incoming ? (
                        <ArrowDownLeft size={17} />
                      ) : t.kind === "transfer" || t.kind === "bill_payment" ? (
                        <ArrowLeftRight size={17} />
                      ) : (
                        <ArrowUpRight size={17} />
                      )}
                    </span>
                    <span>
                      <button className="row-link" onClick={() => onEdit?.(t)}>
                        {t.description}
                      </button>
                      <small>
                        {t.externalPayer
                          ? `Paid by ${t.externalPayer}`
                          : kindLabel(t.kind)}
                        {t.status === "pending_review" ? " · Needs review" : ""}
                      </small>
                    </span>
                  </div>
                </td>
                <td>
                  <span className="category-pill">
                    {t.category || "Uncategorized"}
                  </span>
                </td>
                <td>{a?.name || "External payer"}</td>
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
                  {incoming ? "+" : "−"}
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
  const { data, today } = useFinance();
  const [kind, setKind] = useState("all");
  const a = data.accounts.find((a) => a.id === id);
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
    const balance = accountBalance(data, a.id, today);
    const snapshot = latestSnapshot(data, a.id, today);
    const fd = data.fixedDeposits.find((f) => f.backingAccountId === a.id);
    return (
      <>
        <DetailHeading
          title={a.name}
          subtitle={`${a.institution} · ••${a.maskedSuffix} · ${kindLabel(a.kind)}`}
          back="/accounts"
          action={
            <>
              <button
                className="button"
                onClick={() => open({ type: "snapshot", record: a })}
              >
                <Plus size={15} />
                Reported snapshot
              </button>
              <button
                className="button primary"
                onClick={() => open({ type: "account", record: a })}
              >
                Edit account
              </button>
            </>
          }
        />
        <div className="three-stats">
          <Stat
            title="Reported balance / outstanding"
            value={formatOptional(balance.reported)}
            caption={`Snapshot · ${balance.asOf ? formatDate(balance.asOf) : "Not available"}`}
            icon={Landmark}
          />
          <Stat
            title="Calculated ledger balance"
            value={formatOptional(balance.calculated)}
            caption="Opening balance + dated posted movements"
            icon={ArrowLeftRight}
          />
          <Stat
            title="Reconciliation difference"
            value={formatOptional(balance.difference)}
            caption={
              balance.reconciliation === "unknown"
                ? "Complete opening history required"
                : balance.reconciliation
            }
            icon={ShieldCheck}
          />
        </div>
        <div className="info-banner">
          <ShieldCheck size={17} />
          <span>
            {snapshot
              ? `Source: ${kindLabel(snapshot.source)}. Reported values are valid for their stated date.`
              : "Add a reported snapshot to reconcile this account."}
            {fd && (
              <>
                {" "}
                · Pledged deposit:{" "}
                <Link href={`/fixed-deposits/${fd.id}`}>{fd.name}</Link>
              </>
            )}
          </span>
        </div>
        <Section
          title="Statement history"
          action={
            <button
              className="text-link"
              onClick={() => open({ type: "bill" })}
            >
              <Plus size={15} />
              Add statement
            </button>
          }
        >
          {data.bills
            .filter((b) => b.accountId === a.id)
            .map((b) => (
              <BillRow key={b.id} bill={b} />
            ))}
          {!data.bills.some((b) => b.accountId === a.id) && (
            <div className="inline-empty">
              Statement not received. Current usage does not establish a bill.
            </div>
          )}
        </Section>
        <Section title="Account history">
          <TransactionTable
            transactions={data.transactions.filter(
              (t) => t.fromAccountId === a.id || t.toAccountId === a.id,
            )}
            onEdit={(t) => open({ type: "transaction", record: t })}
          />
        </Section>
      </>
    );
  }
  const accounts = data.accounts.filter((a) =>
    onlyPayLater ? a.kind === "pay_later" : kind === "all" || a.kind === kind,
  );
  return (
    <>
      <div className="list-toolbar">
        <div className="tabs">
          {!onlyPayLater &&
            ["all", "bank", "credit_card", "pay_later", "wallet"].map((k) => (
              <button
                className={kind === k ? "selected" : ""}
                key={k}
                onClick={() => setKind(k)}
              >
                {kindLabel(k)}
              </button>
            ))}
        </div>
        <button className="button" onClick={() => open({ type: "account" })}>
          <Plus size={15} />
          Add account
        </button>
      </div>
      <div className="account-page-grid">
        {accounts.map((a, i) => (
          <div key={a.id} className={!a.active ? "archived" : ""}>
            {a.kind === "bank" || a.kind === "wallet" ? (
              <BankCard account={a} index={i} />
            ) : (
              <CreditCardItem account={a} index={i} />
            )}
            <div className="account-edit">
              <Badge>{a.active ? "Active" : "Archived"}</Badge>
              <button
                className="text-link"
                onClick={() => open({ type: "account", record: a })}
              >
                Edit account
              </button>
            </div>
          </div>
        ))}
      </div>
      {accounts.length === 0 && (
        <Empty
          title="No accounts yet"
          description="Track a bank, wallet, credit card or Pay Later provider."
          onAdd={() => open({ type: "account" })}
        />
      )}
    </>
  );
}
function TransactionsPage({ open, create }: { open: Open; create?: boolean }) {
  const { data, month, toast } = useFinance();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [account, setAccount] = useState("all");
  const [review, setReview] = useState(false);
  const [allMonths, setAllMonths] = useState(false);
  const [newKind, setNewKind] = useState<TransactionKind>("expense");
  const txs = useMemo(
    () =>
      data.transactions
        .filter(
          (t) =>
            (allMonths || !t.occurredOn || t.occurredOn.startsWith(month)) &&
            (kind === "all" || t.kind === kind) &&
            (account === "all" ||
              t.fromAccountId === account ||
              t.toAccountId === account) &&
            (!review || t.status === "pending_review") &&
            `${t.description} ${t.merchant || ""} ${t.platform || ""} ${t.notes || ""} ${t.externalReference || ""} ${t.category || ""}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) =>
          (b.occurredOn || "9999").localeCompare(a.occurredOn || "9999"),
        ),
    [data.transactions, allMonths, month, kind, account, review, search],
  );
  return (
    <>
      <div className="list-toolbar">
        <div className="search-input">
          <Search size={16} />
          <input
            aria-label="Search transactions"
            placeholder="Search description, category, reference…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          className="button"
          onClick={() => {
            downloadFile(
              exportTransactionsCsv(txs, data.accounts),
              `transactions-${month}.csv`,
            );
            toast("Filtered transactions exported.");
          }}
        >
          <Download size={15} />
          Export CSV
        </button>
      </div>
      <div className="transaction-create-row">
        <select
          aria-label="New transaction type"
          value={newKind}
          onChange={(event) =>
            setNewKind(event.target.value as TransactionKind)
          }
        >
          {TRANSACTION_KINDS.map((type) => (
            <option key={type} value={type}>
              {kindLabel(type)}
            </option>
          ))}
        </select>
        <button
          className="button primary"
          onClick={() => open({ type: "transaction", kind: newKind })}
        >
          <Plus size={15} />{" "}
          {create ? "Create transaction" : `Add ${kindLabel(newKind)}`}
        </button>
      </div>
      <div className="filter-row">
        <SlidersHorizontal size={16} />
        <select
          aria-label="Transaction type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">All types</option>
          {[
            "expense",
            "income",
            "transfer",
            "bill_payment",
            "refund",
            "adjustment",
          ].map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter account"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          <option value="all">All accounts</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <label className="check-row">
          <input
            type="checkbox"
            checked={review}
            onChange={(e) => setReview(e.target.checked)}
          />
          Needs review
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={allMonths}
            onChange={(e) => setAllMonths(e.target.checked)}
          />
          All dates
        </label>
        <span>{txs.length} transactions</span>
      </div>
      <Section
        title={review ? "Needs review" : "Your ledger"}
        subtitle={`${monthLabel(month)} · Transfers and repayments are not purchase expenses.`}
      >
        <TransactionTable
          transactions={txs}
          onEdit={(t) => open({ type: "transaction", record: t })}
        />
      </Section>
    </>
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
              <Badge tone={f.pledged ? "blue" : "green"}>
                {f.pledged ? "Pledged" : "Standalone"}
              </Badge>
            }
          >
            <p className="muted">
              {f.institution} · ••{f.maskedSuffix}
            </p>
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
function AnalyticsPage() {
  const { data, month } = useFinance();
  const m = monthlySummary(data, month);
  return (
    <>
      <div className="three-stats">
        <Stat
          title="Gross expenses"
          value={formatMoney(m.gross)}
          caption={`${m.expenseCount} posted, dated purchases`}
          icon={ArrowUpRight}
        />
        <Stat
          title="Matched refunds"
          value={formatMoney(m.refunds)}
          caption="Capped at original expense, excess preserved"
          icon={ArrowDownLeft}
        />
        <Stat
          title="Net spending"
          value={formatMoney(m.net)}
          caption="Gross expenses less explicitly matched refunds"
          icon={ChartNoAxesCombined}
        />
      </div>
      <div className="analytics-grid">
        <SpendingPanel />
        <CategoryPanel />
      </div>
      {new Decimal(m.unexplainedRefunds).gt(0) && (
        <div className="info-banner">
          {formatMoney(m.unexplainedRefunds)} in excess matched reimbursements
          remains unexplained. The original purchases and full receipts are
          preserved in the ledger.
        </div>
      )}
      <Section title="Category detail">
        <div className="record-list">
          {spendingByCategory(data, month).map((c, i) => (
            <div className="record-row" key={c.category}>
              <span
                className="category-dot"
                style={{ background: tones[i % tones.length] }}
              />
              <strong className="grow">{c.category}</strong>
              <span className="muted">
                {c.count} expenses · {c.percentage.toFixed(1)}%
              </span>
              <strong>{formatMoney(c.amount)}</strong>
            </div>
          ))}
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
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="page-actions">{action}</div>
    </div>
  );
}
function formatOptional(value: string | null | undefined) {
  return value != null ? formatMoney(value) : "Unknown";
}
