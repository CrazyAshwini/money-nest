"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode, ComponentType } from "react";
export function Modal({
  title,
  description,
  children,
  onClose,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={`modal ${className}`}>
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description || "Review the details below before saving."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Section({
  title,
  subtitle,
  href,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  href?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action ||
          (href && (
            <Link href={href} className="text-link">
              View all <ChevronRight size={14} />
            </Link>
          ))}
      </div>
      {children}
    </section>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  title,
  description,
  onAdd,
}: {
  title: string;
  description: string;
  onAdd?: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">◇</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {onAdd && (
        <button className="button primary" onClick={onAdd}>
          <Plus size={16} /> Add your first record
        </button>
      )}
    </div>
  );
}
export function Stat({
  title,
  value,
  caption,
  icon: Icon,
  tone = "",
  detail,
  children,
}: {
  title: string;
  value: string;
  caption: string;
  icon: ComponentType<{ size?: number }>;
  tone?: string;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-top">
        <span>{title}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <div className="stat-bottom">
        <span>{caption}</span>
        {detail}
      </div>
      {children}
    </div>
  );
}
export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function downloadFile(content: string, name: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
