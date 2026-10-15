import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction, WorkspaceData } from "./types";
import { NextRequest } from "next/server";
import { emptyCommerce, type ReviewedOrderDraft } from "./commerce";
vi.mock("server-only", () => ({}));
import { GET as ordersGET, POST as ordersPOST } from "../app/api/orders/route";
import { POST as workspacePOST } from "../app/api/workspace/route";
import {
  commitPrivateImport,
  commitPrivateCommerce,
  readPrivateCommerce,
  getPrivateProfileStatus,
  loginPrivateProfile,
  logoutPrivateProfile,
  privateProfileDirectory,
  privateProfileEnabled,
  authenticatePrivateProfile,
  provisionPrivateProfile,
  readPrivateProfile,
  savePrivateRecord,
  setupPrivateProfile,
  updatePrivateProfile,
} from "./private-profile-store";

const OWNER = "8bfa5897-282f-4f78-84cc-95c1e0d59e2a";
const ACCOUNT = "6482b147-efcb-4c9e-94fd-8c4abf660b29";
const PASSWORD = "Synthetic test password 927!";
const SHORT_PASSWORD = "Test1234!x";
const EMAIL = "synthetic.owner@example.test";
let testDirectory: string;
function workspace(): WorkspaceData {
  return {
    accounts: [
      {
        id: ACCOUNT,
        userId: OWNER,
        name: "Synthetic test checking",
        institution: "Imaginary bank",
        kind: "bank",
        maskedSuffix: "4821",
        active: true,
      },
    ],
    snapshots: [],
    transactions: [],
    bills: [],
    allocations: [],
    fixedDeposits: [],
    loans: [],
    emis: [],
    emiAllocations: [],
    groups: [],
    shares: [],
    settlements: [],
    reminders: [],
    auditEvents: [],
  };
}
function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: randomUUID(),
    userId: OWNER,
    amount: "123.45",
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: "2026-10-09",
    description: "Synthetic purchase for isolated tests",
    fromAccountId: ACCOUNT,
    toAccountId: null,
    sourceSystem: "synthetic-test",
    sourceObjectId: randomUUID(),
    ...overrides,
  };
}
function reviewedImport(
  inputHash: string,
  rowNumber: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return transaction({
    sourceSystem: "csv",
    sourceObjectId: `${inputHash}:${rowNumber}`,
    ...overrides,
  });
}

async function provision() {
  return provisionPrivateProfile(workspace(), "Synthetic profile owner");
}
async function established() {
  const { setupToken } = await provision();
  return setupPrivateProfile({
    token: setupToken,
    displayName: "Synthetic profile owner",
    password: PASSWORD,
  });
}

beforeEach(async () => {
  testDirectory = await fs.mkdtemp(
    path.join(tmpdir(), "finance-os-private-unit-"),
  );
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FINANCE_PRIVATE_ENABLED", "true");
  vi.stubEnv("FINANCE_PRIVATE_DIR", testDirectory);
  vi.stubEnv("FINANCE_PRIVATE_TEST_MODE", "false");
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  const relative = path.relative(path.resolve(tmpdir()), testDirectory);
  if (
    relative.startsWith("finance-os-private-unit-") &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  )
    await fs.rm(testDirectory, { recursive: true, force: true });
});

describe("isolated private profile storage", () => {
  function orderDraft(
    overrides: Partial<ReviewedOrderDraft> = {},
  ): ReviewedOrderDraft {
    return {
      candidateId: "synthetic-order",
      sourceType: "manual",
      platform: "Imaginary shop",
      merchant: "Imaginary shop",
      description: "Synthetic order for isolated storage",
      orderReferenceHash: null,
      orderReferenceMasked: null,
      occurredOn: "2026-10-09",
      status: "completed",
      amount: "100.00",
      amountRole: "amount_paid",
      currency: "INR",
      paymentStatus: "successful",
      financialEvent: "purchase",
      category: "Shopping",
      items: [],
      sourceImageIndices: [],
      confidence: "high",
      warnings: [],
      expectedRefundAmount: null,
      expectedRefundBy: null,
      action: "create",
      confirmed: true,
      fromAccountId: ACCOUNT,
      externalPayer: null,
      matchedTransactionId: null,
      confirmedDistinct: false,
      sourceFingerprint: null,
      ...overrides,
    };
  }
  const orderCommand = (orders = [orderDraft()]) => ({
    action: "commit_orders",
    idempotencyKey: "a".repeat(64),
    orders,
  });
  function orderRequest(
    sessionToken: string,
    value?: unknown,
    headers: Record<string, string> = {},
  ) {
    return new NextRequest("http://127.0.0.1:3000/api/orders", {
      method: value === undefined ? "GET" : "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        cookie: `finance-os-private-session=${sessionToken}`,
        "content-type": "application/json",
        ...headers,
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
  }
  it("loads an older encrypted profile with empty commerce without rewriting it", async () => {
    const { sessionToken } = await established();
    const file = path.join(testDirectory, "profile.enc.json");
    const before = await fs.readFile(file, "utf8");
    expect((await readPrivateCommerce(sessionToken)).commerce).toEqual(
      emptyCommerce(),
    );
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
  it("atomically saves encrypted orders and ledger entries and replays without another write", async () => {
    const { sessionToken } = await established();
    const first = await commitPrivateCommerce(sessionToken, orderCommand());
    expect(first.commerce.orders).toHaveLength(1);
    expect(
      (await readPrivateProfile(sessionToken))?.workspace.transactions,
    ).toHaveLength(1);
    const file = path.join(testDirectory, "profile.enc.json");
    const encrypted = await fs.readFile(file, "utf8");
    expect(encrypted).not.toContain("Synthetic order for isolated storage");
    const replay = await commitPrivateCommerce(sessionToken, orderCommand());
    expect(replay.result.duplicate).toBe(true);
    expect(await fs.readFile(file, "utf8")).toBe(encrypted);
  });
  it("rejects a failing later order without changing encrypted ledger or commerce", async () => {
    const { sessionToken } = await established();
    const file = path.join(testDirectory, "profile.enc.json");
    const before = await fs.readFile(file, "utf8");
    await expect(
      commitPrivateCommerce(
        sessionToken,
        orderCommand([
          orderDraft(),
          orderDraft({
            candidateId: "forged-second",
            fromAccountId: randomUUID(),
          }),
        ]),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await fs.readFile(file, "utf8")).toBe(before);
    expect(
      (await readPrivateCommerce(sessionToken)).commerce.orders,
    ).toHaveLength(0);
    expect(
      (await readPrivateProfile(sessionToken))?.workspace.transactions,
    ).toHaveLength(0);
  });
  it("protects linked transaction money while allowing a merchant-description correction", async () => {
    const { sessionToken } = await established();
    await commitPrivateCommerce(sessionToken, orderCommand());
    const purchase = (await readPrivateProfile(sessionToken))!.workspace
      .transactions[0];
    await expect(
      savePrivateRecord(sessionToken, "transactions", {
        ...purchase,
        amount: "110.00",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await savePrivateRecord(sessionToken, "transactions", {
      ...purchase,
      description: "Corrected synthetic description",
    });
    expect(
      (await readPrivateProfile(sessionToken))?.workspace.transactions[0]
        .description,
    ).toBe("Corrected synthetic description");
  });
  it("rejects unauthorized order read/write and foreign origins before parsing request content", async () => {
    const { sessionToken } = await established();
    expect((await ordersGET(orderRequest("0".repeat(64)))).status).toBe(401);
    expect(
      (
        await ordersPOST(
          orderRequest("0".repeat(64), orderCommand(), {
            "content-length": "99999999",
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await ordersPOST(
          orderRequest(sessionToken, orderCommand(), {
            origin: "https://foreign.example.test",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await ordersPOST(
          orderRequest(sessionToken, orderCommand(), {
            "content-length": "99999999",
          }),
        )
      ).status,
    ).toBe(413);
    expect(
      (await readPrivateCommerce(sessionToken)).commerce.orders,
    ).toHaveLength(0);
  });
  it("returns private no-store order responses and handles an approved write", async () => {
    const { sessionToken } = await established();
    const response = await ordersPOST(
      orderRequest(sessionToken, orderCommand()),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const json = await response.json();
    expect(json.commerce.orders).toHaveLength(1);
    expect(json.result.transactionsCreated).toBe(1);
    const loaded = await ordersGET(orderRequest(sessionToken));
    expect((await loaded.json()).commerce.orders).toHaveLength(1);
  });
  it("authenticates server API access with only an owner ID and leaves the encrypted profile unchanged", async () => {
    const { sessionToken } = await established();
    const file = path.join(testDirectory, "profile.enc.json");
    const encryptedBefore = await fs.readFile(file, "utf8");
    expect(await authenticatePrivateProfile(sessionToken)).toEqual({
      ownerId: OWNER,
    });
    expect(await fs.readFile(file, "utf8")).toBe(encryptedBefore);
    const result = await authenticatePrivateProfile(sessionToken);
    expect(Object.keys(result)).toEqual(["ownerId"]);
    expect(JSON.stringify(result)).not.toContain("Synthetic test checking");
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it("requires an active, unexpired session for server API authentication", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const first = await established();
    await expect(
      authenticatePrivateProfile("0".repeat(64)),
    ).rejects.toMatchObject({ code: "auth" });
    const other = await loginPrivateProfile({ password: PASSWORD });
    await logoutPrivateProfile(first.sessionToken);
    await expect(
      authenticatePrivateProfile(first.sessionToken),
    ).rejects.toMatchObject({ code: "auth" });
    expect(await authenticatePrivateProfile(other.sessionToken)).toEqual({
      ownerId: OWNER,
    });
    vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1);
    await expect(
      authenticatePrivateProfile(other.sessionToken),
    ).rejects.toMatchObject({ code: "auth" });
  });

  it("sets up an encrypted email profile with a ten-character password and normalized email", async () => {
    expect(SHORT_PASSWORD).toHaveLength(10);
    const { setupToken } = await provision();
    const first = await setupPrivateProfile({
      token: setupToken,
      displayName: "Synthetic email owner",
      email: "  Synthetic.Owner@Example.Test  ",
      password: SHORT_PASSWORD,
    });
    expect(first.profile.email).toBe(EMAIL);
    expect(await getPrivateProfileStatus()).toEqual({
      exists: true,
      needsSetup: false,
      emailRequired: true,
    });
    expect((await readPrivateProfile(first.sessionToken))?.profile.email).toBe(
      EMAIL,
    );
    const ciphertext = await fs.readFile(
      path.join(testDirectory, "profile.enc.json"),
      "utf8",
    );
    expect(ciphertext).not.toContain(EMAIL);
    expect(ciphertext).not.toContain(SHORT_PASSWORD);
    await logoutPrivateProfile(first.sessionToken);
    const loggedIn = await loginPrivateProfile({
      email: " SYNTHETIC.OWNER@EXAMPLE.TEST ",
      password: SHORT_PASSWORD,
    });
    expect(loggedIn.profile.email).toBe(EMAIL);
    expect(await readPrivateProfile(loggedIn.sessionToken)).not.toBeNull();
    await updatePrivateProfile(loggedIn.sessionToken, {
      displayName: "Updated owner",
    });
    expect(
      (await readPrivateProfile(loggedIn.sessionToken))?.profile.email,
    ).toBe(EMAIL);
  });

  it("uses the same generic authentication failure for wrong, missing, and invalid emails or passwords", async () => {
    const { setupToken } = await provision();
    await setupPrivateProfile({
      token: setupToken,
      displayName: "Synthetic owner",
      email: EMAIL,
      password: SHORT_PASSWORD,
    });
    const attempts = [
      { password: SHORT_PASSWORD },
      { email: "different.owner@example.test", password: SHORT_PASSWORD },
      { email: "invalid-email", password: SHORT_PASSWORD },
      { email: EMAIL, password: "Wrong123!x" },
    ];
    for (const attempt of attempts)
      await expect(loginPrivateProfile(attempt)).rejects.toMatchObject({
        code: "auth",
        message: "The email or password is incorrect.",
      });
    expect(
      (await loginPrivateProfile({ email: EMAIL, password: SHORT_PASSWORD }))
        .profile.email,
    ).toBe(EMAIL);
  });

  it("rejects invalid setup emails and passwords shorter than ten without consuming the setup token", async () => {
    const { setupToken } = await provision();
    for (const email of [
      "",
      "not-an-email",
      "name@",
      "name@example.test\nother@example.test",
    ])
      await expect(
        setupPrivateProfile({
          token: setupToken,
          displayName: "Synthetic owner",
          email,
          password: SHORT_PASSWORD,
        }),
      ).rejects.toMatchObject({
        code: "invalid",
        message: "Enter a valid email address.",
      });
    await expect(
      setupPrivateProfile({
        token: setupToken,
        displayName: "Synthetic owner",
        email: EMAIL,
        password: "Nine123!x",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await getPrivateProfileStatus()).toMatchObject({
      exists: true,
      needsSetup: true,
    });
    expect(
      (
        await setupPrivateProfile({
          token: setupToken,
          displayName: "Synthetic owner",
          email: EMAIL,
          password: SHORT_PASSWORD,
        })
      ).profile.email,
    ).toBe(EMAIL);
  });

  it("keeps legacy profiles without an email compatible with password-only login", async () => {
    const first = await established();
    expect(first.profile.email).toBeUndefined();
    expect(await getPrivateProfileStatus()).toEqual({
      exists: true,
      needsSetup: false,
      emailRequired: false,
    });
    await logoutPrivateProfile(first.sessionToken);
    const loggedIn = await loginPrivateProfile({ password: PASSWORD });
    expect(loggedIn.profile.email).toBeUndefined();
    expect(await readPrivateProfile(loggedIn.sessionToken)).not.toBeNull();
  });

  it("counts a wrong email with the correct password toward the persistent login throttle", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { setupToken } = await provision();
    await setupPrivateProfile({
      token: setupToken,
      displayName: "Synthetic owner",
      email: EMAIL,
      password: SHORT_PASSWORD,
    });
    for (let index = 0; index < 10; index++)
      await expect(
        loginPrivateProfile({
          email: "other@example.test",
          password: SHORT_PASSWORD,
        }),
      ).rejects.toMatchObject({ code: "auth" });
    await expect(
      loginPrivateProfile({ email: EMAIL, password: SHORT_PASSWORD }),
    ).rejects.toThrow("Too many sign-in attempts");
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    expect(
      (await loginPrivateProfile({ email: EMAIL, password: SHORT_PASSWORD }))
        .profile.email,
    ).toBe(EMAIL);
  });

  it("stays disabled unless explicitly enabled and validates production test overrides", async () => {
    vi.stubEnv("FINANCE_PRIVATE_ENABLED", "false");
    expect(privateProfileEnabled()).toBe(false);
    expect(await getPrivateProfileStatus()).toMatchObject({
      exists: false,
      needsSetup: false,
    });
    await expect(provision()).rejects.toMatchObject({ code: "disabled" });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FINANCE_PRIVATE_TEST_MODE", "true");
    expect(() => privateProfileDirectory()).toThrow(
      "isolated test profile directory",
    );
    const isolated = path.join(
      tmpdir(),
      "finance-os-private-e2e-test",
      "profile",
    );
    vi.stubEnv("FINANCE_PRIVATE_DIR", isolated);
    expect(privateProfileDirectory()).toBe(path.resolve(isolated));
    vi.stubEnv("FINANCE_PRIVATE_DIR", path.resolve("."));
    expect(() => privateProfileDirectory()).toThrow(
      "isolated test profile directory",
    );
  });

  it("requires the unguessable one-use setup token before any financial read", async () => {
    expect(await getPrivateProfileStatus()).toMatchObject({
      exists: false,
      needsSetup: false,
    });
    const { setupToken, profile } = await provision();
    expect(profile.id).toBe(OWNER);
    expect(await getPrivateProfileStatus()).toMatchObject({
      exists: true,
      needsSetup: true,
    });
    expect(await readPrivateProfile(setupToken)).toBeNull();
    expect(await readPrivateProfile("bad-session")).toBeNull();
    await expect(
      setupPrivateProfile({
        token: "0".repeat(64),
        displayName: "Test",
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "setup" });
    await expect(provision()).rejects.toMatchObject({ code: "exists" });
    const { sessionToken } = await setupPrivateProfile({
      token: setupToken,
      displayName: "  Chosen owner  ",
      password: PASSWORD,
    });
    expect((await readPrivateProfile(sessionToken))?.profile.displayName).toBe(
      "Chosen owner",
    );
    expect(await getPrivateProfileStatus()).toMatchObject({
      exists: true,
      needsSetup: false,
    });
    await expect(
      setupPrivateProfile({
        token: setupToken,
        displayName: "Replacement",
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "setup" });
  });

  it("encrypts the workspace, profile, credentials, and tokens at rest", async () => {
    const { setupToken } = await provision();
    const { sessionToken } = await setupPrivateProfile({
      token: setupToken,
      displayName: "Synthetic profile owner",
      password: PASSWORD,
    });
    const ciphertext = await fs.readFile(
      path.join(testDirectory, "profile.enc.json"),
      "utf8",
    );
    for (const secret of [
      "Synthetic profile owner",
      "Synthetic test checking",
      OWNER,
      PASSWORD,
      setupToken,
      sessionToken,
    ])
      expect(ciphertext).not.toContain(secret);
    const envelope = JSON.parse(ciphertext);
    expect(envelope.version).toBe(1);
    expect(Buffer.from(envelope.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(envelope.tag, "base64")).toHaveLength(16);
    expect(
      await fs.readFile(path.join(testDirectory, "profile.key")),
    ).toHaveLength(32);
    expect(
      (await readPrivateProfile(sessionToken))?.workspace.accounts,
    ).toHaveLength(1);
    expect((await fs.readdir(testDirectory)).sort()).toEqual([
      "profile.enc.json",
      "profile.key",
    ]);
  });

  it("rejects expired setup links and enforces the password length", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { setupToken } = await provision();
    await expect(
      setupPrivateProfile({
        token: setupToken,
        displayName: "Test",
        password: "too short",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);
    await expect(
      setupPrivateProfile({
        token: setupToken,
        displayName: "Test",
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "setup" });
    expect(await getPrivateProfileStatus()).toMatchObject({
      exists: true,
      needsSetup: true,
    });
  });

  it("rejects incorrect passwords, revokes signed-out sessions, and expires sessions in seven days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const first = await established();
    await expect(
      loginPrivateProfile({ password: "Incorrect password 732!" }),
    ).rejects.toMatchObject({ code: "auth" });
    const second = await loginPrivateProfile({ password: PASSWORD });
    expect(await readPrivateProfile(second.sessionToken)).not.toBeNull();
    await logoutPrivateProfile(second.sessionToken);
    expect(await readPrivateProfile(second.sessionToken)).toBeNull();
    expect(await readPrivateProfile(first.sessionToken)).not.toBeNull();
    vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1);
    expect(await readPrivateProfile(first.sessionToken)).toBeNull();
    await expect(
      savePrivateRecord(first.sessionToken, "transactions", transaction()),
    ).rejects.toMatchObject({ code: "auth" });
  });

  it("denies cross-owner or invalid linked records without persisting partial mutations", async () => {
    const { sessionToken } = await established();
    await expect(
      savePrivateRecord("0".repeat(64), "transactions", transaction()),
    ).rejects.toMatchObject({ code: "auth" });
    await expect(
      savePrivateRecord(
        sessionToken,
        "transactions",
        transaction({ userId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      savePrivateRecord(
        sessionToken,
        "transactions",
        transaction({ fromAccountId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    const saved = await savePrivateRecord(
      sessionToken,
      "transactions",
      transaction(),
    );
    expect(saved.transactions).toHaveLength(1);
    expect(saved.auditEvents).toHaveLength(1);
    expect(saved.auditEvents[0].userId).toBe(OWNER);
    const edited = await savePrivateRecord(sessionToken, "transactions", {
      ...saved.transactions[0],
      description: "Edited synthetic purchase",
    });
    expect(edited.transactions).toHaveLength(1);
    expect(edited.auditEvents).toHaveLength(2);
    expect(edited.auditEvents[1].action).toBe("updated");
  });

  it("round-trips seller and platform independently in encrypted private storage", async () => {
    const { sessionToken } = await established();
    const legacy = transaction({ merchant: "Synthetic legacy seller" });
    const purchase = transaction({
      description: "Synthetic Biryani seller",
      merchant: "Synthetic Biryani seller",
      platform: "Swiggy",
    });
    await savePrivateRecord(sessionToken, "transactions", legacy);
    await savePrivateRecord(sessionToken, "transactions", purchase);
    const saved = (await readPrivateProfile(sessionToken))!.workspace
      .transactions;
    expect(saved.find((row) => row.id === legacy.id)).not.toHaveProperty(
      "platform",
    );
    expect(saved.find((row) => row.id === purchase.id)).toMatchObject({
      platform: "Swiggy",
      merchant: "Synthetic Biryani seller",
      description: "Synthetic Biryani seller",
      amount: "123.45",
    });
    const encrypted = await fs.readFile(
      path.join(testDirectory, "profile.enc.json"),
      "utf8",
    );
    expect(encrypted).not.toContain("Swiggy");
    expect(encrypted).not.toContain("Synthetic Biryani seller");
    await savePrivateRecord(sessionToken, "transactions", {
      ...purchase,
      platform: "Zomato",
    });
    expect(
      (await readPrivateProfile(sessionToken))!.workspace.transactions.find(
        (row) => row.id === purchase.id,
      ),
    ).toMatchObject({
      platform: "Zomato",
      merchant: "Synthetic Biryani seller",
      description: "Synthetic Biryani seller",
    });
  });

  it("rejects receipt duplicate POSTs across IDs, including voided entries, while retrying the same ID safely", async () => {
    const { sessionToken } = await established();
    const receipt = transaction({ sourceSystem: "receipt_ai", sourceObjectId: "e".repeat(64), externalReference: "RRN987654321" });
    const post = (record: Transaction) => workspacePOST(new NextRequest("http://127.0.0.1:3000/api/workspace", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json", cookie: `finance-os-private-session=${sessionToken}` },
      body: JSON.stringify({ collection: "transactions", record }),
    }));
    expect((await post(receipt)).status).toBe(200);
    expect((await post(receipt)).status).toBe(200);
    expect((await post({ ...receipt, status: "voided" })).status).toBe(200);
    const repeatedImage = await post({ ...receipt, id: randomUUID(), externalReference: null });
    expect(repeatedImage.status).toBe(400);
    expect((await repeatedImage.json()).error).toContain("Review the existing transaction");
    const repeatedReference = await post({ ...receipt, id: randomUUID(), sourceObjectId: "f".repeat(64), externalReference: " rrn 987654321 " });
    expect(repeatedReference.status).toBe(400);
    expect((await repeatedReference.json()).error).toContain("Review the existing transaction");
    expect((await readPrivateProfile(sessionToken))!.workspace.transactions).toHaveLength(1);
  });

  it("validates initial ownership and links before creating a store", async () => {
    const data = workspace();
    data.transactions.push(transaction({ userId: randomUUID() }));
    await expect(
      provisionPrivateProfile(data, "Synthetic owner"),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await getPrivateProfileStatus()).toMatchObject({
      exists: false,
      needsSetup: false,
    });
    data.transactions = [transaction({ fromAccountId: randomUUID() })];
    await expect(
      provisionPrivateProfile(data, "Synthetic owner"),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await getPrivateProfileStatus()).toMatchObject({
      exists: false,
      needsSetup: false,
    });
  });

  it("commits reviewed imports atomically and deduplicates file and source identities", async () => {
    const { sessionToken } = await established();
    const inputHash = "b".repeat(64);
    const one = reviewedImport(inputHash, 2);
    await expect(
      commitPrivateImport(
        sessionToken,
        [one, reviewedImport(inputHash, 3, { fromAccountId: randomUUID() })],
        inputHash,
        "synthetic.csv",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(
      (await readPrivateProfile(sessionToken))?.workspace.transactions,
    ).toHaveLength(0);
    const first = await commitPrivateImport(
      sessionToken,
      [one, { ...one, id: randomUUID() }],
      inputHash,
      "synthetic.csv",
    );
    expect(first.imported).toBe(1);
    expect(first.duplicates).toBe(1);
    const repeated = await commitPrivateImport(
      sessionToken,
      [one],
      inputHash,
      "synthetic.csv",
    );
    expect(repeated.imported).toBe(0);
    expect(repeated.duplicates).toBe(1);
    expect(repeated.workspace.transactions).toHaveLength(1);
    expect(repeated.workspace.auditEvents).toHaveLength(1);
    const sameSource = await commitPrivateImport(
      sessionToken,
      [{ ...one, id: randomUUID() }],
      inputHash,
      "synthetic-copy.csv",
    );
    expect(sameSource.imported).toBe(0);
    expect(sameSource.duplicates).toBe(1);
  });

  it("adds previously unselected rows from the same statement and leaves a duplicate-only replay unchanged", async () => {
    const { sessionToken } = await established();
    const inputHash = "a".repeat(64);
    const first = reviewedImport(inputHash, 2, {
      externalReference: "SYNTHETIC-REFERENCE-1",
    });
    const later = reviewedImport(inputHash, 3, {
      amount: "45.67",
      externalReference: "SYNTHETIC-REFERENCE-2",
    });
    await commitPrivateImport(
      sessionToken,
      [first],
      inputHash,
      "synthetic.xlsx",
    );
    const file = path.join(testDirectory, "profile.enc.json");
    const before = await fs.readFile(file, "utf8");
    const replay = await commitPrivateImport(
      sessionToken,
      [first],
      inputHash,
      "synthetic.xlsx",
    );
    expect(replay).toMatchObject({ imported: 0, duplicates: 1 });
    expect(await fs.readFile(file, "utf8")).toBe(before);
    const remaining = await commitPrivateImport(
      sessionToken,
      [first, later],
      inputHash,
      "synthetic.xlsx",
    );
    expect(remaining).toMatchObject({ imported: 1, duplicates: 1 });
    const saved = await readPrivateProfile(sessionToken);
    expect(saved?.workspace.transactions.map((row) => row.id)).toEqual([
      first.id,
      later.id,
    ]);
    expect(saved?.workspace.auditEvents).toHaveLength(2);
    expect(
      (
        await commitPrivateImport(
          sessionToken,
          [later],
          inputHash,
          "synthetic.xlsx",
        )
      ).imported,
    ).toBe(0);
  });

  it("deduplicates overlapping exports against a compatible bank reference without replacing the existing entry", async () => {
    const { sessionToken } = await established();
    const original = transaction({
      amount: "00123.45",
      description: " Synthetic   PURCHASE for isolated tests ",
      externalReference: "SYNTHETIC-OVERLAP",
    });
    await savePrivateRecord(sessionToken, "transactions", original);
    const inputHash = "c".repeat(64);
    const result = await commitPrivateImport(
      sessionToken,
      [
        reviewedImport(inputHash, 2, {
          externalReference: "SYNTHETIC-OVERLAP",
        }),
      ],
      inputHash,
      "synthetic-overlap.xlsx",
    );
    expect(result).toMatchObject({ imported: 0, duplicates: 1 });
    expect(result.workspace.transactions).toHaveLength(1);
    expect(result.workspace.transactions[0]).toMatchObject({
      id: original.id,
      amount: "00123.45",
      sourceSystem: "synthetic-test",
    });
    expect(result.workspace.auditEvents).toHaveLength(1);
  });

  it("scopes bank references to the mapped account and allows reviewed equal purchases without references", async () => {
    const { sessionToken } = await established();
    const otherAccount = randomUUID();
    await savePrivateRecord(sessionToken, "accounts", {
      ...workspace().accounts[0],
      id: otherAccount,
      name: "Second synthetic bank",
    });
    await savePrivateRecord(
      sessionToken,
      "transactions",
      transaction({ externalReference: "SYNTHETIC-SHARED-REFERENCE" }),
    );
    const inputHash = "d".repeat(64);
    const rows = [
      reviewedImport(inputHash, 2, {
        fromAccountId: otherAccount,
        externalReference: "SYNTHETIC-SHARED-REFERENCE",
      }),
      reviewedImport(inputHash, 3),
      reviewedImport(inputHash, 4),
    ];
    const result = await commitPrivateImport(
      sessionToken,
      rows,
      inputHash,
      "synthetic-separate.xlsx",
    );
    expect(result).toMatchObject({ imported: 3, duplicates: 0 });
    expect(result.workspace.transactions).toHaveLength(4);
  });

  it("rolls back a whole batch when a later row conflicts with an existing bank reference", async () => {
    const { sessionToken } = await established();
    const original = transaction({ externalReference: "SYNTHETIC-CONFLICT" });
    await savePrivateRecord(sessionToken, "transactions", original);
    const file = path.join(testDirectory, "profile.enc.json");
    const before = await fs.readFile(file, "utf8");
    const inputHash = "e".repeat(64);
    const rows = [
      reviewedImport(inputHash, 2),
      reviewedImport(inputHash, 3, {
        amount: "10.00",
        externalReference: "SYNTHETIC-CONFLICT",
      }),
    ];
    await expect(
      commitPrivateImport(
        sessionToken,
        rows,
        inputHash,
        "synthetic-conflict.xlsx",
      ),
    ).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("different or ambiguous"),
    });
    expect(await fs.readFile(file, "utf8")).toBe(before);
    expect(
      (await readPrivateProfile(sessionToken))?.workspace.transactions.map(
        (row) => row.id,
      ),
    ).toEqual([original.id]);
  });

  it("recognizes the same transfer when it is reviewed from either linked bank statement", async () => {
    const { sessionToken } = await established();
    const otherAccount = randomUUID();
    await savePrivateRecord(sessionToken, "accounts", {
      ...workspace().accounts[0],
      id: otherAccount,
      name: "Synthetic transfer source",
    });
    const original = transaction({
      kind: "transfer",
      fromAccountId: otherAccount,
      toAccountId: ACCOUNT,
      externalReference: "SYNTHETIC-BOTH-SIDES",
    });
    await savePrivateRecord(sessionToken, "transactions", original);
    const inputHash = "8".repeat(64);
    const result = await commitPrivateImport(
      sessionToken,
      [
        reviewedImport(inputHash, 2, {
          kind: "transfer",
          fromAccountId: otherAccount,
          toAccountId: ACCOUNT,
          externalReference: "SYNTHETIC-BOTH-SIDES",
        }),
      ],
      inputHash,
      "synthetic-incoming.xlsx",
    );
    expect(result).toMatchObject({ imported: 0, duplicates: 1 });
    expect(result.workspace.transactions.map((row) => row.id)).toEqual([
      original.id,
    ]);
    const incompatible = reviewedImport(inputHash, 3, {
      kind: "income",
      fromAccountId: null,
      toAccountId: ACCOUNT,
      externalReference: "SYNTHETIC-BOTH-SIDES",
    });
    await expect(
      commitPrivateImport(
        sessionToken,
        [incompatible],
        inputHash,
        "synthetic-incoming.xlsx",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(
      (await readPrivateProfile(sessionToken))?.workspace.transactions.map(
        (row) => row.id,
      ),
    ).toEqual([original.id]);
  });

  it("rejects an ambiguous bank reference instead of merging multiple original entries", async () => {
    const { sessionToken } = await established();
    await savePrivateRecord(
      sessionToken,
      "transactions",
      transaction({ externalReference: "SYNTHETIC-AMBIGUOUS" }),
    );
    await savePrivateRecord(
      sessionToken,
      "transactions",
      transaction({ externalReference: "SYNTHETIC-AMBIGUOUS" }),
    );
    const file = path.join(testDirectory, "profile.enc.json");
    const before = await fs.readFile(file, "utf8");
    const inputHash = "f".repeat(64);
    await expect(
      commitPrivateImport(
        sessionToken,
        [
          reviewedImport(inputHash, 2, {
            externalReference: "SYNTHETIC-AMBIGUOUS",
          }),
        ],
        inputHash,
        "synthetic-ambiguous.xlsx",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("rechecks references under the lock when two stale reviewed exports commit concurrently", async () => {
    const { sessionToken } = await established();
    const hashes = ["1".repeat(64), "2".repeat(64)];
    const results = await Promise.all(
      hashes.map((inputHash) =>
        commitPrivateImport(
          sessionToken,
          [
            reviewedImport(inputHash, 2, {
              externalReference: "SYNTHETIC-CONCURRENT",
            }),
          ],
          inputHash,
          "synthetic-concurrent.xlsx",
        ),
      ),
    );
    expect(results.map((result) => result.imported).sort()).toEqual([0, 1]);
    expect(results.map((result) => result.duplicates).sort()).toEqual([0, 1]);
    const saved = await readPrivateProfile(sessionToken);
    expect(saved?.workspace.transactions).toHaveLength(1);
    expect(saved?.workspace.auditEvents).toHaveLength(1);
  });

  it("rejects a concurrent conflicting bank reference and retains only the winning batch", async () => {
    const { sessionToken } = await established();
    const hashes = ["3".repeat(64), "4".repeat(64)];
    const results = await Promise.allSettled(
      hashes.map((inputHash, index) =>
        commitPrivateImport(
          sessionToken,
          [
            reviewedImport(inputHash, 2, {
              amount: index ? "25.00" : "15.00",
              externalReference: "SYNTHETIC-CONCURRENT-CONFLICT",
            }),
          ],
          inputHash,
          "synthetic-concurrent-conflict.xlsx",
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
      code: "invalid",
    });
    const saved = await readPrivateProfile(sessionToken);
    expect(saved?.workspace.transactions).toHaveLength(1);
    expect(saved?.workspace.auditEvents).toHaveLength(1);
  });

  it.each([
    ["other source", { sourceSystem: "synthetic-test" }],
    ["missing source", { sourceSystem: null }],
    ["missing locator", { sourceObjectId: null }],
    ["another file", { sourceObjectId: `${"6".repeat(64)}:2` }],
    ["zero row", { sourceObjectId: `${"5".repeat(64)}:0` }],
    ["fractional row", { sourceObjectId: `${"5".repeat(64)}:2.5` }],
    ["unsafe row", { sourceObjectId: `${"5".repeat(64)}:9007199254740992` }],
    ["pending entry", { status: "pending_review" }],
    ["missing date", { occurredOn: null }],
    ["foreign owner", { userId: "9126bd9a-b50c-4e4b-84d2-d4aa8f6ce128" }],
    ["rounded amount", { amount: "1.234" }],
    [
      "expense destination",
      { toAccountId: "c5b26d12-7946-4e2a-b7f0-b89247ea22c6" },
    ],
    [
      "external-only expense",
      { fromAccountId: null, externalPayer: "Synthetic external payer" },
    ],
    ["one-sided transfer", { kind: "transfer" }],
    ["one-sided bill payment", { kind: "bill_payment" }],
    ["outgoing income", { kind: "income" }],
  ] as [string, Partial<Transaction>][])(
    "rejects invalid import lineage or strict values: %s",
    async (_name, overrides) => {
      const { sessionToken } = await established();
      const inputHash = "5".repeat(64);
      const file = path.join(testDirectory, "profile.enc.json");
      const before = await fs.readFile(file, "utf8");
      await expect(
        commitPrivateImport(
          sessionToken,
          [
            reviewedImport(inputHash, 2),
            reviewedImport(inputHash, 3, overrides),
          ],
          inputHash,
          "synthetic-invalid.xlsx",
        ),
      ).rejects.toMatchObject({ code: "invalid" });
      expect(await fs.readFile(file, "utf8")).toBe(before);
    },
  );

  it("rejects an inactive mapped account without committing an earlier valid row", async () => {
    const { sessionToken } = await established();
    const inactiveAccount = randomUUID();
    await savePrivateRecord(sessionToken, "accounts", {
      ...workspace().accounts[0],
      id: inactiveAccount,
      active: false,
    });
    const inputHash = "7".repeat(64);
    await expect(
      commitPrivateImport(
        sessionToken,
        [
          reviewedImport(inputHash, 2),
          reviewedImport(inputHash, 3, { fromAccountId: inactiveAccount }),
        ],
        inputHash,
        "synthetic-inactive.xlsx",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(
      (await readPrivateProfile(sessionToken))?.workspace.transactions,
    ).toHaveLength(0);
  });

  it("serializes simultaneous mutations so no saved financial record is lost", async () => {
    const { sessionToken } = await established();
    const rows = Array.from({ length: 5 }, () => transaction());
    await Promise.all(
      rows.map((row) => savePrivateRecord(sessionToken, "transactions", row)),
    );
    const result = await readPrivateProfile(sessionToken);
    expect(result?.workspace.transactions.map((row) => row.id).sort()).toEqual(
      rows.map((row) => row.id).sort(),
    );
    expect(result?.workspace.auditEvents).toHaveLength(5);
  });

  it("persists the ten-attempt login throttle and clears it after the ten-minute window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await established();
    for (let index = 0; index < 10; index++)
      await expect(
        loginPrivateProfile({ password: "Wrong test password!" }),
      ).rejects.toMatchObject({ code: "auth" });
    await expect(loginPrivateProfile({ password: PASSWORD })).rejects.toThrow(
      "Too many sign-in attempts",
    );
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    const result = await loginPrivateProfile({ password: PASSWORD });
    expect(await readPrivateProfile(result.sessionToken)).not.toBeNull();
  });

  it("updates profile details and revokes other sessions after a password change", async () => {
    const first = await established();
    const other = await loginPrivateProfile({ password: PASSWORD });
    await expect(
      updatePrivateProfile("0".repeat(64), { displayName: "Blocked" }),
    ).rejects.toMatchObject({ code: "auth" });
    const profile = await updatePrivateProfile(first.sessionToken, {
      displayName: "Edited profile",
      password: "Changed synthetic password 426!",
    });
    expect(profile.displayName).toBe("Edited profile");
    expect(await readPrivateProfile(other.sessionToken)).toBeNull();
    expect(await readPrivateProfile(first.sessionToken)).not.toBeNull();
    await expect(
      loginPrivateProfile({ password: PASSWORD }),
    ).rejects.toMatchObject({ code: "auth" });
    expect(
      (
        await loginPrivateProfile({
          password: "Changed synthetic password 426!",
        })
      ).profile.displayName,
    ).toBe("Edited profile");
  });

  it("rejects ciphertext tampering and never silently replaces a missing encryption key", async () => {
    const { sessionToken } = await established();
    const file = path.join(testDirectory, "profile.enc.json");
    const original = await fs.readFile(file, "utf8");
    const envelope = JSON.parse(original);
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    ciphertext[0] ^= 1;
    envelope.ciphertext = ciphertext.toString("base64");
    await fs.writeFile(file, JSON.stringify(envelope));
    await expect(readPrivateProfile(sessionToken)).rejects.toMatchObject({
      code: "storage",
    });
    await fs.writeFile(file, original);
    await fs.unlink(path.join(testDirectory, "profile.key"));
    await expect(readPrivateProfile(sessionToken)).rejects.toMatchObject({
      code: "storage",
    });
    await expect(
      fs.access(path.join(testDirectory, "profile.key")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
