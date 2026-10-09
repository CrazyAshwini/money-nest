/** NextURL normalizes loopback addresses; the browser Origin uses its actual Host. */
export function privateRequestAllowed(
  request: {
    headers: Headers;
    nextUrl: { hostname: string; protocol: string; port: string };
  },
  write = false,
): boolean {
  const { hostname, protocol, port } = request.nextUrl;
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(hostname) ||
    !["http:", "https:"].includes(protocol)
  )
    return false;
  const host = request.headers.get("host");
  if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(host))
    return false;
  try {
    const browserURL = new URL(`${protocol}//${host}`);
    if (browserURL.port === "0" || browserURL.port !== port) return false;
    return !write || request.headers.get("origin") === browserURL.origin;
  } catch {
    return false;
  }
}
