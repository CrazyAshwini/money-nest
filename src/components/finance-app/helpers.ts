import { formatMoney } from "@/lib/finance";

export const kindLabel = (s: string) => s.replaceAll("_", " ");

export function formatOptional(value: string | null | undefined) {
  return value != null ? formatMoney(value) : "Unknown";
}
