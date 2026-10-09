# Local private profile verification

Verified on 9 October 2026 against the production Next.js build.

The profile flow starts at the one-time setup form, authenticates through `/api/profile`, stores an encrypted workspace outside the source directory, and renders authenticated records through `/api/workspace`.

| Boundary                 | Result | Evidence                                                                                                                                                        |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup form and mobile UI | Passed | Synthetic browser flow completed setup and checked the dashboard at 360px.                                                                                      |
| Browser to API           | Passed | Wrong and reused setup tokens, missing or cross-site Origins, remote Host, and tampered sessions were rejected. Session cookie is HttpOnly and SameSite Strict. |
| API to storage           | Passed | Foreign-owner and malformed records were rejected; profile and transaction edits persisted across reload and sign-in.                                           |
| Private data to response | Passed | Unauthenticated workspace and profile requests return 401, `private, no-store`, and no private records or identity.                                             |
| Demo separation          | Passed | Synthetic private records did not appear in demo browser storage or static scripts.                                                                             |
| Stored data              | Passed | Encrypted-file plaintext checks passed. The actual profile folder and its files permit only the Windows user and SYSTEM.                                        |

The browser test exposed NextURL's normalization of loopback addresses to `localhost`. Request validation now checks a strict loopback Host, matching port and protocol, and the exact browser Origin derived from that Host. Twelve boundary tests cover normalization, IPv6, invalid hosts, mismatched and zero ports, and missing or cross-site Origins.

Validation includes the production build, lint/type checks, all 135 unit tests, 24 desktop/mobile demo browser tests, and one comprehensive synthetic private-profile browser test. The private browser flow also verifies normalized email sign-in, a 10-character synthetic password, wrong/missing email rejection, and read-only authenticated email display. Thirteen source-import integrity checks also passed without printing financial values.

Automated tests use synthetic credentials and isolated temporary storage only.

This profile is available on this computer only. Supabase cloud authentication, multi-device sync, and hosted deployment are separate and remain unconfigured.
