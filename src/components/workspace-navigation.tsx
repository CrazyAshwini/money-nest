"use client";

import Link from "next/link";
import { Fragment } from "react";
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
  Plus,
  UserRound,
} from "lucide-react";
import { BrandLockup } from "./brand-lockup";
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
        <BrandLockup />
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
  mode,
  onAdd,
}: {
  page: string;
  mode: string;
  onAdd: () => void;
}) {
  const profileHref =
    mode === "private" || mode === "cloud" ? "/profile" : "/settings";
  const items = [
    {
      href: "/dashboard",
      id: "dashboard",
      title: "Home",
      icon: LayoutDashboard,
    },
    { href: "/accounts", id: "accounts", title: "Accounts", icon: Landmark },
    {
      href: "/analytics",
      id: "analytics",
      title: "Analytics",
      icon: ChartNoAxesCombined,
    },
    {
      href: profileHref,
      id: profileHref.slice(1),
      title: "Profile",
      icon: UserRound,
    },
  ];

  return (
    <nav className="mobile-bottom-bar" aria-label="Mobile navigation">
      {items.map((item, index) => {
        const active = page === item.id;
        const Icon = item.icon;
        return (
          <Fragment key={item.href}>
            {index === 2 && (
              <button
                type="button"
                className="bottom-bar-item bottom-bar-add"
                aria-label="Add transaction"
                onClick={onAdd}
              >
                <span className="bottom-bar-add-icon">
                  <Plus size={26} aria-hidden="true" />
                </span>
                <span>Add</span>
              </button>
            )}
            <Link
              href={item.href}
              className={`bottom-bar-item ${active ? "active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className="bottom-bar-icon-wrap">
                <Icon size={20} aria-hidden="true" />
              </span>
              <span>{item.title}</span>
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}
