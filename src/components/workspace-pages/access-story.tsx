"use client";

import Image from "next/image";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { BrandLockup } from "../brand-lockup";

export function LoginStory() {
  return (
    <div className="login-story">
      <Link className="brand" href="/dashboard" aria-label="Money Nest home">
        <BrandLockup />
      </Link>
      <div>
        <span className="eyebrow">MAKE ROOM FOR CLARITY</span>
        <h2>
          Know your money.
          <br />
          <span>Own your next move.</span>
        </h2>
        <p>
          Your accounts, spending, bills, and plans.
          <br />
          One thoughtful space to see it all.
        </p>
        <div className="login-orbit">
          <Image
            src="/brand/moneynest-mascot.webp"
            width={180}
            height={180}
            alt=""
            aria-hidden="true"
            className="access-panda"
            unoptimized
          />
          <span className="orbit-card">
            <ShieldCheck size={25} aria-hidden="true" />
            <strong>Personal by design.</strong>
            <small>Private to your account.</small>
          </span>
        </div>
      </div>
      <small>Built around your finances. And your peace of mind.</small>
    </div>
  );
}

export function MobileAccessBrand() {
  return (
    <Link
      href="/dashboard"
      className="brand access-mobile-brand"
      aria-label="Money Nest home"
    >
      <BrandLockup />
    </Link>
  );
}
