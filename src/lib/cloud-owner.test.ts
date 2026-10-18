import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  cloudAccessMode,
  cloudOwnerConfigured,
  cloudOwnerRestricted,
  cloudRecoveryEmailAllowed,
  cloudSignupConfirmationEmailAllowed,
  cloudSignupEmailAllowed,
  cloudSignupEnabled,
  cloudUserAllowed,
  isCloudOwner,
} from "./cloud-owner";

const owner = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
  email_confirmed_at: "2026-10-18T00:00:00Z",
};
const alice = {
  id: "20000000-0000-4000-8000-000000000002",
  email: "alice@example.test",
  email_confirmed_at: "2026-10-18T01:00:00Z",
};
const bob = {
  id: "30000000-0000-4000-8000-000000000003",
  email: "bob@example.test",
  email_confirmed_at: "2026-10-18T02:00:00Z",
};

beforeEach(() => {
  vi.stubEnv("FINANCE_CLOUD_ACCESS_MODE", "");
  vi.stubEnv("FINANCE_CLOUD_OWNER_ID", owner.id);
  vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", owner.email);
});
afterEach(() => vi.unstubAllEnvs());

describe("explicit cloud workspace access modes", () => {
  it("keeps unset mode restricted to the existing confirmed owner", () => {
    expect(cloudAccessMode()).toBe("owner");
    expect(cloudUserAllowed(owner)).toBe(true);
    expect(cloudUserAllowed(alice)).toBe(false);
    expect(cloudUserAllowed(bob)).toBe(false);
    expect(cloudSignupEnabled()).toBe(false);
  });

  it("keeps owner-email bootstrap and pending-code recovery available", () => {
    vi.stubEnv("FINANCE_CLOUD_OWNER_ID", "");
    expect(cloudSignupEnabled()).toBe(true);
    expect(cloudSignupEmailAllowed(` ${owner.email.toUpperCase()} `)).toBe(
      true,
    );
    expect(cloudSignupEmailAllowed(alice.email)).toBe(false);
    vi.stubEnv("FINANCE_CLOUD_OWNER_ID", owner.id);
    expect(cloudSignupConfirmationEmailAllowed(owner.email)).toBe(true);
    expect(cloudRecoveryEmailAllowed(owner.email)).toBe(true);
    expect(cloudRecoveryEmailAllowed(alice.email)).toBe(false);
  });

  it("does not make an unconfigured owner deployment implicitly public", () => {
    vi.stubEnv("FINANCE_CLOUD_OWNER_ID", "");
    vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "");
    expect(cloudOwnerConfigured()).toBe(false);
    expect(cloudUserAllowed(alice)).toBe(false);
    expect(cloudSignupEnabled()).toBe(false);
    expect(cloudRecoveryEmailAllowed(alice.email)).toBe(false);
  });

  it("admits distinct confirmed public users without promoting them to operator", () => {
    vi.stubEnv("FINANCE_CLOUD_ACCESS_MODE", "public");
    for (const user of [owner, alice, bob]) {
      expect(cloudUserAllowed(user)).toBe(true);
      expect(cloudSignupEmailAllowed(user.email)).toBe(true);
      expect(cloudSignupConfirmationEmailAllowed(user.email)).toBe(true);
      expect(cloudRecoveryEmailAllowed(user.email)).toBe(true);
    }
    expect(cloudSignupEnabled()).toBe(true);
    expect(cloudOwnerRestricted()).toBe(true);
    expect(isCloudOwner(owner)).toBe(true);
    expect(isCloudOwner(alice)).toBe(false);
    expect(isCloudOwner(bob)).toBe(false);
    expect(alice.id).not.toBe(bob.id);
  });

  it("public mode works without operator identity and never grants operator access", () => {
    vi.stubEnv("FINANCE_CLOUD_ACCESS_MODE", "public");
    vi.stubEnv("FINANCE_CLOUD_OWNER_ID", "");
    vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "");
    expect(cloudUserAllowed(alice)).toBe(true);
    expect(cloudUserAllowed(bob)).toBe(true);
    expect(isCloudOwner(alice)).toBe(false);
    expect(isCloudOwner(bob)).toBe(false);
  });

  it.each(["PUBLIC", "true", "1", "public ", " public", "disabled"])(
    "fails closed for an unrecognized rollout mode %j",
    (mode) => {
      vi.stubEnv("FINANCE_CLOUD_ACCESS_MODE", mode);
      expect(cloudAccessMode()).toBe("disabled");
      for (const user of [owner, alice, bob]) {
        expect(cloudUserAllowed(user)).toBe(false);
        expect(cloudSignupEmailAllowed(user.email)).toBe(false);
        expect(cloudSignupConfirmationEmailAllowed(user.email)).toBe(false);
        expect(cloudRecoveryEmailAllowed(user.email)).toBe(false);
      }
      expect(cloudSignupEnabled()).toBe(false);
      // An accidental workspace rollout flag must not redefine operator identity.
      expect(isCloudOwner(owner)).toBe(true);
    },
  );

  it.each(["owner", "public"])(
    "requires a confirmed nonanonymous email identity in %s mode",
    (mode) => {
      vi.stubEnv("FINANCE_CLOUD_ACCESS_MODE", mode);
      const allowed = mode === "owner" ? owner : alice;
      for (const user of [
        null,
        { ...allowed, id: "not-a-uuid" },
        { ...allowed, email: undefined },
        { ...allowed, email: "not-an-email" },
        { ...allowed, email_confirmed_at: undefined },
        { ...allowed, email_confirmed_at: " " },
        { ...allowed, email_confirmed_at: "not-a-confirmation-date" },
        { ...allowed, is_anonymous: true },
      ]) {
        expect(cloudUserAllowed(user)).toBe(false);
      }
    },
  );

  it("invalid owner configuration cannot become an unrestricted fallback", () => {
    vi.stubEnv("FINANCE_CLOUD_OWNER_ID", "malformed-id");
    expect(cloudOwnerRestricted()).toBe(true);
    expect(cloudUserAllowed(owner)).toBe(false);
    vi.stubEnv("FINANCE_CLOUD_OWNER_ID", "");
    vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "malformed-email");
    expect(cloudOwnerRestricted()).toBe(true);
    expect(cloudOwnerConfigured()).toBe(false);
    expect(cloudUserAllowed(owner)).toBe(false);
    expect(cloudSignupEnabled()).toBe(false);
  });

  it.each(["invalid", "", "a@", "a".repeat(255) + "@example.test"])(
    "never forwards malformed public recipient %j to Auth",
    (email) => {
      vi.stubEnv("FINANCE_CLOUD_ACCESS_MODE", "public");
      expect(cloudSignupEmailAllowed(email)).toBe(false);
      expect(cloudSignupConfirmationEmailAllowed(email)).toBe(false);
      expect(cloudRecoveryEmailAllowed(email)).toBe(false);
    },
  );
});
