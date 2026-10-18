import "server-only";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type CloudUser = {
  id: string;
  is_anonymous?: boolean;
  email?: string;
  email_confirmed_at?: string;
} | null;

function ownerEmail() {
  const email = process.env.FINANCE_CLOUD_OWNER_EMAIL?.trim().toLowerCase();
  return email || null;
}

export function cloudOwnerRestricted() {
  return Boolean(process.env.FINANCE_CLOUD_OWNER_ID || ownerEmail());
}

export function cloudOwnerConfigured() {
  return (
    uuid.test(process.env.FINANCE_CLOUD_OWNER_ID ?? "") ||
    Boolean(ownerEmail())
  );
}

export function isCloudOwner(user: CloudUser) {
  if (!user || user.is_anonymous || !cloudOwnerConfigured()) return false;
  const ownerId = process.env.FINANCE_CLOUD_OWNER_ID?.trim();
  if (ownerId) return uuid.test(ownerId) && user.id.toLowerCase() === ownerId.toLowerCase();
  const expected = ownerEmail();
  return Boolean(
    expected &&
      typeof user.email === "string" &&
      user.email.trim().toLowerCase() === expected &&
      typeof user.email_confirmed_at === "string",
  );
}

export function cloudUserAllowed(user: CloudUser) {
  return Boolean(
    user &&
    !user.is_anonymous &&
    (!cloudOwnerRestricted() || isCloudOwner(user)),
  );
}

export function cloudSignupEnabled() {
  return Boolean(ownerEmail() && !process.env.FINANCE_CLOUD_OWNER_ID);
}

export function cloudSignupEmailAllowed(email: string) {
  const expected = ownerEmail();
  return Boolean(
    cloudSignupEnabled() &&
      expected &&
      email.trim().toLowerCase() === expected,
  );
}

/** Pending owner registrations may confirm after an owner ID is configured. */
export function cloudSignupConfirmationEmailAllowed(email: string) {
  const expected = ownerEmail();
  return Boolean(expected && email.trim().toLowerCase() === expected);
}

/** Public recovery requests may only send mail to the configured owner address. */
export function cloudRecoveryEmailAllowed(email: string) {
  const expected = ownerEmail();
  return Boolean(expected && email.trim().toLowerCase() === expected);
}
