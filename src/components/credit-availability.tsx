import { getCreditAvailabilityPresentation } from "@/lib/credit-presentation";
import { formatMoney } from "@/lib/finance";
import type { AccountUsage } from "@/lib/usage";
import "./credit-availability.css";

export function CreditAvailability({
  usage,
  compact = false,
  showNote = true,
}: {
  usage: AccountUsage;
  compact?: boolean;
  showNote?: boolean;
}) {
  const availability = getCreditAvailabilityPresentation(usage);
  return (
    <div
      className="credit-availability"
      data-status={availability.status}
      data-compact={compact}
    >
      <div className="credit-availability-heading">
        <span>{availability.label}</span>
        {availability.status === "verified" && (
          <span className="credit-availability-status">Verified report</span>
        )}
      </div>
      <strong>
        {availability.amount === null
          ? "Not available"
          : formatMoney(availability.amount)}
      </strong>
      {showNote && <p>{availability.note}</p>}
    </div>
  );
}
