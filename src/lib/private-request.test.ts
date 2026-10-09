import { describe, expect, it } from "vitest";
import { privateRequestAllowed } from "./private-request";

type Options = {
  host?: string;
  origin?: string;
  hostname?: string;
  protocol?: string;
  port?: string;
};
function request({
  host,
  origin,
  hostname = "localhost",
  protocol = "http:",
  port = "3000",
}: Options = {}) {
  const headers = new Headers();
  if (host !== undefined) headers.set("host", host);
  if (origin !== undefined) headers.set("origin", origin);
  return { headers, nextUrl: { hostname, protocol, port } };
}

describe("private localhost request boundary", () => {
  it.each([
    ["127.0.0.1:3000", "http://127.0.0.1:3000"],
    ["localhost:3000", "http://localhost:3000"],
    ["[::1]:3000", "http://[::1]:3000"],
  ])(
    "accepts normalized loopback Host %s with its own exact Origin",
    (host, origin) => {
      // NextURL canonicalizes all loopback hostnames to localhost.
      expect(privateRequestAllowed(request({ host }), false)).toBe(true);
      expect(privateRequestAllowed(request({ host, origin }), true)).toBe(true);
    },
  );

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "accepts an unnormalized loopback URL hostname %s",
    (hostname) => {
      expect(
        privateRequestAllowed(request({ host: "localhost:3000", hostname })),
      ).toBe(true);
    },
  );

  it("binds write Origin to the raw Host alias and port", () => {
    expect(
      privateRequestAllowed(
        request({ host: "127.0.0.1:3000", origin: "http://localhost:3000" }),
        true,
      ),
    ).toBe(false);
    expect(
      privateRequestAllowed(
        request({ host: "localhost:3000", origin: "http://127.0.0.1:3000" }),
        true,
      ),
    ).toBe(false);
    expect(
      privateRequestAllowed(
        request({ host: "localhost:3000", origin: "http://localhost:3001" }),
        true,
      ),
    ).toBe(false);
    expect(
      privateRequestAllowed(
        request({ host: "localhost:3000", origin: "https://localhost:3000" }),
        true,
      ),
    ).toBe(false);
    expect(
      privateRequestAllowed(
        request({ host: "localhost:3000", origin: "http://localhost:3000/" }),
        true,
      ),
    ).toBe(false);
  });

  it("requires a matching Origin for every write", () => {
    expect(
      privateRequestAllowed(request({ host: "localhost:3000" }), true),
    ).toBe(false);
    for (const origin of [
      "",
      "null",
      "https://remote.example",
      "http://localhost:3000.remote.example",
      "http://localhost:3000, https://remote.example",
    ]) {
      expect(
        privateRequestAllowed(
          request({ host: "localhost:3000", origin }),
          true,
        ),
      ).toBe(false);
    }
    expect(
      privateRequestAllowed(
        request({ host: "localhost:3000", origin: "https://remote.example" }),
        false,
      ),
    ).toBe(true);
  });

  it("rejects missing, remote, malformed, and ambiguous Host values", () => {
    expect(privateRequestAllowed(request())).toBe(false);
    for (const host of [
      "",
      "remote.example:3000",
      "localhost.remote.example:3000",
      "remote.localhost:3000",
      "localhost.:3000",
      "127.0.0.2:3000",
      "0.0.0.0:3000",
      "[::]:3000",
      "127.0.0.1.remote.example:3000",
      "localhost:3000, localhost:3000",
      "localhost:3000@remote.example",
      "user@localhost:3000",
      "http://localhost:3000",
      "localhost:3000/path",
      "localhost:3000?secret=value",
      "localhost:3000#fragment",
      "localhost:abc",
      "localhost:0",
      "localhost:65536",
      "localhost:-1",
      "localhost:3000:3001",
      "::1:3000",
    ])
      expect(privateRequestAllowed(request({ host }))).toBe(false);
  });

  it("rejects mismatched runtime ports and remote runtime hostnames", () => {
    expect(
      privateRequestAllowed(request({ host: "localhost:0", port: "0" })),
    ).toBe(false);
    expect(privateRequestAllowed(request({ host: "localhost:3001" }))).toBe(
      false,
    );
    expect(
      privateRequestAllowed(request({ host: "localhost:3000", port: "3001" })),
    ).toBe(false);
    expect(
      privateRequestAllowed(request({ host: "localhost", port: "3000" })),
    ).toBe(false);
    for (const hostname of [
      "remote.example",
      "0.0.0.0",
      "localhost.remote.example",
      "remote.localhost",
    ]) {
      expect(
        privateRequestAllowed(request({ host: "localhost:3000", hostname })),
      ).toBe(false);
    }
  });

  it("allows HTTPS and normalized default ports but rejects other protocols", () => {
    expect(
      privateRequestAllowed(
        request({
          host: "localhost:443",
          protocol: "https:",
          port: "",
          origin: "https://localhost",
        }),
        true,
      ),
    ).toBe(true);
    expect(
      privateRequestAllowed(
        request({ host: "127.0.0.1:80", port: "", origin: "http://127.0.0.1" }),
        true,
      ),
    ).toBe(true);
    expect(
      privateRequestAllowed(
        request({
          host: "localhost",
          protocol: "https:",
          port: "",
          origin: "https://localhost",
        }),
        true,
      ),
    ).toBe(true);
    for (const protocol of ["ftp:", "file:", "javascript:", "https", ""])
      expect(
        privateRequestAllowed(request({ host: "localhost:3000", protocol })),
      ).toBe(false);
  });

  it("does not trust forwarded hosts to override the actual Host header", () => {
    const input = request({ host: "remote.example:3000" });
    input.headers.set("x-forwarded-host", "localhost:3000");
    input.headers.set("x-forwarded-proto", "http");
    expect(privateRequestAllowed(input)).toBe(false);
  });
});
