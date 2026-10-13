import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyCommerceCommand,
  emptyCommerce,
  type CommerceData,
  type ReviewedOrderDraft,
} from "../src/lib/commerce";
import type { WorkspaceData } from "../src/lib/types";
import { toDatabase } from "../src/lib/supabase/validation";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;`);
  const directory = join(process.cwd(), "supabase/migrations");
  for (const file of readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(join(directory, file), "utf8"));
}, 60000);
afterAll(async () => {
  await db?.close();
});

async function user() {
  const owner = crypto.randomUUID();
  await db.exec("reset role");
  await db.query("insert into auth.users(id) values($1)", [owner]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  return owner;
}
function workspace(owner: string): WorkspaceData {
  return {
    accounts: [
      {
        id: crypto.randomUUID(),
        userId: owner,
        name: "Synthetic bank",
        institution: "Imaginary",
        kind: "bank",
        maskedSuffix: "1234",
        active: true,
        openingBalance: "999999999999.99",
        openingBalanceDate: "2026-10-01",
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
function draft(
  accountId: string,
  overrides: Partial<ReviewedOrderDraft> = {},
): ReviewedOrderDraft {
  return {
    candidateId: crypto.randomUUID(),
    sourceType: "manual",
    platform: "Test store",
    merchant: "Synthetic seller",
    description: "Synthetic stationery",
    orderReferenceHash: null,
    orderReferenceMasked: null,
    occurredOn: "2026-10-09",
    status: "completed",
    amount: "123.45",
    amountRole: "amount_paid",
    currency: "INR",
    paymentStatus: "successful",
    financialEvent: "purchase",
    category: "Stationery",
    items: [],
    sourceImageIndices: [],
    confidence: "high",
    warnings: [],
    expectedRefundAmount: null,
    expectedRefundBy: null,
    action: "create",
    confirmed: true,
    fromAccountId: accountId,
    externalPayer: null,
    matchedTransactionId: null,
    confirmedDistinct: false,
    sourceFingerprint: null,
    ...overrides,
  };
}
async function bootstrap(
  data: WorkspaceData,
  commerce = emptyCommerce(),
  key = "a".repeat(64),
) {
  return (
    await db.query<{ result: { alreadyImported: boolean } }>(
      "select bootstrap_finance_cloud($1::jsonb,$2::jsonb,$3) as result",
      [JSON.stringify(data), JSON.stringify(commerce), key],
    )
  ).rows[0].result;
}
async function read() {
  return (
    await db.query<{
      result: {
        workspace: WorkspaceData;
        commerce: CommerceData;
        revision: string;
      };
    }>("select read_finance_cloud_state() as result")
  ).rows[0].result;
}
async function commit(
  previous: Awaited<ReturnType<typeof read>>,
  applied: ReturnType<typeof applyCommerceCommand>,
  owner: string,
) {
  const old = new Map(
    previous.workspace.transactions.map((row) => [row.id, JSON.stringify(row)]),
  );
  const changed = applied.workspace.transactions
    .filter((row) => old.get(row.id) !== JSON.stringify(row))
    .map((row) => toDatabase(row as unknown as Record<string, unknown>, owner));
  return db.query(
    "select commit_finance_commerce($1::bigint,$2::jsonb,$3::jsonb)",
    [
      previous.revision,
      JSON.stringify(changed),
      JSON.stringify(applied.commerce),
    ],
  );
}

describe("executed cloud order and profile database", () => {
  it("imports once with exact decimals, category kinds, original identifiers and immutable historical audits", async () => {
    const owner = await user();
    const data = workspace(owner);
    data.groups.push({
      id: crypto.randomUUID(),
      userId: owner,
      kind: "contribution_pool",
      title: "Synthetic trip pool",
      occurredOn: "2026-10-09",
      merchant: "",
      totalCost: "15.10",
      paidBy: "You",
      transactionId: null,
    });
    const historical = {
      id: crypto.randomUUID(),
      userId: owner,
      entityType: "transaction",
      entityId: crypto.randomUUID(),
      action: "create",
      description: "Synthetic historical event",
      occurredAt: "2026-10-08T10:00:00Z",
    };
    data.auditEvents.push(historical);
    expect((await bootstrap(data)).alreadyImported).toBe(false);
    const saved = await read();
    expect(saved.workspace.accounts[0]).toMatchObject({
      id: data.accounts[0].id,
      userId: owner,
      openingBalance: "999999999999.99",
    });
    expect(saved.workspace.groups[0]).toMatchObject({
      kind: "contribution_pool",
      totalCost: "15.10",
    });
    expect(saved.workspace.auditEvents).toContainEqual(historical);
    expect((await bootstrap(data)).alreadyImported).toBe(true);
    await expect(
      db.query(
        "update legacy_finance_audit_state set data='[]' where user_id=$1",
        [owner],
      ),
    ).rejects.toThrow(/permission denied/);
    await db.query("insert into profiles(user_id,display_name) values($1,$2)", [
      owner,
      "Synthetic owner",
    ]);
    expect(
      (
        await db.query(
          "select display_name from api_profiles where user_id=$1",
          [owner],
        )
      ).rows[0],
    ).toEqual({ display_name: "Synthetic owner" });
    await expect(
      db.query("update profiles set display_name=$1 where user_id=$2", [
        "x".repeat(81),
        owner,
      ]),
    ).rejects.toThrow();
  });

  it("keeps the entire bootstrap atomic on a bad reference and refuses overwriting existing finances", async () => {
    const owner = await user();
    const data = workspace(owner);
    data.snapshots.push({
      id: crypto.randomUUID(),
      userId: owner,
      accountId: crypto.randomUUID(),
      asOf: "2026-10-09T00:00:00Z",
      reportedBalance: "10.10",
      source: "user_report",
      verifiedByUser: true,
    });
    await expect(bootstrap(data)).rejects.toThrow();
    expect((await read()).workspace.accounts).toEqual([]);
    data.snapshots = [];
    await bootstrap(data);
    await expect(
      bootstrap(data, emptyCommerce(), "b".repeat(64)),
    ).rejects.toThrow(/already contains/);
    expect((await read()).workspace.accounts).toHaveLength(1);
  });

  it("saves an order and its bank debit atomically and protects linked money from generic edits", async () => {
    const owner = await user();
    const data = workspace(owner);
    await bootstrap(data);
    const before = await read();
    const applied = applyCommerceCommand(
      before.workspace,
      before.commerce,
      owner,
      {
        action: "commit_orders",
        idempotencyKey: "a".repeat(64),
        orders: [draft(data.accounts[0].id)],
      },
    );
    await commit(before, applied, owner);
    const saved = await read();
    expect(saved.workspace.transactions).toHaveLength(1);
    expect(saved.workspace.transactions[0]).toMatchObject({
      amount: "123.45",
      platform: "Test store",
      merchant: "Synthetic seller",
      status: "posted",
    });
    expect(saved.commerce.orders[0].payments[0].transactionId).toBe(
      saved.workspace.transactions[0].id,
    );
    expect(
      applyCommerceCommand(saved.workspace, saved.commerce, owner, {
        action: "commit_orders",
        idempotencyKey: "a".repeat(64),
        orders: [draft(data.accounts[0].id)],
      }).result.duplicate,
    ).toBe(true);
    await expect(
      db.query("update transactions set amount=124 where id=$1", [
        saved.workspace.transactions[0].id,
      ]),
    ).rejects.toThrow(/linked to an order/);
    await db.query(
      "update transactions set description='Corrected synthetic description' where id=$1",
      [saved.workspace.transactions[0].id],
    );
    await expect(
      db.query("update commerce_state set data=$1::jsonb where user_id=$2", [
        JSON.stringify({ ...saved.commerce, orders: [] }),
        owner,
      ]),
    ).rejects.toThrow(/cannot be unlinked/);
  });

  it("rolls back ledger entries when the final commerce state is invalid", async () => {
    const owner = await user();
    const data = workspace(owner);
    await bootstrap(data);
    const before = await read();
    const applied = applyCommerceCommand(
      before.workspace,
      before.commerce,
      owner,
      {
        action: "commit_orders",
        idempotencyKey: "a".repeat(64),
        orders: [draft(data.accounts[0].id)],
      },
    );
    applied.commerce.orders[0].payments[0].amount = "999.00";
    await expect(commit(before, applied, owner)).rejects.toThrow(/must match/);
    const after = await read();
    expect(after.workspace.transactions).toEqual([]);
    expect(after.commerce).toEqual(emptyCommerce());
    expect(after.revision).toBe(before.revision);
  });

  it("rejects stale desktop state after a phone edit without losing either device's records", async () => {
    const owner = await user();
    const data = workspace(owner);
    await bootstrap(data);
    const desktop = await read();
    await db.query(
      "update accounts set name='Synthetic phone edit' where id=$1",
      [data.accounts[0].id],
    );
    const attempted = applyCommerceCommand(
      desktop.workspace,
      desktop.commerce,
      owner,
      {
        action: "commit_orders",
        idempotencyKey: "a".repeat(64),
        orders: [draft(data.accounts[0].id)],
      },
    );
    await expect(commit(desktop, attempted, owner)).rejects.toMatchObject({
      code: "40001",
    });
    const refreshed = await read();
    expect(refreshed.workspace.accounts[0].name).toBe("Synthetic phone edit");
    await commit(
      refreshed,
      applyCommerceCommand(refreshed.workspace, refreshed.commerce, owner, {
        action: "commit_orders",
        idempotencyKey: "a".repeat(64),
        orders: [draft(data.accounts[0].id)],
      }),
      owner,
    );
    expect((await read()).workspace.transactions).toHaveLength(1);
  });

  it("promotes a pending purchase from Orders while generic financial edits remain blocked", async () => {
    const owner = await user();
    const data = workspace(owner);
    const pending = draft(data.accounts[0].id, {
      action: "pending",
      occurredOn: null,
      amount: "50.10",
    });
    const initial = applyCommerceCommand(data, emptyCommerce(), owner, {
      action: "commit_orders",
      idempotencyKey: "a".repeat(64),
      orders: [pending],
    });
    await bootstrap(initial.workspace, initial.commerce);
    const before = await read();
    await expect(
      db.query("update transactions set amount=60 where id=$1", [
        before.workspace.transactions[0].id,
      ]),
    ).rejects.toThrow(/linked to an order/);
    const applied = applyCommerceCommand(
      before.workspace,
      before.commerce,
      owner,
      {
        action: "commit_orders",
        idempotencyKey: "b".repeat(64),
        orders: [
          {
            ...pending,
            action: "create",
            occurredOn: "2026-10-10",
            amount: "60.10",
            existingOrderId: before.commerce.orders[0].id,
          },
        ],
      },
    );
    await commit(before, applied, owner);
    const saved = await read();
    expect(saved.workspace.transactions).toHaveLength(1);
    expect(saved.workspace.transactions[0]).toMatchObject({
      id: before.workspace.transactions[0].id,
      status: "posted",
      amount: "60.10",
    });
    expect(saved.commerce.orders[0].reviewStatus).toBe("saved");
  });

  it("tracks refund expectations separately and confirms one exact bank credit atomically", async () => {
    const owner = await user();
    const data = workspace(owner);
    const bought = applyCommerceCommand(data, emptyCommerce(), owner, {
      action: "commit_orders",
      idempotencyKey: "a".repeat(64),
      orders: [draft(data.accounts[0].id)],
    });
    const expected = applyCommerceCommand(
      bought.workspace,
      bought.commerce,
      owner,
      {
        action: "save_refund",
        refund: {
          orderId: bought.commerce.orders[0].id,
          originalTransactionId: bought.workspace.transactions[0].id,
          description: "Synthetic return",
          expectedAmount: "30.10",
          expectedBy: null,
          cancelledOn: "2026-10-10",
          destinationAccountId: data.accounts[0].id,
          route: "bank",
          status: "expected",
          itemTitle: null,
          notes: null,
        },
      },
    );
    await bootstrap(expected.workspace, expected.commerce);
    const before = await read();
    expect(before.workspace.transactions).toHaveLength(1);
    const confirmed = applyCommerceCommand(
      before.workspace,
      before.commerce,
      owner,
      {
        action: "verify_refund",
        refundId: before.commerce.refunds[0].id,
        amount: "30.10",
        receivedOn: "2026-10-11",
        destinationAccountId: data.accounts[0].id,
        bankHistoryConfirmed: true,
      },
    );
    await commit(before, confirmed, owner);
    const after = await read();
    expect(after.workspace.transactions).toHaveLength(2);
    expect(after.commerce.refunds[0]).toMatchObject({
      status: "confirmed",
      creditMatches: [{ amount: "30.10" }],
    });
    expect(
      after.workspace.transactions.find((row) => row.kind === "refund"),
    ).toMatchObject({
      amount: "30.10",
      refundOfTransactionId: bought.workspace.transactions[0].id,
    });
    const broken = structuredClone(after.commerce);
    broken.refunds[0].creditMatches = [];
    await expect(
      db.query("update commerce_state set data=$1::jsonb where user_id=$2", [
        JSON.stringify(broken),
        owner,
      ]),
    ).rejects.toThrow(/cannot be removed/);
  });

  it("isolates cloud state and prohibits foreign-owner bootstrap or commerce writes", async () => {
    const first = await user();
    const data = workspace(first);
    const purchase = applyCommerceCommand(data, emptyCommerce(), first, {
      action: "commit_orders",
      idempotencyKey: "a".repeat(64),
      orders: [draft(data.accounts[0].id)],
    });
    await bootstrap(purchase.workspace, purchase.commerce);
    const other = await user();
    expect((await read()).workspace.accounts).toEqual([]);
    expect(
      (await db.query("select * from commerce_state where user_id=$1", [first]))
        .rows,
    ).toEqual([]);
    await expect(bootstrap(data)).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.query(
        "insert into commerce_state(user_id,data) values($1,$2::jsonb)",
        [other, JSON.stringify(purchase.commerce)],
      ),
    ).rejects.toThrow(/ownership/);
    await db.exec("reset role; set role anon");
    await expect(db.query("select read_finance_cloud_state()")).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query("select * from commerce_state")).rejects.toThrow(
      /permission denied/,
    );
  });
});
