"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

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
