import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecurityHeaders } from "../src/lib/security-headers";
import nextConfig from "../next.config";

const headerMap = (options: Parameters<typeof createSecurityHeaders>[0]) =>
  Object.fromEntries(
    createSecurityHeaders(options).map(({ key, value }) => [key, value]),
  );
const directives = (options: Parameters<typeof createSecurityHeaders>[0]) => {
  const policy = headerMap(options)["Content-Security-Policy"];
  return Object.fromEntries(
    policy.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ");
      return [name, sources];
    }),
  );
};

afterEach(() => vi.unstubAllEnvs());

describe("enforced application security headers", () => {
  it("preserves existing restrictions and permits the local assets used by Next and uploads", () => {
    const headers = headerMap({ nodeEnv: "production" });
    expect(headers).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    expect(headers).not.toHaveProperty("Content-Security-Policy-Report-Only");
    expect(directives({ nodeEnv: "production" })).toMatchObject({
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:"],
      "font-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
      "frame-ancestors": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "object-src": ["'none'"],
    });
  });

  it.each([
    [
      "https://Synthetic.supabase.co:443/",
      "https://synthetic.supabase.co",
      "wss://synthetic.supabase.co",
    ],
    [
      "https://backend.example.test:8443",
      "https://backend.example.test:8443",
      "wss://backend.example.test:8443",
    ],
    [
      "http://127.0.0.1:54321",
      "http://127.0.0.1:54321",
      "ws://127.0.0.1:54321",
    ],
  ])(
    "allows only the normalized backend and matching WebSocket origin for %s",
    (supabaseUrl, http, ws) => {
      expect(
        directives({ nodeEnv: "production", supabaseUrl })["connect-src"],
      ).toEqual(["'self'", http, ws]);
    },
  );

  it.each([
    "https://backend.example.test; script-src *",
    "https://backend.example.test%3Bscript-src",
    "https://backend.example.test\r\nscript-src *",
    "https://backend.example.test\t",
    "https://name:password@backend.example.test",
    "https://backend.example.test/rest/v1",
    "https://backend.example.test/?source=other",
    "https://backend.example.test/#frame-src",
    "https://backend.example.test\\@attacker.example.test",
    "https://backend.example.test:99999",
    "http://[::1]:54321",
    "https:backend.example.test",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "*",
    "",
  ])(
    "does not broaden the policy for malformed configuration %j",
    (supabaseUrl) => {
      const csp = headerMap({ nodeEnv: "production", supabaseUrl })[
        "Content-Security-Policy"
      ];
      expect(csp).toBe(
        headerMap({ nodeEnv: "production" })["Content-Security-Policy"],
      );
    },
  );

  it("allows local HMR and eval only in development", () => {
    const dev = directives({ nodeEnv: "development" });
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toEqual([
      "'self'",
      "ws://127.0.0.1:*",
      "ws://localhost:*",
      "wss://127.0.0.1:*",
      "wss://localhost:*",
    ]);
    for (const nodeEnv of ["production", "test", undefined]) {
      const csp = headerMap({ nodeEnv })["Content-Security-Policy"];
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).not.toContain("*");
    }
  });

  it.each([
    { nodeEnv: "production", appUrl: "https://money-nest.example.test" },
    { nodeEnv: "production", vercel: "1" },
  ])(
    "sets a conservative HSTS policy for an HTTPS production deployment %j",
    (options) => {
      expect(headerMap(options)["Strict-Transport-Security"]).toBe(
        "max-age=31536000",
      );
    },
  );

  it.each([
    { nodeEnv: "production", appUrl: "http://127.0.0.1:3006" },
    { nodeEnv: "production" },
    { nodeEnv: "production", appUrl: "https://user:password@example.test" },
    { nodeEnv: "development", appUrl: "https://example.test", vercel: "1" },
    { nodeEnv: "test", appUrl: "https://example.test" },
  ])(
    "does not pin HSTS for local, unverified or non-production serving %j",
    (options) => {
      expect(headerMap(options)).not.toHaveProperty(
        "Strict-Transport-Security",
      );
    },
  );

  it("wires the policy into every Next response using the build environment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
    vi.stubEnv("APP_URL", "https://money-nest.example.test");
    vi.stubEnv("VERCEL", "");
    const routes = await nextConfig.headers!();
    expect(routes).toHaveLength(1);
    expect(routes[0].source).toBe("/:path*");
    expect(routes[0].headers).toEqual(
      createSecurityHeaders({
        nodeEnv: "production",
        supabaseUrl: "https://synthetic.supabase.co",
        appUrl: "https://money-nest.example.test",
        vercel: "",
      }),
    );
  });
});
