/** Node-only persistence. Never import this module into client components. */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { OwnedRecord, Transaction, WorkspaceData } from "./types";
import { ReceiptDuplicateError, validateWorkspaceRecord, workspaceRecordSchemas } from "./validation";
import {
  applyCommerceCommand,
  assertCommerceTransactionEdit,
  commerceDataSchema,
  commerceSummary,
  emptyCommerce,
  CommerceError,
  type CommerceData,
} from "./commerce";

export interface PrivateProfile {
  id: string;
  displayName: string;
  email?: string;
  currency: "INR";
  timezone: "Asia/Kolkata";
  createdAt: string;
}
interface PasswordHash {
  salt: string;
  hash: string;
}
interface Session {
  tokenHash: string;
  expiresAt: string;
}
interface PrivateStore {
  version: 1;
  profile: PrivateProfile;
  workspace: WorkspaceData;
  passwordHash?: PasswordHash;
  setup?: { tokenHash: string; expiresAt: string };
  sessions: Session[];
  imports: { inputHash: string; imported: number; duplicates: number }[];
  commerce?: CommerceData;
  failedLogins?: { count: number; windowStartedAt: string };
}
interface EncryptedEnvelope {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class PrivateProfileError extends Error {
  constructor(
    public readonly code:
      "disabled" | "auth" | "invalid" | "exists" | "storage" | "setup",
    message: string,
  ) {
    super(message);
    this.name = "PrivateProfileError";
  }
}
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const SETUP_MS = 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const queues = new Map<string, Promise<void>>();
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export function privateProfileEnabled() {
  return process.env.FINANCE_PRIVATE_ENABLED === "true";
}
function requireEnabled() {
  if (!privateProfileEnabled())
    throw new PrivateProfileError(
      "disabled",
      "Private profile is not enabled.",
    );
}
export function privateProfileDirectory() {
  // An override exists only for isolated tests. Real financial files stay outside the checkout.
  if (process.env.NODE_ENV === "test" && process.env.FINANCE_PRIVATE_DIR)
    return path.resolve(process.env.FINANCE_PRIVATE_DIR);
  if (process.env.FINANCE_PRIVATE_TEST_MODE === "true") {
    const override = process.env.FINANCE_PRIVATE_DIR;
    const resolved = override ? path.resolve(override) : "";
    const relative = resolved
      ? path.relative(path.resolve(tmpdir()), resolved)
      : "";
    const temporaryRoot = relative.split(path.sep)[0];
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !temporaryRoot.startsWith("finance-os-private-e2e-")
    )
      throw new PrivateProfileError(
        "storage",
        "The isolated test profile directory is invalid.",
      );
    return resolved;
  }
  return path.join(
    process.env.LOCALAPPDATA || path.join(homedir(), ".local", "share"),
    "PersonalFinanceOS",
    "expense-tracker",
  );
}
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
function tokensEqual(left: string, right: string) {
  if (!HASH_PATTERN.test(left) || !HASH_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
function newSession(store: PrivateStore) {
  const sessionToken = randomBytes(32).toString("hex");
  store.sessions = store.sessions.filter(
    (session) => Date.parse(session.expiresAt) > Date.now(),
  );
  // Bound obsolete devices without allowing an ever-growing session file.
  store.sessions = store.sessions.slice(-19);
  store.sessions.push({
    tokenHash: tokenHash(sessionToken),
    expiresAt: new Date(Date.now() + SESSION_MS).toISOString(),
  });
  return sessionToken;
}
function authenticated(store: PrivateStore | null, token: string) {
  return Boolean(
    store?.passwordHash &&
    TOKEN_PATTERN.test(token) &&
    store.sessions.some(
      (session) =>
        Date.parse(session.expiresAt) > Date.now() &&
        tokensEqual(session.tokenHash, tokenHash(token)),
    ),
  );
}
function displayName(value: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100)
    throw new PrivateProfileError(
      "invalid",
      "Enter a profile name with up to 100 characters.",
    );
  return value.trim();
}
function passwordInput(value: string) {
  if (typeof value !== "string" || value.length < 10 || value.length > 128)
    throw new PrivateProfileError(
      "invalid",
      "Use a password between 10 and 128 characters.",
    );
}
function derivePassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });
}
async function hashPassword(password: string): Promise<PasswordHash> {
  passwordInput(password);
  const salt = randomBytes(32);
  const derived = await derivePassword(password, salt);
  const hash = { salt: salt.toString("hex"), hash: derived.toString("hex") };
  derived.fill(0);
  return hash;
}
async function passwordMatches(password: string, stored: PasswordHash) {
  if (
    typeof password !== "string" ||
    password.length > 128 ||
    !HASH_PATTERN.test(stored.salt) ||
    !/^[a-f0-9]{128}$/.test(stored.hash)
  )
    return false;
  const derived = await derivePassword(
    password,
    Buffer.from(stored.salt, "hex"),
  );
  const matches = timingSafeEqual(derived, Buffer.from(stored.hash, "hex"));
  derived.fill(0);
  return matches;
}
function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
function storageError() {
  return new PrivateProfileError(
    "storage",
    "The private profile could not be accessed. Please retry.",
  );
}
async function fileExists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}
async function readKey(dir: string, create: boolean) {
  const file = path.join(dir, "profile.key");
  try {
    const key = await fs.readFile(file);
    if (key.length !== 32) throw storageError();
    return key;
  } catch (error) {
    if (errorCode(error) !== "ENOENT" || !create) throw storageError();
    const key = randomBytes(32);
    await fs.writeFile(file, key, { flag: "wx", mode: 0o600 });
    return key;
  }
}
async function readStore(dir: string): Promise<PrivateStore | null> {
  const file = path.join(dir, "profile.enc.json");
  if (!(await fileExists(file))) return null;
  const key = await readKey(dir, false);
  let plain: Buffer | undefined;
  try {
    const envelope = JSON.parse(
      await fs.readFile(file, "utf8"),
    ) as EncryptedEnvelope;
    if (
      envelope.version !== 1 ||
      typeof envelope.iv !== "string" ||
      typeof envelope.tag !== "string" ||
      typeof envelope.ciphertext !== "string"
    )
      throw storageError();
    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    if (iv.length !== 12 || tag.length !== 16) throw storageError();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from("PersonalFinanceOS:private-profile:v1"));
    decipher.setAuthTag(tag);
    plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    const store = JSON.parse(plain.toString("utf8")) as PrivateStore;
    if (
      store.version !== 1 ||
      !store.profile ||
      !UUID_PATTERN.test(store.profile.id) ||
      !store.workspace ||
      !Array.isArray(store.sessions) ||
      !Array.isArray(store.imports)
    )
      throw storageError();
    if (store.commerce !== undefined)
      store.commerce = commerceDataSchema.parse(store.commerce);
    return store;
  } catch {
    throw storageError();
  } finally {
    key.fill(0);
    plain?.fill(0);
  }
}
async function writeStore(dir: string, store: PrivateStore) {
  const key = await readKey(dir, true);
  const plain = Buffer.from(JSON.stringify(store));
  const temporary = path.join(dir, `profile.${randomUUID()}.tmp`);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from("PersonalFinanceOS:private-profile:v1"));
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const envelope: EncryptedEnvelope = {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(envelope));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, path.join(dir, "profile.enc.json"));
  } finally {
    key.fill(0);
    plain.fill(0);
    await fs.unlink(temporary).catch(() => undefined);
  }
}
async function acquireFileLock(dir: string) {
  const lockPath = path.join(dir, "profile.lock");
  const started = Date.now();
  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      return async () => {
        await handle.close();
        await fs.unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      // A crash can leave a lock behind; never remove another live process's lock.
      const pid = Number(await fs.readFile(lockPath, "utf8").catch(() => ""));
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (probe) {
          if (errorCode(probe) === "ESRCH")
            await fs.unlink(lockPath).catch(() => undefined);
        }
      }
      if (Date.now() - started > 5000) throw storageError();
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
}
async function withStore<T>(
  operation: (dir: string, store: PrivateStore | null) => Promise<T>,
): Promise<T> {
  requireEnabled();
  const dir = privateProfileDirectory();
  const previous = queues.get(dir) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(
    dir,
    previous.then(() => next),
  );
  await previous;
  let unlock: (() => Promise<void>) | undefined;
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    unlock = await acquireFileLock(dir);
    return await operation(dir, await readStore(dir));
  } catch (error) {
    if (error instanceof PrivateProfileError) throw error;
    throw storageError();
  } finally {
    try {
      await unlock?.();
    } finally {
      release();
    }
  }
}
function requireSession(
  store: PrivateStore | null,
  token: string,
): PrivateStore {
  if (!authenticated(store, token))
    throw new PrivateProfileError("auth", "Sign in to your profile.");
  return store!;
}
function validateWorkspace(input: WorkspaceData): {
  workspace: WorkspaceData;
  owner: string;
} {
  try {
    const workspace = {} as WorkspaceData;
    const owners = new Set<string>();
    for (const collection of Object.keys(
      workspaceRecordSchemas,
    ) as (keyof WorkspaceData)[]) {
      if (!Array.isArray(input[collection])) throw new Error();
      const rows = input[collection].map((row) =>
        workspaceRecordSchemas[collection].parse(row),
      );
      if (new Set(rows.map((row) => row.id)).size !== rows.length)
        throw new Error();
      rows.forEach((row) => owners.add(row.userId));
      Object.assign(workspace, { [collection]: rows });
    }
    if (owners.size > 1) throw new Error();
    const owner = owners.values().next().value ?? randomUUID();
    for (const collection of Object.keys(
      workspaceRecordSchemas,
    ) as (keyof WorkspaceData)[])
      for (const row of workspace[collection])
        validateWorkspaceRecord(workspace, collection, row, owner);
    return { workspace, owner };
  } catch {
    throw new PrivateProfileError(
      "invalid",
      "The workspace contains invalid records or links.",
    );
  }
}
function audit(
  store: PrivateStore,
  entityType: string,
  entityId: string,
  action: string,
  description: string,
) {
  store.workspace.auditEvents.push({
    id: randomUUID(),
    userId: store.profile.id,
    entityType,
    entityId,
    action,
    description,
    occurredAt: new Date().toISOString(),
  });
}

export async function getPrivateProfileStatus(): Promise<{
  exists: boolean;
  needsSetup: boolean;
  emailRequired: boolean;
}> {
  if (!privateProfileEnabled())
    return { exists: false, needsSetup: false, emailRequired: false };
  return withStore(async (_dir, store) => ({
    exists: Boolean(store),
    needsSetup: Boolean(store && !store.passwordHash),
    emailRequired: Boolean(store?.profile.email),
  }));
}
export async function provisionPrivateProfile(
  workspace: WorkspaceData,
  name: string,
) {
  const safeName = displayName(name);
  const validated = validateWorkspace(workspace);
  return withStore(async (dir, existing) => {
    if (existing)
      throw new PrivateProfileError(
        "exists",
        "A private profile already exists.",
      );
    const setupToken = randomBytes(32).toString("hex");
    const profile: PrivateProfile = {
      id: validated.owner,
      displayName: safeName,
      currency: "INR",
      timezone: "Asia/Kolkata",
      createdAt: new Date().toISOString(),
    };
    const store: PrivateStore = {
      version: 1,
      profile,
      workspace: validated.workspace,
      setup: {
        tokenHash: tokenHash(setupToken),
        expiresAt: new Date(Date.now() + SETUP_MS).toISOString(),
      },
      sessions: [],
      imports: [],
    };
    await writeStore(dir, store);
    return { setupToken, profile };
  });
}
export async function setupPrivateProfile(input: {
  token: string;
  displayName: string;
  email?: string;
  password: string;
}) {
  const name = displayName(input.displayName);
  passwordInput(input.password);
  const email =
    input.email === undefined ? undefined : emailSchema.safeParse(input.email);
  if (email && !email.success)
    throw new PrivateProfileError("invalid", "Enter a valid email address.");
  return withStore(async (dir, store) => {
    if (
      !store ||
      store.passwordHash ||
      !store.setup ||
      !TOKEN_PATTERN.test(input.token) ||
      Date.parse(store.setup.expiresAt) <= Date.now() ||
      !tokensEqual(store.setup.tokenHash, tokenHash(input.token))
    )
      throw new PrivateProfileError(
        "setup",
        "Setup link is invalid or expired.",
      );
    store.passwordHash = await hashPassword(input.password);
    store.profile.displayName = name;
    if (email?.success) store.profile.email = email.data;
    delete store.setup;
    const sessionToken = newSession(store);
    await writeStore(dir, store);
    return { sessionToken, profile: store.profile };
  });
}
export async function loginPrivateProfile(input: {
  email?: string;
  password: string;
}) {
  return withStore(async (dir, store) => {
    if (!store?.passwordHash)
      throw new PrivateProfileError(
        "auth",
        "The email or password is incorrect.",
      );
    const recent =
      store.failedLogins &&
      Date.now() - Date.parse(store.failedLogins.windowStartedAt) <
        LOGIN_WINDOW_MS;
    if (recent && store.failedLogins!.count >= 10)
      throw new PrivateProfileError(
        "auth",
        "Too many sign-in attempts. Please try again in ten minutes.",
      );
    // Always perform password derivation, including for a missing/wrong email.
    const matchesPassword = await passwordMatches(
      input.password,
      store.passwordHash,
    );
    const email = emailSchema.safeParse(input.email);
    const matchesEmail =
      !store.profile.email ||
      (email.success && email.data === store.profile.email);
    if (!matchesPassword || !matchesEmail) {
      store.failedLogins = {
        count: recent ? store.failedLogins!.count + 1 : 1,
        windowStartedAt: recent
          ? store.failedLogins!.windowStartedAt
          : new Date().toISOString(),
      };
      await writeStore(dir, store);
      throw new PrivateProfileError(
        "auth",
        "The email or password is incorrect.",
      );
    }
    delete store.failedLogins;
    const sessionToken = newSession(store);
    await writeStore(dir, store);
    return { sessionToken, profile: store.profile };
  });
}
export async function readPrivateProfile(
  sessionToken: string,
): Promise<{ profile: PrivateProfile; workspace: WorkspaceData } | null> {
  return withStore(async (_dir, store) =>
    authenticated(store, sessionToken)
      ? { profile: store!.profile, workspace: store!.workspace }
      : null,
  );
}

/** An explicit, password-free export for a user moving this local profile to cloud storage. */
export async function exportPrivateProfile(sessionToken: string) {
  return withStore(async (_dir, maybeStore) => {
    const store = requireSession(maybeStore, sessionToken);
    const commerce = commerceDataSchema.parse(
      store.commerce ?? emptyCommerce(),
    );
    if (
      commerce.orders.some((row) => row.userId !== store.profile.id) ||
      commerce.refunds.some((row) => row.userId !== store.profile.id)
    )
      throw storageError();
    return {
      format: "money-nest-private-export" as const,
      version: 1 as const,
      profile: {
        id: store.profile.id,
        displayName: store.profile.displayName,
        email: store.profile.email ?? null,
      },
      workspace: store.workspace,
      commerce,
    };
  });
}
export async function savePrivateRecord<K extends keyof WorkspaceData>(
  sessionToken: string,
  collection: K,
  input: WorkspaceData[K][number],
): Promise<WorkspaceData> {
  return withStore(async (dir, maybeStore) => {
    const store = requireSession(maybeStore, sessionToken);
    let record: WorkspaceData[K][number];
    try {
      if (!(collection in workspaceRecordSchemas)) throw new Error();
      if ((input as OwnedRecord).userId !== store.profile.id) throw new Error();
      record = validateWorkspaceRecord(
        store.workspace,
        collection,
        { ...input, userId: store.profile.id },
        store.profile.id,
      );
      if (collection === "transactions")
        assertCommerceTransactionEdit(
          store.commerce ?? emptyCommerce(),
          store.workspace.transactions.find((row) => row.id === record.id),
          record as Transaction,
        );
    } catch (error) {
      throw new PrivateProfileError(
        "invalid",
        error instanceof ReceiptDuplicateError
          ? error.message
          : "Check the record details and linked accounts.",
      );
    }
    const existing = store.workspace[collection].some(
      (row) => row.id === record.id,
    );
    Object.assign(store.workspace, {
      [collection]: existing
        ? store.workspace[collection].map((row) =>
            row.id === record.id ? record : row,
          )
        : [...store.workspace[collection], record],
    });
    if (collection !== "auditEvents")
      audit(
        store,
        collection,
        record.id,
        existing ? "updated" : "created",
        "Financial record saved.",
      );
    await writeStore(dir, store);
    return store.workspace;
  });
}
export async function readPrivateCommerce(sessionToken: string) {
  return withStore(async (_dir, maybeStore) => {
    const store = requireSession(maybeStore, sessionToken);
    const commerce = store.commerce ?? emptyCommerce();
    if (
      commerce.orders.some((row) => row.userId !== store.profile.id) ||
      commerce.refunds.some((row) => row.userId !== store.profile.id)
    )
      throw storageError();
    return { commerce, summary: commerceSummary(commerce, store.workspace) };
  });
}
export async function commitPrivateCommerce(
  sessionToken: string,
  command: unknown,
) {
  return withStore(async (dir, maybeStore) => {
    const store = requireSession(maybeStore, sessionToken);
    try {
      const applied = applyCommerceCommand(
        store.workspace,
        store.commerce ?? emptyCommerce(),
        store.profile.id,
        command,
      );
      if (
        !applied.result.duplicate ||
        applied.result.ordersSaved ||
        applied.result.refundsSaved
      ) {
        store.workspace = applied.workspace;
        store.commerce = applied.commerce;
        await writeStore(dir, store);
      }
      return {
        commerce: applied.commerce,
        summary: commerceSummary(applied.commerce, applied.workspace),
        result: applied.result,
      };
    } catch (error) {
      if (error instanceof CommerceError)
        throw new PrivateProfileError("invalid", error.message);
      throw error;
    }
  });
}
function importAccountsOverlap(left: Transaction, right: Transaction): boolean {
  return [left.fromAccountId, left.toAccountId].some((accountId) =>
    Boolean(
      accountId &&
      (accountId === right.fromAccountId || accountId === right.toAccountId),
    ),
  );
}
function normalizedImportDescription(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-IN");
}
function normalizedImportAmount(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
}
function sameImportShape(left: Transaction, right: Transaction): boolean {
  return (
    left.userId === right.userId &&
    left.kind === right.kind &&
    left.occurredOn === right.occurredOn &&
    normalizedImportAmount(left.amount) ===
      normalizedImportAmount(right.amount) &&
    normalizedImportDescription(left.description) ===
      normalizedImportDescription(right.description) &&
    left.fromAccountId === right.fromAccountId &&
    left.toAccountId === right.toAccountId
  );
}
function validImportDirection(record: Transaction): boolean {
  const from = record.fromAccountId;
  const to = record.toAccountId;
  if (record.kind === "expense") return Boolean(from && !to);
  if (record.kind === "income" || record.kind === "refund")
    return Boolean(to && !from);
  if (record.kind === "transfer" || record.kind === "bill_payment")
    return Boolean(from && to && from !== to);
  return Boolean(from) !== Boolean(to);
}
function validateImportLineage(record: Transaction, inputHash: string): void {
  const locator = record.sourceObjectId?.split(":");
  if (
    record.status !== "posted" ||
    !record.occurredOn ||
    !validImportDirection(record) ||
    record.sourceSystem !== "csv" ||
    locator?.length !== 2 ||
    locator[0] !== inputHash ||
    !/^[1-9]\d*$/.test(locator[1]) ||
    !Number.isSafeInteger(Number(locator[1]))
  )
    throw new Error();
}
export async function commitPrivateImport(
  sessionToken: string,
  transactions: Transaction[],
  inputHash: string,
  fileName: string,
) {
  return withStore(async (dir, maybeStore) => {
    const store = requireSession(maybeStore, sessionToken);
    if (
      !HASH_PATTERN.test(inputHash) ||
      typeof fileName !== "string" ||
      !fileName.trim() ||
      fileName.length > 255 ||
      !Array.isArray(transactions) ||
      !transactions.length ||
      transactions.length > 1000
    )
      throw new PrivateProfileError(
        "invalid",
        "Check the reviewed import details.",
      );
    const prior = store.imports.find((item) => item.inputHash === inputHash);
    const original = store.workspace.transactions;
    const imported: Transaction[] = [];
    let duplicates = 0;
    try {
      for (const input of transactions) {
        if (input.userId !== store.profile.id) throw new Error();
        const record = validateWorkspaceRecord(
          store.workspace,
          "transactions",
          { ...input, userId: store.profile.id },
          store.profile.id,
        );
        validateImportLineage(record, inputHash);
        for (const accountId of [record.fromAccountId, record.toAccountId]) {
          if (
            accountId &&
            !store.workspace.accounts.some(
              (account) =>
                account.id === accountId &&
                account.userId === store.profile.id &&
                account.active,
            )
          )
            throw new Error();
        }
        const reference = record.externalReference?.trim();
        const referenceMatches = reference
          ? store.workspace.transactions.filter(
              (row) =>
                row.userId === store.profile.id &&
                row.externalReference?.trim() === reference &&
                importAccountsOverlap(row, record),
            )
          : [];
        if (referenceMatches.length) {
          if (
            referenceMatches.length !== 1 ||
            !sameImportShape(record, referenceMatches[0])
          ) {
            throw new PrivateProfileError(
              "invalid",
              "A bank reference already exists with different or ambiguous values. Review the existing transaction; no rows were saved.",
            );
          }
          duplicates++;
          continue;
        }
        const duplicate = store.workspace.transactions.some(
          (row) =>
            row.id === record.id ||
            (record.sourceSystem &&
              record.sourceObjectId &&
              row.sourceSystem === record.sourceSystem &&
              row.sourceObjectId === record.sourceObjectId),
        );
        if (duplicate) {
          duplicates++;
          continue;
        }
        imported.push(record);
        store.workspace.transactions = [
          ...store.workspace.transactions,
          record,
        ];
      }
    } catch (error) {
      store.workspace.transactions = original;
      if (error instanceof PrivateProfileError) throw error;
      throw new PrivateProfileError(
        "invalid",
        "The reviewed import contains invalid records or links.",
      );
    }
    // A file can be approved in subsets. Row/source identities remain the retry boundary.
    // A replay that only contains duplicates must not rewrite the encrypted profile.
    if (!imported.length)
      return { imported: 0, duplicates, workspace: store.workspace };
    if (prior) {
      prior.imported += imported.length;
      prior.duplicates += duplicates;
    } else
      store.imports.push({ inputHash, imported: imported.length, duplicates });
    audit(
      store,
      "imports",
      randomUUID(),
      "imported",
      `Reviewed import added ${imported.length} transactions.`,
    );
    await writeStore(dir, store);
    return {
      imported: imported.length,
      duplicates,
      workspace: store.workspace,
    };
  });
}

export async function logoutPrivateProfile(sessionToken: string) {
  return withStore(async (dir, store) => {
    if (!store || !TOKEN_PATTERN.test(sessionToken)) return;
    store.sessions = store.sessions.filter(
      (session) => !tokensEqual(session.tokenHash, tokenHash(sessionToken)),
    );
    await writeStore(dir, store);
  });
}
export async function updatePrivateProfile(
  sessionToken: string,
  input: { displayName: string; password?: string },
): Promise<PrivateProfile> {
  const name = displayName(input.displayName);
  return withStore(async (dir, maybeStore) => {
    const store = requireSession(maybeStore, sessionToken);
    store.profile.displayName = name;
    if (input.password !== undefined) {
      store.passwordHash = await hashPassword(input.password);
      // A password change revokes every other device while retaining this session.
      store.sessions = store.sessions.filter((session) =>
        tokensEqual(session.tokenHash, tokenHash(sessionToken)),
      );
    }
    await writeStore(dir, store);
    return store.profile;
  });
}

/** Authenticate API access without returning profile details or financial records. */
export async function authenticatePrivateProfile(
  sessionToken: string,
): Promise<{ ownerId: string }> {
  return withStore(async (_dir, maybeStore) => {
    const store = requireSession(maybeStore, sessionToken);
    return { ownerId: store.profile.id };
  });
}
