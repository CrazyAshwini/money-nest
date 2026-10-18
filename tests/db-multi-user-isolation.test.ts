import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Execute the checked-in SQL rather than reimplementing its ownership policy in
// a mock. Auth/Storage schemas below are minimal Supabase stand-ins: this does
// not certify a hosted project's applied migrations, JWTs or Storage service.
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const newcomer = "33333333-3333-4333-8333-333333333333";
const tables = [
  "profiles",
  "categories",
  "accounts",
  "account_snapshots",
  "documents",
  "import_batches",
  "transactions",
  "bills",
  "bill_payment_allocations",
  "fixed_deposits",
  "loans",
  "emis",
  "emi_payment_allocations",
  "personal_loans",
  "personal_loan_allocations",
  "expense_groups",
  "expense_shares",
  "settlements",
  "import_candidates",
  "source_mappings",
  "reminders",
  "audit_events",
  "workspace_revisions",
  "commerce_state",
  "legacy_finance_audit_state",
  "finance_handoff_batches",
  "finance_source_observations",
  "finance_handoff_backups",
] as const;
type Table = (typeof tables)[number];
type Row = Record<string, unknown>;
const coreTables = tables.slice(0, 22);
const commerce = { orders: [], refunds: [], operations: [] };
let db: PGlite;
let originalBob: Record<string, Row[]>;

function id(owner: string, n: number) {
  return `${owner.slice(0, 8)}-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}
async function session(
  owner: string | null,
  role: "authenticated" | "anon" = "authenticated",
) {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner ?? "",
  ]);
}
async function query<T extends Row = Row>(
  owner: string | null,
  sql: string,
  params: unknown[] = [],
) {
  await session(owner);
  return db.query<T>(sql, params);
}
async function insert(table: Table, row: Row) {
  const keys = Object.keys(row);
  return db.query(
    `insert into public.${table} (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
    keys.map((key) =>
      typeof row[key] === "object" && row[key] !== null
        ? JSON.stringify(row[key])
        : row[key],
    ),
  );
}
async function rejected(promise: Promise<unknown>, codes = ["42501"]) {
  try {
    await promise;
    throw new Error("Expected database denial");
  } catch (error) {
    expect(codes).toContain((error as { code?: string }).code);
  }
}
function fixtures(owner: string): Partial<Record<Table, Row>> {
  const user_id = owner;
  return {
    profiles: {
      user_id,
      display_name: owner === alice ? "Synthetic Alice" : "Synthetic Bob",
    },
    categories: { id: id(owner, 1), user_id, name: "Synthetic category" },
    accounts: {
      id: id(owner, 2),
      user_id,
      name: "Synthetic bank",
      kind: "bank",
      opening_balance: "1000.10",
      opening_balance_date: "2026-10-01",
    },
    account_snapshots: {
      id: id(owner, 4),
      user_id,
      account_id: id(owner, 2),
      as_of: "2026-10-18T06:30:00Z",
      reported_balance: "999.99",
      source: "user_report",
    },
    documents: {
      id: id(owner, 5),
      user_id,
      secure_storage_path: `${owner}/synthetic.pdf`,
      file_name: "synthetic.pdf",
      file_hash: "a".repeat(64),
      mime_type: "application/pdf",
      byte_size: 100,
    },
    import_batches: {
      id: id(owner, 6),
      user_id,
      source: "synthetic",
      input_hash: "a".repeat(64),
      document_id: id(owner, 5),
    },
    transactions: {
      id: id(owner, 7),
      user_id,
      amount: "100.10",
      kind: "expense",
      status: "posted",
      occurred_on: "2026-10-18",
      description: "Synthetic owner purchase",
      from_account_id: id(owner, 2),
      category_id: id(owner, 1),
      receipt_document_id: id(owner, 5),
      import_batch_id: id(owner, 6),
    },
    bills: {
      id: id(owner, 8),
      user_id,
      account_id: id(owner, 3),
      statement_amount: "100.10",
      statement_date: "2026-10-01",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      due_date: "2026-10-20",
      document_id: id(owner, 5),
    },
    bill_payment_allocations: {
      id: id(owner, 10),
      user_id,
      bill_id: id(owner, 8),
      transaction_id: id(owner, 9),
      amount: "1.00",
      verified: true,
    },
    fixed_deposits: {
      id: id(owner, 11),
      user_id,
      name: "Synthetic deposit",
      institution: "Imaginary",
      principal: "500.25",
      opening_date: "2026-10-01",
      maturity_date: "2027-10-01",
      pledged: true,
      backing_account_id: id(owner, 3),
      payout_account_id: id(owner, 2),
      certificate_document_id: id(owner, 5),
    },
    loans: {
      id: id(owner, 12),
      user_id,
      name: "Synthetic loan",
      lender: "Imaginary",
      repayment_account_id: id(owner, 2),
      document_id: id(owner, 5),
    },
    emis: {
      id: id(owner, 13),
      user_id,
      loan_id: id(owner, 12),
      number: 1,
      due_date: "2026-11-01",
      amount: "100.00",
    },
    emi_payment_allocations: {
      id: id(owner, 15),
      user_id,
      emi_id: id(owner, 13),
      transaction_id: id(owner, 14),
      amount: "1.00",
    },
    personal_loans: {
      id: id(owner, 16),
      user_id,
      person: "Synthetic friend",
      direction: "lent",
      amount: "100.00",
      transaction_id: id(owner, 7),
    },
    personal_loan_allocations: {
      id: id(owner, 18),
      user_id,
      personal_loan_id: id(owner, 16),
      transaction_id: id(owner, 17),
      amount: "1.00",
    },
    expense_groups: {
      id: id(owner, 19),
      user_id,
      title: "Synthetic meal",
      occurred_on: "2026-10-18",
      total_cost: "100.10",
      paid_by: "You",
      transaction_id: id(owner, 7),
    },
    expense_shares: {
      id: id(owner, 20),
      user_id,
      group_id: id(owner, 19),
      participant: "Synthetic friend",
      amount: "1.00",
    },
    settlements: {
      id: id(owner, 21),
      user_id,
      group_id: id(owner, 19),
      transaction_id: id(owner, 17),
      counterparty: "Synthetic friend",
      direction: "incoming",
      amount: "1.00",
    },
    import_candidates: {
      id: id(owner, 22),
      user_id,
      import_batch_id: id(owner, 6),
      parsed_values: { amount: "100.10" },
      matched_transaction_id: id(owner, 7),
    },
    source_mappings: {
      id: id(owner, 23),
      user_id,
      source_system: "synthetic",
      source_object_id: "row-1",
      entity_type: "transactions",
      local_record_id: id(owner, 7),
      import_batch_id: id(owner, 6),
    },
    reminders: {
      id: id(owner, 24),
      user_id,
      title: "Synthetic bill reminder",
      bill_id: id(owner, 8),
      trigger_at: "2026-10-19T06:30:00Z",
    },
    commerce_state: { user_id, data: commerce },
    legacy_finance_audit_state: {
      user_id,
      data: [
        {
          id: id(owner, 25),
          userId: owner,
          entityType: "transactions",
          entityId: id(owner, 7),
          action: "import",
          occurredAt: "2026-10-01T06:30:00Z",
        },
      ],
    },
    finance_handoff_batches: {
      id: id(owner, 26),
      user_id,
      input_hash: "a".repeat(64),
      manifest: {},
    },
    finance_source_observations: {
      id: id(owner, 27),
      user_id,
      collection: "transactions",
      record_id: id(owner, 7),
      source_system: "synthetic",
      source_object_id: "row-1",
      evidence: {},
      confirmation_state: "confirmed",
      batch_id: id(owner, 26),
    },
    finance_handoff_backups: {
      id: id(owner, 28),
      user_id,
      batch_id: id(owner, 26),
      revision: 0,
      workspace: { synthetic: true },
      commerce,
    },
  };
}
async function snapshot(owner: string) {
  const state: Record<string, Row[]> = {};
  for (const table of tables) {
    state[table] = (
      await query(
        owner,
        `select to_jsonb(r) as value from public.${table} r where user_id=$1 order by to_jsonb(r)::text`,
        [owner],
      )
    ).rows;
  }
  return state;
}
function emptyWorkspace() {
  return Object.fromEntries(
    [
      "accounts",
      "snapshots",
      "transactions",
      "bills",
      "allocations",
      "fixedDeposits",
      "loans",
      "emis",
      "emiAllocations",
      "groups",
      "shares",
      "settlements",
      "reminders",
      "auditEvents",
    ].map((name) => [name, []]),
  ) as Record<string, Row[]>;
}
async function revision(owner: string) {
  return (
    (
      await query<{ revision: string }>(
        owner,
        "select revision::text as revision from public.workspace_revisions where user_id=$1",
        [owner],
      )
    ).rows[0]?.revision ?? "0"
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
  `);
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    alice,
    bob,
    newcomer,
  ]);
  const directory = join(process.cwd(), "supabase/migrations");
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(directory, name), "utf8"));
  }
  for (const owner of [alice, bob]) {
    await session(owner);
    const rows = fixtures(owner);
    for (const table of tables) {
      if (table === "accounts") {
        await insert(table, rows[table]!);
        await insert(table, {
          id: id(owner, 3),
          user_id: owner,
          name: "Synthetic card",
          kind: "credit_card",
          credit_limit: "1000.00",
        });
      } else if (table === "transactions") {
        await insert(table, rows[table]!);
        for (const [n, kind, from, to] of [
          [9, "bill_payment", id(owner, 2), id(owner, 3)],
          [14, "bill_payment", id(owner, 2), null],
          [17, "transfer", null, id(owner, 2)],
        ] as const) {
          await insert(table, {
            id: id(owner, n),
            user_id: owner,
            amount: "100.00",
            kind,
            status: "posted",
            occurred_on: "2026-10-18",
            description: "Synthetic payment",
            from_account_id: from,
            to_account_id: to,
          });
        }
      } else if (rows[table]) await insert(table, rows[table]!);
    }
    await db.query(
      "insert into storage.objects(bucket_id,name) values('finance-documents',$1)",
      [`${owner}/synthetic.pdf`],
    );
  }
  originalBob = await snapshot(bob);
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("all checked-in migrations with separate authenticated workspaces", () => {
  it("covers every public table and view, enables RLS and grants no anonymous public access", async () => {
    await db.exec("reset role");
    const catalog = await db.query<{ name: string; rls: boolean }>(
      "select c.relname as name,c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname",
    );
    expect(catalog.rows.map((row) => row.name)).toEqual([...tables].sort());
    expect(catalog.rows.every((row) => row.rls)).toBe(true);
    const views = await db.query<{ name: string; reloptions: string[] }>(
      "select c.relname as name,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' order by c.relname",
    );
    expect(views.rows.map((row) => row.name)).toEqual(
      coreTables.map((name) => `api_${name}`).sort(),
    );
    expect(
      views.rows.every((row) =>
        row.reloptions.includes("security_invoker=true"),
      ),
    ).toBe(true);
    const exposed = await db.query(
      "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v') and (has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE') or has_table_privilege('anon',c.oid,'DELETE'))",
    );
    expect(exposed.rows).toEqual([]);
    const policies = await db.query<{
      tablename: string;
      policyname: string;
      roles: string[];
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }>(
      "select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public'",
    );
    for (const table of tables) {
      const owned = policies.rows.filter((row) => row.tablename === table);
      expect(
        owned.some((row) => row.cmd === "SELECT"),
        table,
      ).toBe(true);
      for (const policy of owned) {
        expect(policy.policyname).toBe(`owned_${policy.cmd.toLowerCase()}`);
        expect(policy.roles).toEqual(["authenticated"]);
        for (const predicate of [policy.qual, policy.with_check].filter(
          (value) => value !== null,
        )) {
          expect(predicate).toContain("auth.uid()");
          expect(predicate).toContain("user_id");
        }
        if (["SELECT", "UPDATE", "DELETE"].includes(policy.cmd))
          expect(policy.qual).not.toBeNull();
        if (["INSERT", "UPDATE"].includes(policy.cmd))
          expect(policy.with_check).not.toBeNull();
      }
    }
  });

  it("keeps RPCs caller-scoped and the sole privileged audit trigger inaccessible", async () => {
    await db.exec("reset role");
    const functions = await db.query<{
      name: string;
      definer: boolean;
      config: string[];
      anon: boolean;
      authenticated: boolean;
    }>(
      "select p.proname as name,p.prosecdef as definer,p.proconfig as config,has_function_privilege('anon',p.oid,'EXECUTE') as anon,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.proname",
    );
    expect(functions.rows.map((row) => row.name)).toEqual([
      "allocate_bill_payment",
      "allocate_emi_payment",
      "bootstrap_finance_cloud",
      "commit_finance_commerce",
      "commit_reviewed_import",
      "merge_finance_handoff",
      "merge_private_profile_cloud",
      "read_finance_cloud_state",
    ]);
    for (const row of functions.rows) {
      expect(row.definer, row.name).toBe(false);
      expect(row.config, row.name).toContain('search_path=""');
      expect(row.anon, row.name).toBe(false);
      expect(row.authenticated, row.name).toBe(true);
    }
    const privileged = await db.query<{
      name: string;
      config: string[];
      callable: boolean;
    }>(
      "select p.proname as name,p.proconfig as config,has_function_privilege('authenticated',p.oid,'EXECUTE') as callable from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prosecdef",
    );
    expect(privileged.rows).toEqual([
      { name: "audit_change", config: ['search_path=""'], callable: false },
    ]);
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_schema_privilege('authenticated','private','USAGE') as allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  });

  it.each(tables)(
    "isolates %s for reads, writes, owner forgery and anonymous sessions",
    async (table) => {
      for (const [owner, victim] of [
        [alice, bob],
        [bob, alice],
      ]) {
        const own = await query(
          owner,
          `select * from public.${table} where user_id=$1`,
          [owner],
        );
        expect(own.rows.length, `${table} positive own read`).toBeGreaterThan(
          0,
        );
        expect(
          (
            await query(
              owner,
              `select * from public.${table} where user_id=$1`,
              [victim],
            )
          ).rows,
        ).toEqual([]);
        for (const operation of [
          `update public.${table} set user_id=user_id where user_id=$1 returning user_id`,
          `delete from public.${table} where user_id=$1 returning user_id`,
        ]) {
          try {
            expect((await query(owner, operation, [victim])).rows).toEqual([]);
          } catch (error) {
            expect((error as { code?: string }).code).toBe("42501");
          }
        }
        // A valid row taken from the owner's readable record is relabelled as the
        // victim. Owner-aware BEFORE triggers can reject linked rows before
        // RLS's WITH CHECK; neither path may accept the forged record.
        await session(owner);
        await rejected(insert(table, { ...own.rows[0], user_id: victim }), [
          "42501",
          "P0001",
          "P0002",
        ]);
      }
      expect((await query(null, `select * from public.${table}`)).rows).toEqual(
        [],
      );
      await session(null, "anon");
      await rejected(db.query(`select * from public.${table}`));
    },
  );

  it.each(coreTables)(
    "applies owner RLS through api_%s, including aggregates",
    async (table) => {
      for (const [owner, victim] of [
        [alice, bob],
        [bob, alice],
      ]) {
        const rows = await query(
          owner,
          `select user_id from public.api_${table}`,
        );
        expect(rows.rows.length).toBeGreaterThan(0);
        expect(rows.rows.every((row) => row.user_id === owner)).toBe(true);
        expect(
          (
            await query<{ total: number }>(
              owner,
              `select count(*)::int as total from public.api_${table} where user_id=$1`,
              [victim],
            )
          ).rows[0].total,
        ).toBe(0);
      }
      await session(null, "anon");
      await rejected(db.query(`select * from public.api_${table}`));
    },
  );

  it("prevents ID-collision upserts, owner reassignment and forged audit history", async () => {
    await rejected(
      query(
        alice,
        "insert into public.accounts(id,user_id,name,kind) values($1,$2,'Forged','bank') on conflict(id) do update set name=excluded.name",
        [id(bob, 2), alice],
      ),
    );
    await rejected(
      query(alice, "update public.accounts set user_id=$1 where id=$2", [
        bob,
        id(alice, 2),
      ]),
    );
    await rejected(
      query(
        alice,
        "insert into public.audit_events(user_id,entity_type,entity_id,action,description) values($1,'accounts',$2,'forged','Forged history')",
        [bob, id(bob, 2)],
      ),
    );
    expect(
      (
        await query(
          alice,
          "select opening_balance::text as balance from public.accounts where id=$1",
          [id(alice, 2)],
        )
      ).rows[0].balance,
    ).toBe("1000.10");
  });
});

const crossOwnerLinks: [Table, string, number, Row?][] = [
  ["categories", "parent_id", 1],
  ["account_snapshots", "account_id", 2],
  ["import_batches", "document_id", 5],
  ["transactions", "from_account_id", 2],
  ["transactions", "to_account_id", 2],
  ["transactions", "category_id", 1],
  ["transactions", "receipt_document_id", 5],
  ["transactions", "import_batch_id", 6],
  [
    "transactions",
    "refund_of_transaction_id",
    7,
    { kind: "refund", from_account_id: null, to_account_id: id(alice, 2) },
  ],
  ["transactions", "from_balance_snapshot_id", 4],
  ["bills", "account_id", 3],
  ["bills", "document_id", 5],
  ["bill_payment_allocations", "bill_id", 8],
  ["bill_payment_allocations", "transaction_id", 9],
  ["fixed_deposits", "backing_account_id", 3],
  ["fixed_deposits", "payout_account_id", 2],
  ["fixed_deposits", "certificate_document_id", 5],
  ["loans", "repayment_account_id", 2],
  ["loans", "document_id", 5],
  ["emis", "loan_id", 12],
  ["emi_payment_allocations", "emi_id", 13],
  ["emi_payment_allocations", "transaction_id", 14],
  ["personal_loans", "transaction_id", 7],
  ["personal_loan_allocations", "personal_loan_id", 16],
  ["personal_loan_allocations", "transaction_id", 17],
  ["expense_groups", "transaction_id", 7],
  ["expense_shares", "group_id", 19],
  ["settlements", "group_id", 19],
  ["settlements", "transaction_id", 17],
  ["import_candidates", "import_batch_id", 6],
  ["import_candidates", "matched_transaction_id", 7],
  ["source_mappings", "local_record_id", 7],
  ["source_mappings", "import_batch_id", 6],
  ["reminders", "bill_id", 8],
  ["reminders", "emi_id", 13, { bill_id: null }],
  ["finance_source_observations", "record_id", 7],
  ["finance_source_observations", "batch_id", 26],
  ["finance_handoff_backups", "batch_id", 26],
];
describe("cross-owner references rejected by actual constraints and triggers", () => {
  it.each(crossOwnerLinks)(
    "rejects %s.%s referencing Bob's record",
    async (table, column, n, overrides) => {
      const row = {
        ...fixtures(alice)[table]!,
        ...overrides,
        id: crypto.randomUUID(),
        [column]: id(bob, n),
      };
      // Avoid unrelated uniqueness failures so this probes the foreign link.
      if (table === "categories") row.name = crypto.randomUUID();
      if (table === "import_batches") row.input_hash = "b".repeat(64);
      if (
        table === "source_mappings" ||
        table === "finance_source_observations"
      )
        row.source_object_id = crypto.randomUUID();
      if (table === "emis") row.number = 2;
      await session(alice);
      await rejected(insert(table, row), [
        "23503",
        "23514",
        "42501",
        "P0001",
        "P0002",
      ]);
    },
  );
  it("rejects a document path using another user's UUID", async () => {
    await session(alice);
    await rejected(
      insert("documents", {
        ...fixtures(alice).documents!,
        id: crypto.randomUUID(),
        secure_storage_path: `${bob}/forged.pdf`,
        file_hash: "c".repeat(64),
      }),
      ["23514"],
    );
  });
});

describe("owner-scoped RPCs, imports and private files", () => {
  it.each([
    ["read_finance_cloud_state", "select public.read_finance_cloud_state()"],
    [
      "allocate_bill_payment",
      `select public.allocate_bill_payment('${id(alice, 10)}','${id(alice, 8)}','${id(alice, 9)}',1,true)`,
    ],
    [
      "allocate_emi_payment",
      `select public.allocate_emi_payment('${id(alice, 15)}','${id(alice, 13)}','${id(alice, 14)}',1)`,
    ],
    [
      "commit_reviewed_import",
      `select public.commit_reviewed_import('${"a".repeat(64)}','synthetic.csv','[]'::jsonb)`,
    ],
    [
      "commit_finance_commerce",
      `select public.commit_finance_commerce(0,'[]'::jsonb,'${JSON.stringify(commerce)}'::jsonb)`,
    ],
    [
      "bootstrap_finance_cloud",
      `select public.bootstrap_finance_cloud('{}'::jsonb,'${JSON.stringify(commerce)}'::jsonb)`,
    ],
    [
      "merge_private_profile_cloud",
      `select public.merge_private_profile_cloud('{}'::jsonb,'${JSON.stringify(commerce)}'::jsonb,0)`,
    ],
    [
      "merge_finance_handoff",
      `select public.merge_finance_handoff('${id(alice, 26)}',0,'{}'::jsonb,'[]'::jsonb,'{}'::jsonb)`,
    ],
  ])(
    "rejects an authenticated role without a user claim in %s",
    async (_name, sql) => {
      await rejected(query(null, sql));
    },
  );

  it("reads only the caller's complete workspace and exact decimal aggregate", async () => {
    for (const owner of [alice, bob]) {
      const state = (
        await query<{ result: { workspace: Record<string, Row[]> } }>(
          owner,
          "select public.read_finance_cloud_state() as result",
        )
      ).rows[0].result;
      for (const rows of Object.values(state.workspace))
        expect(rows.every((row) => row.userId === owner)).toBe(true);
      expect(
        (
          await query<{ amount: string }>(
            owner,
            "select sum(amount::numeric)::text as amount from public.api_transactions where kind='expense' and status='posted'",
          )
        ).rows[0].amount,
      ).toBe("100.10");
    }
    await rejected(query(null, "select public.read_finance_cloud_state()"));
  });

  it("rejects foreign allocation IDs and payment targets through both allocation RPCs", async () => {
    for (const args of [
      [id(bob, 10), id(alice, 8), id(alice, 9)],
      [crypto.randomUUID(), id(bob, 8), id(alice, 9)],
      [crypto.randomUUID(), id(alice, 8), id(bob, 9)],
    ]) {
      await rejected(
        query(
          alice,
          "select public.allocate_bill_payment($1,$2,$3,1,true)",
          args,
        ),
        ["42501", "P0001"],
      );
    }
    for (const args of [
      [id(bob, 15), id(alice, 13), id(alice, 14)],
      [crypto.randomUUID(), id(bob, 13), id(alice, 14)],
      [crypto.randomUUID(), id(alice, 13), id(bob, 14)],
    ]) {
      await rejected(
        query(alice, "select public.allocate_emi_payment($1,$2,$3,1)", args),
        ["42501", "P0001"],
      );
    }
  });

  it("scopes identical import hashes and source identities independently and retries safely", async () => {
    const hash = "d".repeat(64);
    const batches: string[] = [];
    for (const owner of [alice, bob]) {
      const txn = {
        id: id(owner, 100),
        amount: "0.10",
        kind: "expense",
        status: "posted",
        occurredOn: "2026-10-18",
        description: "Synthetic CSV",
        fromAccountId: id(owner, 2),
        sourceObjectId: "same-source-row",
      };
      const params = [hash, "synthetic.csv", JSON.stringify([txn])];
      const saved = await query<{
        result: { batchId: string; count: number; alreadyCommitted: boolean };
      }>(
        owner,
        "select public.commit_reviewed_import($1,$2,$3::jsonb) as result",
        params,
      );
      expect(saved.rows[0].result).toMatchObject({
        count: 1,
        alreadyCommitted: false,
      });
      batches.push(saved.rows[0].result.batchId);
      expect(
        (
          await query<{ result: { count: number; alreadyCommitted: boolean } }>(
            owner,
            "select public.commit_reviewed_import($1,$2,$3::jsonb) as result",
            params,
          )
        ).rows[0].result,
      ).toMatchObject({ count: 0, alreadyCommitted: true });
    }
    expect(new Set(batches).size).toBe(2);
    // This test intentionally created Bob's own row. Preserve it in the later
    // untouched-workspace assertion; every hostile attempt must be read-only.
    originalBob = await snapshot(bob);
    const before = await snapshot(alice);
    const bad = [
      {
        id: id(alice, 101),
        amount: "0.10",
        kind: "expense",
        status: "posted",
        occurredOn: "2026-10-18",
        description: "Must roll back",
        fromAccountId: id(alice, 2),
        sourceObjectId: "valid-first",
      },
      {
        id: id(alice, 102),
        amount: "0.10",
        kind: "expense",
        status: "posted",
        occurredOn: "2026-10-18",
        description: "Foreign bank",
        fromAccountId: id(bob, 2),
        sourceObjectId: "foreign-last",
      },
    ];
    await rejected(
      query(
        alice,
        "select public.commit_reviewed_import($1,'invalid.csv',$2::jsonb)",
        ["e".repeat(64), JSON.stringify(bad)],
      ),
      ["23503"],
    );
    expect(await snapshot(alice)).toEqual(before);
  });

  it("rejects forged commerce owners, ID collisions and nested foreign ledger/account links atomically", async () => {
    const before = await snapshot(alice);
    const item = {
      id: id(alice, 7),
      user_id: alice,
      amount: "100.10",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurred_on: "2026-10-18",
      description: "Synthetic owner purchase",
      from_account_id: id(alice, 2),
    };
    for (const forged of [
      { ...item, user_id: bob },
      { ...item, id: id(bob, 7) },
    ]) {
      await rejected(
        query(
          alice,
          "select public.commit_finance_commerce($1,$2::jsonb,$3::jsonb)",
          [
            await revision(alice),
            JSON.stringify([forged]),
            JSON.stringify(commerce),
          ],
        ),
      );
    }
    const order = {
      id: id(alice, 110),
      userId: alice,
      currency: "INR",
      reviewStatus: "saved",
      payments: [{ transactionId: id(bob, 7), amount: "100.10" }],
    };
    const refund = {
      id: id(alice, 111),
      userId: alice,
      expectedAmount: "1.00",
      destinationAccountId: id(bob, 2),
      creditMatches: [],
    };
    for (const state of [
      { ...commerce, orders: [order] },
      { ...commerce, refunds: [refund] },
    ]) {
      await rejected(
        query(
          alice,
          "select public.commit_finance_commerce($1,'[]'::jsonb,$2::jsonb)",
          [await revision(alice), JSON.stringify(state)],
        ),
        ["P0001"],
      );
    }
    expect(await snapshot(alice)).toEqual(before);
  });

  it("cannot merge foreign handoffs or overwrite another user's ID through a reviewed merge", async () => {
    const before = await snapshot(alice);
    await rejected(
      query(
        alice,
        "select public.merge_finance_handoff($1,$2,'{}'::jsonb,'[]'::jsonb,'{}'::jsonb)",
        [id(bob, 26), await revision(alice)],
      ),
    );
    const changes = {
      accounts: [
        {
          id: id(bob, 2),
          userId: alice,
          name: "Forged overwrite",
          kind: "bank",
        },
      ],
    };
    await rejected(
      query(
        alice,
        "select public.merge_finance_handoff($1,$2,$3::jsonb,'[]'::jsonb,'{}'::jsonb)",
        [id(alice, 26), await revision(alice), JSON.stringify(changes)],
      ),
    );
    expect(await snapshot(alice)).toEqual(before);
  });

  it("keeps an additive profile merge from inserting a foreign ID or forged owner", async () => {
    const before = await snapshot(alice);
    const workspace = emptyWorkspace();
    workspace.accounts = [
      { id: id(bob, 2), userId: alice, name: "Forged ID", kind: "bank" },
    ];
    const result = await query<{ result: { totalAdded: number } }>(
      alice,
      "select public.merge_private_profile_cloud($1::jsonb,$2::jsonb,$3) as result",
      [
        JSON.stringify(workspace),
        JSON.stringify(commerce),
        await revision(alice),
      ],
    );
    expect(result.rows[0].result.totalAdded).toBe(0);
    // INSERT ON CONFLICT DO NOTHING may advance Alice's own revision; Bob's
    // record cannot be read or overwritten and Alice receives no foreign row.
    expect(
      (
        await query(alice, "select id from public.accounts where id=$1", [
          id(bob, 2),
        ])
      ).rows,
    ).toEqual([]);
    workspace.accounts = [
      { id: id(bob, 2), userId: bob, name: "Forged owner", kind: "bank" },
    ];
    await rejected(
      query(
        alice,
        "select public.merge_private_profile_cloud($1::jsonb,$2::jsonb,$3)",
        [
          JSON.stringify(workspace),
          JSON.stringify(commerce),
          await revision(alice),
        ],
      ),
    );
    const after = await snapshot(alice);
    expect({ ...after, workspace_revisions: [] }).toEqual({
      ...before,
      workspace_revisions: [],
    });
  });

  it("bootstraps an empty new user without copying existing records and rejects import collisions", async () => {
    const workspace = emptyWorkspace();
    workspace.accounts = [
      { id: id(bob, 2), userId: newcomer, name: "Foreign ID", kind: "bank" },
    ];
    await rejected(
      query(
        newcomer,
        "select public.bootstrap_finance_cloud($1::jsonb,$2::jsonb,$3)",
        [JSON.stringify(workspace), JSON.stringify(commerce), "f".repeat(64)],
      ),
      ["23505"],
    );
    workspace.accounts[0].userId = bob;
    await rejected(
      query(
        newcomer,
        "select public.bootstrap_finance_cloud($1::jsonb,$2::jsonb,$3)",
        [JSON.stringify(workspace), JSON.stringify(commerce), "f".repeat(64)],
      ),
    );
    const saved = await query<{ result: { imported: boolean } }>(
      newcomer,
      "select public.bootstrap_finance_cloud($1::jsonb,$2::jsonb,$3) as result",
      [
        JSON.stringify(emptyWorkspace()),
        JSON.stringify(commerce),
        "f".repeat(64),
      ],
    );
    expect(saved.rows[0].result.imported).toBe(true);
    const state = (
      await query<{ result: { workspace: Record<string, Row[]> } }>(
        newcomer,
        "select public.read_finance_cloud_state() as result",
      )
    ).rows[0].result;
    expect(
      Object.entries(state.workspace).every(
        ([collection, rows]) =>
          collection === "auditEvents" || rows.length === 0,
      ),
    ).toBe(true);
    // Initializing private commerce creates a server-generated audit event;
    // that event belongs to this new user and contains no existing ledger.
    expect(
      state.workspace.auditEvents.every((row) => row.userId === newcomer),
    ).toBe(true);
  });

  it("restricts list, read, write, rename and delete to the caller's private storage folder", async () => {
    await db.exec("reset role");
    expect(
      (
        await db.query<{ public: boolean }>(
          "select public from storage.buckets where id='finance-documents'",
        )
      ).rows[0].public,
    ).toBe(false);
    for (const [owner, victim] of [
      [alice, bob],
      [bob, alice],
    ]) {
      const ownPath = `${owner}/synthetic.pdf`;
      const victimPath = `${victim}/synthetic.pdf`;
      const rows = await query(owner, "select name from storage.objects");
      expect(rows.rows).toEqual([{ name: ownPath }]);
      expect(
        (
          await query(owner, "select name from storage.objects where name=$1", [
            victimPath,
          ])
        ).rows,
      ).toEqual([]);
      expect(
        (
          await query(
            owner,
            "update storage.objects set name=name where name=$1 returning name",
            [victimPath],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await query(
            owner,
            "delete from storage.objects where name=$1 returning name",
            [victimPath],
          )
        ).rows,
      ).toEqual([]);
      await rejected(
        query(
          owner,
          "insert into storage.objects(bucket_id,name) values('finance-documents',$1)",
          [`${victim}/forged.pdf`],
        ),
      );
      await rejected(
        query(owner, "update storage.objects set name=$1 where name=$2", [
          `${victim}/renamed.pdf`,
          ownPath,
        ]),
      );
      await rejected(
        query(
          owner,
          "update storage.objects set bucket_id='public' where name=$1",
          [ownPath],
        ),
      );
      const tempPath = `${owner}/temporary.pdf`;
      expect(
        (
          await query(
            owner,
            "insert into storage.objects(bucket_id,name) values('finance-documents',$1) returning name",
            [tempPath],
          )
        ).rows,
      ).toEqual([{ name: tempPath }]);
      expect(
        (
          await query(
            owner,
            "update storage.objects set name=$1 where name=$2 returning name",
            [`${owner}/renamed.pdf`, tempPath],
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await query(
            owner,
            "delete from storage.objects where name=$1 returning name",
            [`${owner}/renamed.pdf`],
          )
        ).rows,
      ).toHaveLength(1);
    }
    await session(null, "anon");
    expect((await db.query("select * from storage.objects")).rows).toEqual([]);
    await rejected(
      db.query(
        "insert into storage.objects(bucket_id,name) values('finance-documents',$1)",
        [`${alice}/anonymous.pdf`],
      ),
    );
  });

  it("preserves every existing Bob record and exact financial values after hostile attempts", async () => {
    expect(await snapshot(bob)).toEqual(originalBob);
    expect(
      (
        await query(
          bob,
          "select amount from public.api_transactions where id=$1",
          [id(bob, 7)],
        )
      ).rows,
    ).toEqual([{ amount: "100.10" }]);
    expect(
      (
        await query(
          bob,
          "select opening_balance from public.api_accounts where id=$1",
          [id(bob, 2)],
        )
      ).rows,
    ).toEqual([{ opening_balance: "1000.10" }]);
  });
});
