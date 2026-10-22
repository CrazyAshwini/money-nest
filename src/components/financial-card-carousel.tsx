"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { resolveSelectedAccountId } from "@/lib/account-presentation";
import type { Account } from "@/lib/types";
import "./financial-card-carousel.css";

export function FinancialCardCarousel({
  accounts,
  selectedId,
  onSelect,
  label,
  renderCard,
  presentation = "default",
  emptyMessage = "No accounts in this group yet.",
}: {
  accounts: readonly Account[];
  selectedId: string | null;
  onSelect: (accountId: string) => void;
  label: string;
  renderCard: (account: Account) => ReactNode;
  presentation?: "default" | "accounts";
  emptyMessage?: string;
}) {
  const resolvedId = resolveSelectedAccountId(accounts, selectedId);
  const index = accounts.findIndex((account) => account.id === resolvedId);
  const trackRef = useRef<HTMLDivElement>(null);
  const currentIdRef = useRef(resolvedId);
  const onSelectRef = useRef(onSelect);
  const nativeSelectionRef = useRef<string | null>(null);
  const programmaticTargetRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const idsKey = JSON.stringify(accounts.map((account) => account.id));
  const itemLabel = label.toLowerCase().replace(/s$/, "");

  useEffect(() => {
    currentIdRef.current = resolvedId;
    onSelectRef.current = onSelect;
    if (resolvedId && selectedId !== resolvedId) onSelect(resolvedId);
  }, [onSelect, resolvedId, selectedId]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const ids = JSON.parse(idsKey) as string[];
    let frame = 0;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    nativeSelectionRef.current = null;

    const nearestSlide = () => {
      const slides = Array.from(track.children) as HTMLElement[];
      return slides.reduce<HTMLElement | null>(
        (nearest, slide) =>
          !nearest ||
          Math.abs(slide.offsetLeft - track.scrollLeft) <
            Math.abs(nearest.offsetLeft - track.scrollLeft)
            ? slide
            : nearest,
        null,
      );
    };
    const publishNearest = () => {
      frame = 0;
      const nearest = nearestSlide();
      const id = nearest?.dataset.accountId;
      if (!id) return;
      // Smooth arrow navigation may pass intermediate cards. Keep its selected
      // card and history together instead of publishing each animation frame.
      if (programmaticTargetRef.current) {
        if (
          id !== programmaticTargetRef.current ||
          Math.abs(nearest.offsetLeft - track.scrollLeft) > 1
        )
          return;
        programmaticTargetRef.current = null;
      }
      if (currentIdRef.current !== id) {
        nativeSelectionRef.current = id;
        currentIdRef.current = id;
        onSelectRef.current(id);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(publishNearest);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        programmaticTargetRef.current = null;
        publishNearest();
      }, 160);
    };
    const interruptAnimation = () => {
      programmaticTargetRef.current = null;
    };
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) interruptAnimation();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== track) return;
      const currentIndex = ids.indexOf(currentIdRef.current ?? "");
      let next: string | undefined;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        next = ids[currentIndex + (event.key === "ArrowLeft" ? -1 : 1)];
      } else if (event.key === "Home" || event.key === "End") {
        next = event.key === "Home" ? ids[0] : ids.at(-1);
      } else return;
      event.preventDefault();
      if (next) onSelectRef.current(next);
    };
    const alignAfterResize = () => {
      const selectedIndex = ids.indexOf(currentIdRef.current ?? "");
      const selected = track.children[selectedIndex] as HTMLElement | undefined;
      if (selected) {
        programmaticTargetRef.current = null;
        track.scrollTo({ left: selected.offsetLeft, behavior: "auto" });
      }
    };
    const resizeObserver = new ResizeObserver(alignAfterResize);
    resizeObserver.observe(track);
    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("pointerdown", interruptAnimation, {
      passive: true,
    });
    track.addEventListener("wheel", onWheel, { passive: true });
    track.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settleTimer);
      resizeObserver.disconnect();
      track.removeEventListener("scroll", onScroll);
      track.removeEventListener("pointerdown", interruptAnimation);
      track.removeEventListener("wheel", onWheel);
      track.removeEventListener("keydown", onKeyDown);
    };
  }, [idsKey]);

  useEffect(() => {
    const track = trackRef.current;
    const slide = Array.from(track?.children ?? []).find(
      (item) => (item as HTMLElement).dataset.accountId === resolvedId,
    ) as HTMLElement | undefined;
    if (!track || !slide) return;
    // A native swipe owns its own settling/snap. Updating the selected history
    // must not initiate another smooth scroll in the middle of that gesture.
    if (nativeSelectionRef.current === resolvedId) {
      nativeSelectionRef.current = null;
      return;
    }
    if (Math.abs(track.scrollLeft - slide.offsetLeft) > 1) {
      programmaticTargetRef.current = resolvedId;
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      track.scrollTo({
        left: slide.offsetLeft,
        behavior: mountedRef.current && !reducedMotion ? "smooth" : "auto",
      });
    }
    mountedRef.current = true;
  }, [idsKey, resolvedId]);

  const selectAdjacent = (direction: -1 | 1) => {
    const next = accounts[index + direction];
    if (next) onSelect(next.id);
  };

  return (
    <section
      className="financial-carousel"
      aria-roledescription="carousel"
      aria-label={label}
      data-selected-account-id={resolvedId ?? undefined}
      data-presentation={presentation}
    >
      <div className="financial-carousel-heading">
        <h2>{label}</h2>
        {accounts.length > 1 && (
          <span aria-hidden="true">
            {index + 1} of {accounts.length}
          </span>
        )}
      </div>
      {accounts.length ? (
        <div
          className="financial-carousel-track"
          ref={trackRef}
          role="group"
          data-edge={
            accounts.length === 1
              ? "single"
              : index <= 0
                ? "first"
                : index >= accounts.length - 1
                  ? "last"
                  : "middle"
          }
          tabIndex={accounts.length > 1 ? 0 : -1}
          aria-label={`${label} cards${accounts.length > 1 ? "; use left and right arrow keys to browse" : ""}`}
        >
          {accounts.map((account, position) => (
            <div
              key={account.id}
              className="financial-carousel-slide"
              role="group"
              aria-roledescription="slide"
              aria-label={`${account.name}, ${position + 1} of ${accounts.length}`}
              data-account-id={account.id}
              data-selected={account.id === resolvedId}
              inert={account.id !== resolvedId}
            >
              {renderCard(account)}
            </div>
          ))}
        </div>
      ) : (
        <p className="financial-carousel-empty">{emptyMessage}</p>
      )}
      {accounts.length > 1 && (
        <div className="financial-carousel-controls">
          {presentation !== "accounts" && (
            <p>Swipe or use the arrows to browse</p>
          )}
          <button
            type="button"
            aria-label={`Previous ${itemLabel}`}
            disabled={index <= 0}
            onClick={() => selectAdjacent(-1)}
          >
            <ChevronLeft size={19} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Next ${itemLabel}`}
            disabled={index >= accounts.length - 1}
            onClick={() => selectAdjacent(1)}
          >
            <ChevronRight size={19} aria-hidden="true" />
          </button>
        </div>
      )}
      <span
        className="financial-carousel-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {index >= 0
          ? `${accounts[index].name}, ${index + 1} of ${accounts.length}`
          : "No accounts"}
      </span>
    </section>
  );
}
