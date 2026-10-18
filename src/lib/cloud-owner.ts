import "server-only";
import { z } from "zod";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type CloudUser = {
  id: string;
  is_anonymous?: boolean;
  email?: string;
  email_confirmed_at?: string;
} | null;

const emailInput = z.string().max(254).pipe(z.email());

function normalizedEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return emailInput.safeParse(email).success ? email : null;
}

function ownerEmail() {
  return normalizedEmail(process.env.FINANCE_CLOUD_OWNER_EMAIL);
}

/** Public access is an explicit server-side rollout; unknown values fail closed. */
export function cloudAccessMode(): "owner" | "public" | "disabled" {
  const mode = process.env.FINANCE_CLOUD_ACCESS_MODE;
  if (!mode || mode === "owner") return "owner";
  return mode === "public" ? "public" : "disabled";
}

export function cloudPublicAccessEnabled() {
  return cloudAccessMode() === "public";
}

function confirmedEmailUser(user: CloudUser) {
  return Boolean(
    user &&
    uuid.test(user.id) &&
    !user.is_anonymous &&
    normalizedEmail(user.email) &&
    typeof user.email_confirmed_at === "string" &&
    user.email_confirmed_at.trim() &&
    Number.isFinite(Date.parse(user.email_confirmed_at)),
  );
}

/** Operator identity configuration, independent of the public workspace mode. */
export function cloudOwnerRestricted() {
  return Boolean(
    process.env.FINANCE_CLOUD_OWNER_ID || process.env.FINANCE_CLOUD_OWNER_EMAIL,
  );
}

export function cloudOwnerConfigured() {
  return (
    uuid.test(process.env.FINANCE_CLOUD_OWNER_ID ?? "") || Boolean(ownerEmail())
  );
}

export function isCloudOwner(user: CloudUser) {
  if (!user || user.is_anonymous || !cloudOwnerConfigured()) return false;
  const ownerId = process.env.FINANCE_CLOUD_OWNER_ID?.trim();
  if (ownerId)
    return (
      uuid.test(ownerId) && user.id.toLowerCase() === ownerId.toLowerCase()
    );
  const expected = ownerEmail();
  return Boolean(
    expected &&
    typeof user.email === "string" &&
    user.email.trim().toLowerCase() === expected &&
    typeof user.email_confirmed_at === "string",
  );
}

export function cloudUserAllowed(user: CloudUser) {
  if (!confirmedEmailUser(user)) return false;
  const mode = cloudAccessMode();
  return mode === "public" || (mode === "owner" && isCloudOwner(user));
}

export function cloudSignupEnabled() {
  return (
    cloudPublicAccessEnabled() ||
    (cloudAccessMode() === "owner" &&
      Boolean(ownerEmail() && !process.env.FINANCE_CLOUD_OWNER_ID))
  );
}

export function cloudSignupEmailAllowed(email: string) {
  const normalized = normalizedEmail(email);
  if (cloudPublicAccessEnabled()) return Boolean(normalized);
  const expected = ownerEmail();
  return Boolean(cloudSignupEnabled() && expected && normalized === expected);
}

/** Pending owner registrations may confirm after an owner ID is configured. */
export function cloudSignupConfirmationEmailAllowed(email: string) {
  const normalized = normalizedEmail(email);
  if (cloudPublicAccessEnabled()) return Boolean(normalized);
  const expected = ownerEmail();
  return Boolean(
    cloudAccessMode() === "owner" && expected && normalized === expected,
  );
}

/** Recovery follows the rollout mode without disclosing registration status. */
export function cloudRecoveryEmailAllowed(email: string) {
  return cloudSignupConfirmationEmailAllowed(email);
}
