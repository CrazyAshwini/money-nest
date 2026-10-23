"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import "./transaction-picker.css";

export interface TransactionPickerOption {
  value: string;
  label: string;
  group?: string;
  description?: string;
}

interface TransactionPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: TransactionPickerOption[];
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
}

/** A shared selection surface; account/category semantics stay in the editor. */
export function TransactionPicker({
  label,
  value,
  onChange,
  options,
  placeholder = "Choose an option",
  searchable = true,
  disabled = false,
  className = "",
}: TransactionPickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const focusSearch = useCallback((element: HTMLInputElement | null) => {
    element?.focus();
  }, []);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().toLocaleLowerCase("en-IN");
  const matches = options.filter((option) =>
    [option.label, option.description, option.group]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("en-IN")
      .includes(normalizedQuery),
  );
  const groupedOptions = new Map<string, TransactionPickerOption[]>();
  matches.forEach((option) => {
    const group = option.group || "";
    const entries = groupedOptions.get(group) || [];
    entries.push(option);
    groupedOptions.set(group, entries);
  });
  const filtered = [...groupedOptions.values()].flat();
  const selectedIndex = filtered.findIndex((option) => option.value === value);
  const initialIndex = Math.max(0, selectedIndex);
  const groups = new Map<
    string,
    { option: TransactionPickerOption; index: number }[]
  >();
  filtered.forEach((option, index) => {
    const group = option.group || "";
    const entries = groups.get(group) || [];
    entries.push({ option, index });
    groups.set(group, entries);
  });

  function choose(option: TransactionPickerOption) {
    onChange(option.value);
    setOpen(false);
    setSearchOpen(false);
    setQuery("");
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
    searchButtonRef.current?.focus();
  }

  function focusOption(index: number) {
    optionRefs.current[index]?.focus();
  }

  function navigateOptions(event: KeyboardEvent<HTMLDivElement>) {
    const current = optionRefs.current.findIndex(
      (element) => element === event.target,
    );
    if (current < 0 || !filtered.length) return;
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = (current + 1) % filtered.length;
        break;
      case "ArrowUp":
        next = (current - 1 + filtered.length) % filtered.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = filtered.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    focusOption(next);
  }

  return (
    <div className={`transaction-picker ${className}`}>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setSearchOpen(false);
          setQuery("");
        }}
      >
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="transaction-picker-trigger"
            aria-label={label}
            aria-describedby={`${id}-selection`}
            disabled={disabled}
            title={value ? selected?.label || value : placeholder}
          >
            <span className={value ? "" : "transaction-picker-placeholder"}>
              {value ? selected?.label || value : placeholder}
            </span>
            <ChevronDown size={17} aria-hidden="true" />
          </button>
        </Dialog.Trigger>
        <span id={`${id}-selection`} className="transaction-picker-sr-only">
          {value
            ? `Selected: ${selected?.label || value}`
            : "No option selected"}
        </span>
        <Dialog.Portal>
          <Dialog.Overlay className="transaction-picker-overlay" />
          <Dialog.Content
            className="transaction-picker-dialog"
            onOpenAutoFocus={(event) => {
              const target = optionRefs.current[initialIndex];
              if (target) {
                event.preventDefault();
                target.focus();
              }
            }}
            onEscapeKeyDown={(event) => event.preventDefault()}
            onKeyDownCapture={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                setSearchOpen(false);
                setQuery("");
              }
            }}
          >
            <div className="transaction-picker-heading">
              <Dialog.Title>Choose {label.toLowerCase()}</Dialog.Title>
              <div className="transaction-picker-actions">
                {searchable && (
                  <button
                    ref={searchButtonRef}
                    type="button"
                    className="transaction-picker-search-toggle"
                    aria-label={`Search ${label.toLowerCase()}`}
                    aria-expanded={searchOpen}
                    aria-controls={`${id}-search`}
                    onClick={() =>
                      searchOpen ? closeSearch() : setSearchOpen(true)
                    }
                  >
                    <Search size={20} aria-hidden="true" />
                  </button>
                )}
                <Dialog.Close
                  type="button"
                  className="transaction-picker-close"
                  aria-label={`Close ${label.toLowerCase()} picker`}
                >
                  <X size={20} aria-hidden="true" />
                </Dialog.Close>
              </div>
            </div>
            <Dialog.Description className="transaction-picker-sr-only">
              Select an option. Use the arrow keys to browse the list.
            </Dialog.Description>
            {searchable && searchOpen && (
              <div id={`${id}-search`} className="transaction-picker-search">
                <Search size={18} aria-hidden="true" />
                <input
                  ref={focusSearch}
                  type="search"
                  value={query}
                  aria-label={`Search ${label.toLowerCase()}`}
                  aria-controls={`${id}-listbox`}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  autoComplete="off"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      focusOption(
                        event.key === "ArrowUp"
                          ? filtered.length - 1
                          : initialIndex,
                      );
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      if (filtered.length) choose(filtered[initialIndex]);
                    }
                  }}
                />
                <button
                  type="button"
                  className="transaction-picker-search-close"
                  aria-label={`Close ${label.toLowerCase()} search`}
                  onClick={closeSearch}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            )}
            <div
              id={`${id}-listbox`}
              role="listbox"
              tabIndex={-1}
              aria-label={label}
              className="transaction-picker-options"
              onKeyDown={navigateOptions}
            >
              {[...groups].map(([group, entries], groupIndex) => (
                <div
                  key={group}
                  role="group"
                  aria-labelledby={
                    group ? `${id}-group-${groupIndex}` : undefined
                  }
                >
                  {group && (
                    <p
                      id={`${id}-group-${groupIndex}`}
                      className="transaction-picker-group"
                    >
                      {group}
                    </p>
                  )}
                  {entries.map(({ option, index }) => (
                    <button
                      key={option.value}
                      ref={(element) => {
                        optionRefs.current[index] = element;
                      }}
                      type="button"
                      role="option"
                      aria-selected={option.value === value}
                      tabIndex={index === initialIndex ? 0 : -1}
                      className="transaction-picker-option"
                      onClick={() => choose(option)}
                    >
                      <span className="transaction-picker-option-copy">
                        <span>{option.label}</span>
                        {option.description && (
                          <small>{option.description}</small>
                        )}
                      </span>
                      <Check
                        size={18}
                        aria-hidden="true"
                        className={
                          option.value === value
                            ? ""
                            : "transaction-picker-unchecked"
                        }
                      />
                    </button>
                  ))}
                </div>
              ))}
            </div>
            {!filtered.length && (
              <p role="status" className="transaction-picker-empty">
                No matching options. Try another search.
              </p>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
