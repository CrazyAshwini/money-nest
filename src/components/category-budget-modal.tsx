"use client";

import { useState } from "react";
import { Modal } from "./ui";
import { type CategoryBudgets, saveCategoryBudgets } from "@/lib/budgets";
import { triggerHaptic } from "@/lib/haptic";
import { analyticsCategoryColor } from "@/lib/analytics-presentation";
import { Sparkles, Check } from "lucide-react";

interface CategoryBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  categories: readonly string[];
  budgets: CategoryBudgets;
  onSave: (budgets: CategoryBudgets) => void;
}

export function CategoryBudgetModal({
  isOpen,
  onClose,
  userId,
  categories,
  budgets: initialBudgets,
  onSave,
}: CategoryBudgetModalProps) {
  const [formBudgets, setFormBudgets] = useState<CategoryBudgets>({
    ...initialBudgets,
  });

  if (!isOpen) return null;

  function handleBudgetChange(category: string, value: string) {
    setFormBudgets((prev) => {
      const next = { ...prev };
      if (!value.trim() || Number(value) <= 0) {
        delete next[category];
      } else {
        next[category] = value.trim();
      }
      return next;
    });
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    triggerHaptic(12);
    saveCategoryBudgets(userId, formBudgets);
    onSave(formBudgets);
    onClose();
  }

  function applyPreset() {
    triggerHaptic(8);
    const preset: CategoryBudgets = {
      Food: "8000",
      "Food & Drinks": "8000",
      Shopping: "5000",
      Transport: "2500",
      Utilities: "3000",
      "Bills & Utilities": "3000",
      Subscriptions: "1500",
      Entertainment: "2000",
      Health: "2500",
      "Health & Personal Care": "2500",
    };
    setFormBudgets((prev) => ({ ...prev, ...preset }));
  }

  return (
    <Modal
      title="Category Budget Limits"
      description="Set monthly spending limits."
      onClose={onClose}
    >
      <form onSubmit={handleSave} className="budget-modal-form">
        <div className="budget-modal-preset-row">
          <button
            type="button"
            className="button ghost small"
            onClick={applyPreset}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Sparkles size={14} aria-hidden="true" />
            Apply suggested defaults
          </button>
          <button
            type="button"
            className="button ghost small text-muted"
            onClick={() => {
              triggerHaptic(8);
              setFormBudgets({});
            }}
          >
            Clear all
          </button>
        </div>

        <div className="budget-category-list">
          {categories.map((category) => {
            const color = analyticsCategoryColor(category);
            const value = formBudgets[category] || "";
            return (
              <div key={category} className="budget-category-row">
                <div className="budget-category-info">
                  <span
                    className="budget-category-dot"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <span className="budget-category-name">{category}</span>
                </div>
                <div className="budget-category-input-wrap">
                  <span className="budget-currency-symbol">₹</span>
                  <input
                    type="number"
                    step="100"
                    min="0"
                    placeholder="No limit"
                    value={value}
                    onChange={(e) =>
                      handleBudgetChange(category, e.target.value)
                    }
                    className="budget-input"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Check size={16} aria-hidden="true" />
            Save Budgets
          </button>
        </div>
      </form>
    </Modal>
  );
}
