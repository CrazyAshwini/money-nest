import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
let previousViewColumns: string[];
const legacyOwner = crypto.randomUUID();
const legacyTransaction = crypto.randomUUID();
const emptyCommerce = { orders: [], refunds: [], operations: [] };

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
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    if (file.endsWith("_transaction_balance_snapshot_anchors.sql")) {
      await db.query("insert into auth.users(id) values($1)", [legacyOwner]);
      await db.query(
        "insert into transactions(id,user_id,amount,kind,description) values($1,$2,45.00,'expense','Existing synthetic expense')",
        [legacyTransaction, legacyOwner],
      );
      previousViewColumns = (
        await db.query<{ column_name: string }>(
          "select column_name from information_schema.columns where table_schema='public' and table_name='api_transactions' order by ordinal_position",
        )
      ).rows.map((row) => row.column_name);
    }
    await db.exec(readFileSync(join(directory, file), "utf8"));
  }
}, 60000);
afterAll(async () => {
  await db?.close();
});

async function session(owner: string) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
}
async function newOwner() {
  const owner = crypto.randomUUID();
  await db.exec("reset role");
  await db.query("insert into auth.users(id) values($1)", [owner]);
  await session(owner);
  return owner;
}
async function fixture() {
  const owner = await newOwner();
  const bank = crypto.randomUUID();
  const wallet = crypto.randomUUID();
  const card = crypto.randomUUID();
  const snapshot = crypto.randomUUID();
  const walletSnapshot = crypto.randomUUID();
  const cardSnapshot = crypto.randomUUID();
  const unknownBalance = crypto.randomUUID();
  await db.query(
    "insert into accounts(id,user_id,name,kind) values($1,$4,'Synthetic bank','bank'),($2,$4,'Synthetic wallet','wallet'),($3,$4,'Synthetic card','credit_card')",
    [bank, wallet, card, owner],
  );
  // UTC is still the 14th, but this report belongs to the 15th in IST.
  await db.query(
    "insert into account_snapshots(id,user_id,account_id,as_of,reported_balance,reported_available,source) values($1,$5,$6,'2026-10-14T20:00:00Z',1000,null,'user_report'),($2,$5,$7,'2026-10-14T20:00:00Z',100,null,'user_report'),($3,$5,$8,'2026-10-14T20:00:00Z',100,null,'user_report'),($4,$5,$6,'2026-10-14T20:00:00Z',null,100,'user_report')",
    [
      snapshot,
      walletSnapshot,
      cardSnapshot,
      unknownBalance,
      owner,
      bank,
      wallet,
      card,
    ],
  );
  return {
    owner,
    bank,
    wallet,
    card,
    snapshot,
    walletSnapshot,
    cardSnapshot,
    unknownBalance,
  };
}
async function insertTransaction(
  f: Awaited<ReturnType<typeof fixture>>,
  overrides: Record<string, unknown> = {},
) {
  const record = {
    id: crypto.randomUUID(),
    user_id: f.owner,
    amount: "45.00",
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurred_on: "2026-10-15",
    description: "Synthetic same-day expense",
    from_account_id: f.bank,
    to_account_id: null,
    from_balance_snapshot_id: f.snapshot,
    to_balance_snapshot_id: null,
    ...overrides,
  };
  await db.query(
    "insert into transactions(id,user_id,amount,currency,kind,status,occurred_on,description,from_account_id,to_account_id,from_balance_snapshot_id,to_balance_snapshot_id) select id,user_id,amount,currency,kind,status,occurred_on,description,from_account_id,to_account_id,from_balance_snapshot_id,to_balance_snapshot_id from jsonb_populate_record(null::transactions,$1)",
    [JSON.stringify(record)],
  );
  return record;
}
async function readTransaction(id: string) {
  return (
    await db.query<{
      amount: string;
      from_balance_snapshot_id: string | null;
      to_balance_snapshot_id: string | null;
    }>(
      "select amount,from_balance_snapshot_id,to_balance_snapshot_id from api_transactions where id=$1",
      [id],
    )
  ).rows[0];
}
async function revision() {
  return (
    await db.query<{ value: { revision: string } }>(
      "select read_finance_cloud_state() as value",
    )
  ).rows[0].value.revision;
}
function workspace(owner: string) {
  const bank = crypto.randomUUID();
  const snapshot = crypto.randomUUID();
  return {
    accounts: [
      { id: bank, userId: owner, name: "Synthetic bank", kind: "bank" },
    ],
    snapshots: [
      {
        id: snapshot,
        userId: owner,
        accountId: bank,
        asOf: "2026-10-14T20:00:00Z",
        reportedBalance: "1000.00",
        source: "user_report",
      },
    ],
    transactions: [
      {
        id: crypto.randomUUID(),
        userId: owner,
        amount: "45.00",
        kind: "expense",
        status: "posted",
        occurredOn: "2026-10-15",
        description: "Synthetic expense",
        fromAccountId: bank,
        fromBalanceSnapshotId: snapshot,
      },
    ],
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

describe("explicit same-day balance report persistence", () => {
  it("leaves existing rows untouched and appends exact-decimal, owner-scoped view columns", async () => {
    await session(legacyOwner);
    expect(await readTransaction(legacyTransaction)).toEqual({
      amount: "45.00",
      from_balance_snapshot_id: null,
      to_balance_snapshot_id: null,
    });
    const columns = (
      await db.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema='public' and table_name='api_transactions' order by ordinal_position",
      )
    ).rows.map((row) => row.column_name);
    expect(columns).toEqual([
      ...previousViewColumns,
      "from_balance_snapshot_id",
      "to_balance_snapshot_id",
    ]);
    await newOwner();
    expect(await readTransaction(legacyTransaction)).toBeUndefined();
  });

  it("stores debit and credit confirmations, including both transfer sides on the IST date", async () => {
    const f = await fixture();
    const expense = await insertTransaction(f);
    const income = await insertTransaction(f, {
      kind: "income",
      from_account_id: null,
      from_balance_snapshot_id: null,
      to_account_id: f.wallet,
      to_balance_snapshot_id: f.walletSnapshot,
    });
    const transfer = await insertTransaction(f, {
      kind: "transfer",
      to_account_id: f.wallet,
      to_balance_snapshot_id: f.walletSnapshot,
    });
    expect((await readTransaction(expense.id)).from_balance_snapshot_id).toBe(
      f.snapshot,
    );
    expect((await readTransaction(income.id)).to_balance_snapshot_id).toBe(
      f.walletSnapshot,
    );
    expect(await readTransaction(transfer.id)).toEqual({
      amount: "45.00",
      from_balance_snapshot_id: f.snapshot,
      to_balance_snapshot_id: f.walletSnapshot,
    });
  });

  it("rejects other owners, accounts, liability reports, unknown balances, missing reports, and mismatched dates", async () => {
    const foreign = await fixture();
    const f = await fixture();
    const invalid = [
      { from_balance_snapshot_id: foreign.snapshot },
      { from_balance_snapshot_id: f.walletSnapshot },
      { from_account_id: f.card, from_balance_snapshot_id: f.cardSnapshot },
      { from_balance_snapshot_id: f.unknownBalance },
      { from_balance_snapshot_id: crypto.randomUUID() },
      { occurred_on: "2026-10-14" },
      { occurred_on: null, status: "pending_review" },
      { from_account_id: null, status: "pending_review" },
      { to_balance_snapshot_id: f.snapshot },
    ];
    for (const overrides of invalid) {
      await expect(insertTransaction(f, overrides)).rejects.toThrow(
        "owned asset balance report",
      );
    }
  });

  it("preserves confirmations on descriptive updates and rejects account/date changes until cleared", async () => {
    const f = await fixture();
    const transaction = await insertTransaction(f);
    await db.query(
      "update transactions set description='Revised synthetic label' where id=$1",
      [transaction.id],
    );
    expect(
      (await readTransaction(transaction.id)).from_balance_snapshot_id,
    ).toBe(f.snapshot);
    await expect(
      db.query("update transactions set occurred_on='2026-10-16' where id=$1", [
        transaction.id,
      ]),
    ).rejects.toThrow("owned asset balance report");
    await expect(
      db.query("update transactions set from_account_id=$2 where id=$1", [
        transaction.id,
        f.wallet,
      ]),
    ).rejects.toThrow("owned asset balance report");
    await db.query(
      "update transactions set occurred_on='2026-10-16',from_balance_snapshot_id=null where id=$1",
      [transaction.id],
    );
    expect(
      (await readTransaction(transaction.id)).from_balance_snapshot_id,
    ).toBeNull();
  });

  it("allows report balance corrections while rejecting linked report account/date/unknown-balance changes", async () => {
    const f = await fixture();
    await insertTransaction(f);
    await db.query(
      "update account_snapshots set reported_balance=1001 where id=$1",
      [f.snapshot],
    );
    await expect(
      db.query(
        "update account_snapshots set as_of='2026-10-15T20:00:00Z' where id=$1",
        [f.snapshot],
      ),
    ).rejects.toThrow("Remove transaction balance confirmations");
    await expect(
      db.query("update account_snapshots set account_id=$2 where id=$1", [
        f.snapshot,
        f.wallet,
      ]),
    ).rejects.toThrow("Remove transaction balance confirmations");
    await expect(
      db.query(
        "update account_snapshots set reported_balance=null,reported_available=100 where id=$1",
        [f.snapshot],
      ),
    ).rejects.toThrow("Remove transaction balance confirmations");
  });

  it("clears either reference when its report is deleted and retains the financial transaction", async () => {
    const f = await fixture();
    const transaction = await insertTransaction(f, {
      kind: "transfer",
      to_account_id: f.wallet,
      to_balance_snapshot_id: f.walletSnapshot,
    });
    // The existing API intentionally denies hard deletes. Verify the FK action
    // under the administrative role without broadening application grants.
    await db.exec("reset role");
    await db.query("delete from account_snapshots where id=any($1::uuid[])", [
      [f.snapshot, f.walletSnapshot],
    ]);
    await session(f.owner);
    expect(await readTransaction(transaction.id)).toEqual({
      amount: "45.00",
      from_balance_snapshot_id: null,
      to_balance_snapshot_id: null,
    });
  });

  it("keeps reviewed-import confirmations and retains import retry identity", async () => {
    const f = await fixture();
    const entry = {
      id: crypto.randomUUID(),
      amount: "45.00",
      kind: "transfer",
      status: "posted",
      occurredOn: "2026-10-15",
      description: "Synthetic imported transfer",
      fromAccountId: f.bank,
      toAccountId: f.wallet,
      fromBalanceSnapshotId: f.snapshot,
      toBalanceSnapshotId: f.walletSnapshot,
      sourceObjectId: "synthetic-row",
    };
    const args = ["a".repeat(64), "synthetic.csv", JSON.stringify([entry])];
    await db.query("select commit_reviewed_import($1,$2,$3)", args);
    await db.query("select commit_reviewed_import($1,$2,$3)", args);
    expect(await readTransaction(entry.id)).toEqual({
      amount: "45.00",
      from_balance_snapshot_id: f.snapshot,
      to_balance_snapshot_id: f.walletSnapshot,
    });
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from transactions where id=$1",
          [entry.id],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("persists commerce confirmations, preserves omitted fields, rejects invalid changes, and permits explicit clearing", async () => {
    const f = await fixture();
    const entry = {
      id: crypto.randomUUID(),
      user_id: f.owner,
      amount: "45.00",
      currency: "INR",
      kind: "transfer",
      status: "posted",
      occurred_on: "2026-10-15",
      description: "Synthetic commerce transfer",
      from_account_id: f.bank,
      to_account_id: f.wallet,
      from_balance_snapshot_id: f.snapshot,
      to_balance_snapshot_id: f.walletSnapshot,
    };
    const commit = async (item: Record<string, unknown>) =>
      db.query("select commit_finance_commerce($1,$2,$3)", [
        await revision(),
        JSON.stringify([item]),
        JSON.stringify(emptyCommerce),
      ]);
    await commit(entry);
    const omitted: Record<string, unknown> = { ...entry };
    delete omitted.from_balance_snapshot_id;
    delete omitted.to_balance_snapshot_id;
    await commit({ ...omitted, description: "Revised commerce label" });
    expect(await readTransaction(entry.id)).toEqual({
      amount: "45.00",
      from_balance_snapshot_id: f.snapshot,
      to_balance_snapshot_id: f.walletSnapshot,
    });
    await expect(
      commit({ ...omitted, occurred_on: "2026-10-16" }),
    ).rejects.toThrow("owned asset balance report");
    await commit({
      ...omitted,
      occurred_on: "2026-10-16",
      from_balance_snapshot_id: null,
      to_balance_snapshot_id: null,
    });
    expect(
      (await readTransaction(entry.id)).from_balance_snapshot_id,
    ).toBeNull();
  });

  it("bootstraps both linked records and returns the confirmation in cloud state", async () => {
    const owner = await newOwner();
    const data = workspace(owner);
    await db.query("select bootstrap_finance_cloud($1,$2,$3)", [
      JSON.stringify(data),
      JSON.stringify(emptyCommerce),
      "b".repeat(64),
    ]);
    const state = (
      await db.query<{
        value: {
          workspace: { transactions: Array<{ fromBalanceSnapshotId: string }> };
        };
      }>("select read_finance_cloud_state() as value")
    ).rows[0].value;
    expect(state.workspace.transactions[0].fromBalanceSnapshotId).toBe(
      data.snapshots[0].id,
    );
  });

  it("merges private profiles with snapshots before their newly anchored transactions", async () => {
    const owner = await newOwner();
    const data = workspace(owner);
    await db.query("select merge_private_profile_cloud($1,$2,$3)", [
      JSON.stringify(data),
      JSON.stringify(emptyCommerce),
      await revision(),
    ]);
    expect(
      (await readTransaction(data.transactions[0].id)).from_balance_snapshot_id,
    ).toBe(data.snapshots[0].id);
  });

  it("keeps handoff confirmations through a later descriptive merge that omits them", async () => {
    const owner = await newOwner();
    const data = workspace(owner);
    const batch = crypto.randomUUID();
    await db.query(
      "insert into finance_handoff_batches(id,user_id,input_hash,manifest) values($1,$2,$3,'{}')",
      [batch, owner, "c".repeat(64)],
    );
    const merge = async (changes: unknown) =>
      db.query("select merge_finance_handoff($1,$2,$3,'[]','{}')", [
        batch,
        await revision(),
        JSON.stringify(changes),
      ]);
    await merge({
      accounts: data.accounts,
      snapshots: data.snapshots,
      transactions: data.transactions,
    });
    await merge({
      transactions: [
        {
          id: data.transactions[0].id,
          userId: owner,
          amount: "45.00",
          kind: "expense",
          description: "Updated imported label",
        },
      ],
    });
    expect(
      (await readTransaction(data.transactions[0].id)).from_balance_snapshot_id,
    ).toBe(data.snapshots[0].id);
  });

  it("keeps the view and mutation functions under caller permissions", async () => {
    await db.exec("reset role");
    const functions = await db.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[];
    }>(
      "select proname,prosecdef,proconfig from pg_proc where proname in ('validate_transaction_balance_snapshot','protect_transaction_balance_snapshot','commit_reviewed_import','commit_finance_commerce','merge_private_profile_cloud')",
    );
    expect(functions.rows).toHaveLength(5);
    for (const fn of functions.rows) {
      expect(fn.prosecdef).toBe(false);
      expect(fn.proconfig).toContain('search_path=""');
    }
    expect(
      (
        await db.query<{ reloptions: string[] }>(
          "select reloptions from pg_class where oid='public.api_transactions'::regclass",
        )
      ).rows[0].reloptions,
    ).toContain("security_invoker=true");
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_table_privilege('anon','public.api_transactions','select') as allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
    for (const signature of [
      "public.commit_reviewed_import(text,text,jsonb)",
      "public.commit_finance_commerce(bigint,jsonb,jsonb)",
      "public.merge_private_profile_cloud(jsonb,jsonb,bigint)",
    ]) {
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "select has_function_privilege('anon',$1,'execute') as allowed",
            [signature],
          )
        ).rows[0].allowed,
      ).toBe(false);
    }
  });
});
