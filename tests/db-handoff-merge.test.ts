import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyCommerce } from "../src/lib/commerce";
import type { Transaction, WorkspaceData } from "../src/lib/types";

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
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(join(directory, file), "utf8"));
  // This test-only BEFORE trigger observes ordering while financial writes occur.
  await db.exec(`create function private.test_handoff_backup_guard() returns trigger language plpgsql security invoker set search_path='' as $$
    declare batch text:=current_setting('test.handoff.batch',true);
    begin
      if nullif(batch,'') is not null then
        if not exists(select 1 from public.finance_handoff_backups where user_id=new.user_id and batch_id=batch::uuid)
          then raise exception 'Backup must precede financial mutation'; end if;
        if not exists(select 1 from public.audit_events where user_id=new.user_id and entity_id=batch::uuid and entity_type='finance_handoff_batches' and action='insert')
          then raise exception 'Stage audit must precede financial mutation'; end if;
      end if;
      return new;
    end $$;
    create trigger test_handoff_backup_guard before insert or update on public.transactions
      for each row execute function private.test_handoff_backup_guard();`);
}, 60000);
afterAll(async () => {
  await db?.close();
});

async function asOwner(owner: string) {
  await db.exec("reset role");
  await db.exec("set role authenticated");
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false), set_config('test.handoff.batch','',false)",
    [owner],
  );
}
async function newOwner() {
  const owner = crypto.randomUUID();
  await db.exec("reset role");
  await db.query("insert into auth.users(id) values($1)", [owner]);
  await asOwner(owner);
  return owner;
}
function workspace(owner: string): WorkspaceData {
  return {
    accounts: [
      {
        id: crypto.randomUUID(),
        userId: owner,
        name: "Synthetic bank",
        institution: "Imaginary Bank",
        kind: "bank",
        maskedSuffix: "1234",
        active: true,
        openingBalance: "500.00",
        openingBalanceDate: "2026-01-01",
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
function transaction(
  owner: string,
  accountId: string,
  values: Partial<Transaction> = {},
): Transaction {
  return {
    id: crypto.randomUUID(),
    userId: owner,
    amount: "25.10",
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: "2026-01-02",
    description: "Synthetic purchase",
    fromAccountId: accountId,
    toAccountId: null,
    ...values,
  };
}
async function bootstrap(data: WorkspaceData) {
  await db.query("select bootstrap_finance_cloud($1::jsonb,$2::jsonb,$3)", [
    JSON.stringify(data),
    JSON.stringify(emptyCommerce()),
    "a".repeat(64),
  ]);
}
async function read() {
  return (
    await db.query<{
      result: {
        workspace: WorkspaceData;
        commerce: ReturnType<typeof emptyCommerce>;
        revision: string;
      };
    }>("select read_finance_cloud_state() as result")
  ).rows[0].result;
}
async function stage(owner: string, revision: string) {
  const batch = crypto.randomUUID();
  await db.query(
    "insert into finance_handoff_batches(id,user_id,input_hash,manifest,expected_revision) values($1,$2,$3,$4::jsonb,$5::bigint)",
    [
      batch,
      owner,
      batch.replaceAll("-", "").repeat(2),
      JSON.stringify({ schema_version: 1, transactions: [] }),
      revision,
    ],
  );
  return batch;
}
const preview = {
  counters: {
    created: 1,
    matched: 0,
    updated: 0,
    ignored: 0,
    needsConfirmation: 0,
  },
  checks: [],
};
function source(recordId: string, sourceId = crypto.randomUUID()) {
  return {
    collection: "transactions",
    recordId,
    sourceSystem: "notion",
    sourceObjectId: sourceId,
    evidence: { filename: "synthetic-handoff.json", row: 1 },
    confirmationState: "confirmed",
  };
}
async function merge(
  batch: string,
  revision: string,
  changes: Record<string, unknown> = {},
  sources: ReturnType<typeof source>[] = [],
  report: object = preview,
) {
  return (
    await db.query<{
      result: {
        ok: boolean;
        writes: number;
        counters: typeof preview.counters;
      };
    }>(
      "select merge_finance_handoff($1::uuid,$2::bigint,$3::jsonb,$4::jsonb,$5::jsonb) as result",
      [
        batch,
        revision,
        JSON.stringify(changes),
        JSON.stringify(sources),
        JSON.stringify(report),
      ],
    )
  ).rows[0].result;
}
async function counts() {
  return (
    await db.query<{
      transactions: number;
      backups: number;
      sources: number;
      transaction_audits: number;
    }>(`select
    (select count(*)::int from transactions) as transactions,
    (select count(*)::int from finance_handoff_backups) as backups,
    (select count(*)::int from finance_source_observations) as sources,
    (select count(*)::int from audit_events where entity_type='transactions') as transaction_audits`)
  ).rows[0];
}

describe("executed private handoff merge", () => {
  it("uses an invoker RPC and rejects anonymous calls and another owner's stage", async () => {
    const owner = await newOwner();
    const data = workspace(owner);
    await bootstrap(data);
    const initial = await read();
    const batch = await stage(owner, initial.revision);
    expect(
      (
        await db.query<{ prosecdef: boolean }>(
          "select prosecdef from pg_proc where oid='public.merge_finance_handoff(uuid,bigint,jsonb,jsonb,jsonb)'::regprocedure",
        )
      ).rows[0].prosecdef,
    ).toBe(false);
    await db.exec("set role anon");
    await expect(merge(batch, initial.revision)).rejects.toMatchObject({
      code: "42501",
    });
    const other = await newOwner();
    await expect(merge(batch, "0")).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await db.query("select id from finance_handoff_batches where id=$1", [
          batch,
        ])
      ).rows,
    ).toEqual([]);
    await expect(
      db.query(
        "insert into finance_handoff_batches(user_id,input_hash,manifest) values($1,$2,'{}')",
        [owner, "b".repeat(64)],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(other).not.toBe(owner);
  });

  it("backs up and audits before mutation, saves a private source, and permits unknown deposit dates", async () => {
    const owner = await newOwner();
    const data = workspace(owner);
    await bootstrap(data);
    const before = await read();
    const batch = await stage(owner, before.revision);
    const entry = transaction(owner, data.accounts[0].id);
    const observation = source(entry.id);
    const deposit = {
      id: crypto.randomUUID(),
      userId: owner,
      name: "Synthetic incomplete deposit",
      institution: "Imaginary Bank",
      maskedSuffix: "",
      principal: "50.00",
      openingDate: null,
      maturityDate: null,
      annualRate: null,
      maturityAmount: null,
      payoutMethod: "Unconfirmed",
      maturityInstruction: "unconfirmed",
      pledged: false,
      backingAccountId: null,
      payoutAccountId: null,
    };
    await db.query("select set_config('test.handoff.batch',$1,false)", [batch]);
    expect(
      await merge(
        batch,
        before.revision,
        { transactions: [entry], fixedDeposits: [deposit] },
        [observation],
      ),
    ).toMatchObject({ ok: true, writes: 2 });
    await db.query("select set_config('test.handoff.batch','',false)");
    const after = await read();
    expect(after.workspace.transactions).toHaveLength(1);
    expect(after.workspace.fixedDeposits[0]).toMatchObject({
      id: deposit.id,
      openingDate: null,
      maturityDate: null,
      annualRate: null,
      maturityAmount: null,
    });
    const backup = (
      await db.query<{ workspace: WorkspaceData; revision: number }>(
        "select workspace,revision from finance_handoff_backups where batch_id=$1",
        [batch],
      )
    ).rows[0];
    expect(String(backup.revision)).toBe(before.revision);
    expect(backup.workspace.transactions).toEqual([]);
    expect(backup.workspace.accounts).toEqual(before.workspace.accounts);
    expect(
      (
        await db.query(
          "select record_id,source_system,source_object_id,batch_id from finance_source_observations where source_object_id=$1",
          [observation.sourceObjectId],
        )
      ).rows[0],
    ).toEqual({
      record_id: entry.id,
      source_system: "notion",
      source_object_id: observation.sourceObjectId,
      batch_id: batch,
    });
    const audit = (
      await db.query<{
        before_value: unknown;
        after_value: { id: string; amount: string };
      }>(
        "select before_value,after_value from audit_events where entity_type='transactions' and entity_id=$1 and action='insert'",
        [entry.id],
      )
    ).rows[0];
    expect(audit.before_value).toBeNull();
    expect(audit.after_value).toMatchObject({ id: entry.id });
    await expect(
      db.query(
        "update finance_handoff_backups set workspace='{}' where batch_id=$1",
        [batch],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("merges a partial set without deleting existing transactions, accounts or sources", async () => {
    const owner = await newOwner();
    const data = workspace(owner);
    const existing = transaction(owner, data.accounts[0].id);
    data.transactions.push(existing);
    await bootstrap(data);
    const before = await read();
    const batch = await stage(owner, before.revision);
    const added = transaction(owner, data.accounts[0].id, {
      description: "Synthetic new expense",
    });
    expect(
      await merge(
        batch,
        before.revision,
        {
          transactions: [
            { ...existing, description: "Synthetic enriched purchase" },
            added,
          ],
        },
        [source(added.id)],
        { ...preview, counters: { ...preview.counters, needsConfirmation: 1 } },
      ),
    ).toMatchObject({ writes: 2 });
    const after = await read();
    expect(after.workspace.transactions.map((row) => row.id).sort()).toEqual(
      [existing.id, added.id].sort(),
    );
    expect(after.workspace.accounts).toEqual(before.workspace.accounts);
    expect(
      after.workspace.transactions.find((row) => row.id === existing.id)
        ?.description,
    ).toBe("Synthetic enriched purchase");
    expect(
      (
        await db.query(
          "select state from finance_handoff_batches where id=$1",
          [batch],
        )
      ).rows[0],
    ).toEqual({ state: "partial" });
  });

  it("reimports identical sources with no financial writes or financial audit/revision changes", async () => {
    const owner = await newOwner();
    const data = workspace(owner);
    await bootstrap(data);
    const before = await read();
    const batch = await stage(owner, before.revision);
    const entry = transaction(owner, data.accounts[0].id);
    const observation = source(entry.id);
    await merge(batch, before.revision, { transactions: [entry] }, [
      observation,
    ]);
    const saved = await read();
    const counted = await counts();
    expect(
      await merge(batch, saved.revision, {}, [observation], {
        ...preview,
        counters: { ...preview.counters, created: 0, matched: 1 },
      }),
    ).toMatchObject({ writes: 0, counters: { created: 0, matched: 1 } });
    const repeated = await read();
    const repeatedCounts = await counts();
    expect(repeated.workspace.transactions).toEqual(
      saved.workspace.transactions,
    );
    expect(repeated.revision).toBe(saved.revision);
    expect(repeatedCounts.transactions).toBe(counted.transactions);
    expect(repeatedCounts.transaction_audits).toBe(counted.transaction_audits);
    expect(repeatedCounts.sources).toBe(1);
  });

  it("rejects stale revision after another device edits and preserves both old and new records", async () => {
    const owner = await newOwner();
    const data = workspace(owner);
    await bootstrap(data);
    const desktop = await read();
    const batch = await stage(owner, desktop.revision);
    await db.query(
      "update accounts set name='Synthetic phone update' where id=$1",
      [data.accounts[0].id],
    );
    const phone = await read();
    const counted = await counts();
    await expect(
      merge(batch, desktop.revision, {
        transactions: [transaction(owner, data.accounts[0].id)],
      }),
    ).rejects.toMatchObject({ code: "40001" });
    expect((await read()).workspace.accounts[0].name).toBe(
      "Synthetic phone update",
    );
    expect(await counts()).toEqual(counted);
    expect(
      await merge(batch, phone.revision, {
        transactions: [transaction(owner, data.accounts[0].id)],
      }),
    ).toMatchObject({ writes: 1 });
  });

  it("keeps a source identity attached to the same record and rolls back remapping", async () => {
    const owner = await newOwner();
    const data = workspace(owner);
    const first = transaction(owner, data.accounts[0].id);
    const second = transaction(owner, data.accounts[0].id);
    data.transactions.push(first, second);
    await bootstrap(data);
    const before = await read();
    const batch = await stage(owner, before.revision);
    const observation = source(first.id);
    await merge(batch, before.revision, {}, [observation]);
    const saved = await read();
    const counted = await counts();
    await expect(
      merge(
        batch,
        saved.revision,
        { transactions: [{ ...second, description: "Attempted remap" }] },
        [{ ...observation, recordId: second.id }],
      ),
    ).rejects.toThrow(/Source identity/);
    expect((await read()).workspace.transactions).toEqual(
      saved.workspace.transactions,
    );
    expect(await counts()).toEqual(counted);
  });

  it("rejects direct source target remapping and a source linked to a nonexistent record", async () => {
    const owner = await newOwner();
    const data = workspace(owner);
    const first = transaction(owner, data.accounts[0].id);
    const second = transaction(owner, data.accounts[0].id);
    data.transactions.push(first, second);
    await bootstrap(data);
    const before = await read();
    const batch = await stage(owner, before.revision);
    const observation = source(first.id);
    await merge(batch, before.revision, {}, [observation]);
    await expect(
      db.query(
        "update finance_source_observations set record_id=$1 where source_object_id=$2",
        [second.id, observation.sourceObjectId],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        "insert into finance_source_observations(user_id,collection,record_id,source_system,source_object_id,evidence,confirmation_state,batch_id) values($1,'transactions',$2,'notion',$3,'{}','confirmed',$4)",
        [owner, crypto.randomUUID(), crypto.randomUUID(), batch],
      ),
    ).rejects.toThrow();
    expect(
      (
        await db.query(
          "select record_id from finance_source_observations where source_object_id=$1",
          [observation.sourceObjectId],
        )
      ).rows[0],
    ).toEqual({ record_id: first.id });
  });

  it("rolls back the whole batch on a foreign-owned change", async () => {
    const foreignOwner = await newOwner();
    const foreignData = workspace(foreignOwner);
    const foreignTransaction = transaction(
      foreignOwner,
      foreignData.accounts[0].id,
    );
    foreignData.transactions.push(foreignTransaction);
    await bootstrap(foreignData);
    const owner = await newOwner();
    const data = workspace(owner);
    await bootstrap(data);
    const before = await read();
    const batch = await stage(owner, before.revision);
    const counted = await counts();
    await expect(
      merge(batch, before.revision, {
        transactions: [
          transaction(owner, data.accounts[0].id),
          transaction(foreignOwner, foreignData.accounts[0].id),
        ],
      }),
    ).rejects.toMatchObject({ code: "42501" });
    expect((await read()).workspace.transactions).toEqual([]);
    expect((await read()).revision).toBe(before.revision);
    expect(await counts()).toEqual(counted);
    await expect(
      merge(batch, before.revision, {
        accounts: [
          {
            ...foreignData.accounts[0],
            userId: owner,
            name: "Attempted foreign overwrite",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      merge(
        batch,
        before.revision,
        {
          transactions: [transaction(owner, data.accounts[0].id)],
        },
        [source(foreignTransaction.id)],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await counts()).toEqual(counted);
    await asOwner(foreignOwner);
    expect((await read()).workspace.accounts[0].id).toBe(
      foreignData.accounts[0].id,
    );
    expect((await read()).workspace.accounts[0].name).toBe(
      foreignData.accounts[0].name,
    );
    expect((await read()).workspace.transactions).toHaveLength(1);
  });

  it("rolls back financial writes when a source refers to a missing target", async () => {
    const owner = await newOwner();
    const data = workspace(owner);
    await bootstrap(data);
    const before = await read();
    const batch = await stage(owner, before.revision);
    const counted = await counts();
    await expect(
      merge(
        batch,
        before.revision,
        { transactions: [transaction(owner, data.accounts[0].id)] },
        [source(crypto.randomUUID())],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect((await read()).workspace.transactions).toEqual([]);
    expect((await read()).revision).toBe(before.revision);
    expect(await counts()).toEqual(counted);
  });

  it("rolls back transactions, backups, audits and source rows on an invalid linked refund", async () => {
    const owner = await newOwner();
    const data = workspace(owner);
    await bootstrap(data);
    const before = await read();
    const batch = await stage(owner, before.revision);
    const counted = await counts();
    const purchase = transaction(owner, data.accounts[0].id);
    const refund = transaction(owner, data.accounts[0].id, {
      kind: "refund",
      fromAccountId: null,
      toAccountId: data.accounts[0].id,
      refundOfTransactionId: crypto.randomUUID(),
    });
    await expect(
      merge(batch, before.revision, { transactions: [purchase, refund] }, [
        source(purchase.id),
      ]),
    ).rejects.toThrow(/Refund must link/);
    expect((await read()).workspace.transactions).toEqual([]);
    expect((await read()).revision).toBe(before.revision);
    expect(await counts()).toEqual(counted);
    expect(
      (
        await db.query(
          "select state from finance_handoff_batches where id=$1",
          [batch],
        )
      ).rows[0],
    ).toEqual({ state: "staged" });
  });
});
