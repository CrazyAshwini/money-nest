type SecurityHeaderOptions = {
  nodeEnv?: string;
  supabaseUrl?: string;
  appUrl?: string;
  vercel?: string;
};

/** Configuration is an origin, never a source-list fragment or a credentialed URL. */
function configuredOrigin(value: string | undefined) {
  if (!value || !/^https?:\/\//i.test(value) || /[\s\\"'<>;`]/.test(value))
    return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      // CSP host sources do not support IPv6 literals. Local backends use
      // localhost or 127.0.0.1 so an invalid source cannot silently be ignored.
      !/^[a-z0-9.-]+$/i.test(url.hostname)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

/** Pure so production, local development and untrusted configuration can be checked independently. */
export function createSecurityHeaders(options: SecurityHeaderOptions) {
  const development = options.nodeEnv === "development";
  const supabase = configuredOrigin(options.supabaseUrl);
  const connections = ["'self'"];
  if (supabase) {
    connections.push(supabase.origin);
    const websocket = new URL(supabase.origin);
    websocket.protocol = supabase.protocol === "https:" ? "wss:" : "ws:";
    connections.push(websocket.origin);
  }
  if (development) {
    // Next's local hot reload uses a WebSocket; these allowances never reach a build.
    connections.push(
      "ws://127.0.0.1:*",
      "ws://localhost:*",
      "wss://127.0.0.1:*",
      "wss://localhost:*",
    );
  }
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    {
      key: "Content-Security-Policy",
      value: [
        "default-src 'self'",
        // Next's generated hydration scripts and current inline chart styles need these.
        `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        `connect-src ${connections.join(" ")}`,
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join("; "),
    },
  ];
  const https =
    options.vercel === "1" ||
    configuredOrigin(options.appUrl)?.protocol === "https:";
  if (options.nodeEnv === "production" && https)
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000",
    });
  return headers;
}
