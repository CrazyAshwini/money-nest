"use client";

import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import {
  LayoutDashboard,
  Landmark,
  ArrowLeftRight,
  CreditCard,
  Wallet,
  Sprout,
  HandCoins,
  Users,
  Upload,
  ChartNoAxesCombined,
  Settings,
  ShieldCheck,
  ArrowUpRight,
  MoreHorizontal,
} from "lucide-react";
import type { UserProfile } from "@/lib/profile-types";

export const NAV_ITEMS = [
  { href: "/dashboard", title: "Overview", icon: LayoutDashboard },
  { href: "/accounts", title: "Accounts", icon: Landmark },
  { href: "/transactions", title: "Transactions", icon: ArrowLeftRight },
  { href: "/bills", title: "Bills & payments", icon: CreditCard },
  { href: "/pay-later", title: "Pay Later", icon: Wallet },
  { href: "/fixed-deposits", title: "Fixed deposits", icon: Sprout },
  { href: "/loans", title: "Loans & EMIs", icon: HandCoins },
  { href: "/split-bills", title: "Split bills", icon: Users },
  { href: "/imports", title: "Imports", icon: Upload },
  { href: "/orders", title: "Orders & refunds", icon: ArrowLeftRight },
  { href: "/analytics", title: "Analytics", icon: ChartNoAxesCombined },
];

export function WorkspaceNavigation({
  page,
  mode,
  profile,
  reviewCount,
  onNavigate,
}: {
  page: string;
  mode: string;
  profile: UserProfile | null;
  reviewCount: number;
  onNavigate: () => void;
}) {
  const profileHref =
    mode === "private" || mode === "cloud" ? "/profile" : "/settings";
  const initial = profile?.displayName.slice(0, 1).toUpperCase() || "P";
  return (
    <>
      <Link
        href="/dashboard"
        className="brand"
        aria-label="Money Nest home"
        onClick={onNavigate}
      >
        <span className="brand-icon" aria-hidden="true">
          M
        </span>
        <span>Money Nest</span>
      </Link>
      <Link
        href={profileHref}
        className="workspace-switch"
        onClick={onNavigate}
      >
        <span className="avatar" aria-hidden="true">
          {initial}
        </span>
        <span>
          {profile?.displayName || "Personal workspace"}
          <small>
            {mode === "demo" ? "Fictional demo" : "Private workspace"}
          </small>
        </span>
        <Settings size={15} aria-hidden="true" />
      </Link>
      <div className="nav-caption">WORKSPACE</div>
      <nav aria-label="Main navigation">
        {NAV_ITEMS.filter(
          (item) => item.href !== "/orders" || mode === "private",
        ).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.title}
            className={`nav-item ${page === item.href.slice(1) ? "active" : ""} ${item.href === "/fixed-deposits" ? "nav-separated" : ""}`}
            aria-current={page === item.href.slice(1) ? "page" : undefined}
            onClick={onNavigate}
          >
            <item.icon size={18} aria-hidden="true" />
            <span>{item.title}</span>
            {item.href === "/imports" && reviewCount > 0 && (
              <span className="nav-count">{reviewCount}</span>
            )}
          </Link>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="privacy-card">
          <ShieldCheck size={19} aria-hidden="true" />
          <strong>Your space. Your finances.</strong>
          <p>
            {mode === "demo"
              ? "Sample changes stay in this browser. Try things out at your own pace."
              : "Your records are scoped to your signed-in account."}
          </p>
          <Link href="/settings#data" onClick={onNavigate}>
            Data & privacy <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>
        <Link
          className={`nav-item ${page === "settings" ? "active" : ""}`}
          href="/settings"
          aria-current={page === "settings" ? "page" : undefined}
          onClick={onNavigate}
        >
          <Settings size={18} aria-hidden="true" />
          Settings
        </Link>
        <Link className="user-card" href={profileHref} onClick={onNavigate}>
          <span className="avatar owner" aria-hidden="true">
            {initial}
          </span>
          <span>
            {profile?.displayName || "Personal account"}
            <small>
              {mode === "demo" ? "Demo mode" : "Signed in securely"}
            </small>
          </span>
          <MoreHorizontal size={18} aria-hidden="true" />
        </Link>
      </div>
    </>
  );
}

export function MobileBottomBar({
  page,
  reviewCount,
  onOpenMore,
}: {
  page: string;
  reviewCount: number;
  onOpenMore: (trigger: HTMLButtonElement) => void;
}) {
  const items = [
    { href: "/dashboard", id: "dashboard", title: "Home", icon: LayoutDashboard },
    { href: "/accounts", id: "accounts", title: "Accounts", icon: Landmark },
    { href: "/transactions", id: "transactions", title: "Transactions", icon: ArrowLeftRight },
    { href: "/analytics", id: "analytics", title: "Analytics", icon: ChartNoAxesCombined },
  ];
  const isMoreActive = ![
    "dashboard",
    "accounts",
    "transactions",
    "analytics",
  ].includes(page);

  return (
    <nav className="mobile-bottom-bar" aria-label="Mobile navigation">
      {items.map((item) => {
        const active = page === item.id;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`bottom-bar-item ${active ? "active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{item.title}</span>
          </Link>
        );
      })}
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={`bottom-bar-item ${isMoreActive ? "active" : ""}`}
          aria-label="More navigation options"
          onClick={(event) => onOpenMore(event.currentTarget)}
        >
          <span className="bottom-bar-icon-wrap">
            <MoreHorizontal size={20} aria-hidden="true" />
            {reviewCount > 0 && <span className="bottom-bar-badge" aria-label={`${reviewCount} pending items`} />}
          </span>
          <span>More</span>
        </button>
      </Dialog.Trigger>
    </nav>
  );
}

