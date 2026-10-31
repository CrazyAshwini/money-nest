import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real checked-in SQL on an isolated database. Minimal Auth/Storage stand-ins
// do not certify hosted PostgREST serialization, applied migrations or JWTs.
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const mutable = [
  ["accounts", 1],
  ["account_snapshots", 6],
  ["transactions", 3],
  ["bills", 7],
  ["bill_payment_allocations", 8],
  ["fixed_deposits", 9],
  ["loans", 10],
  ["emis", 11],
  ["emi_payment_allocations", 12],
  ["expense_groups", 13],
  ["expense_shares", 14],
  ["settlements", 15],
  ["reminders", 16],
] as const;
type Table = (typeof mutable)[number][0];
let db: PGlite;
const id = (owner: string, n: number) =>
  `${owner.slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function session(
  owner: string | null,
  role: "authenticated" | "anon" = "authenticated",
) {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner ?? "",
  ]);
}
async function query<
  T extends Record<string, unknown> = Record<string, unknown>,
>(owner: string | null, sql: string, args: unknown[] = []) {
  await session(owner);
  return db.query<T>(sql, args);
}
async function token(table: Table, owner: string, recordId: string) {
  return (
    await query<{ token: string }>(
      owner,
      `select to_jsonb(r)->>'updated_at' as token from public.api_${table} r where id=$1`,
      [recordId],
    )
  ).rows[0].token;
}
async function rejected(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}
async function seed(owner: string) {
  const reference = (n: number) => id(owner, n);
  const rows: Array<[string, Record<string, unknown>]> = [
    ["accounts", { id: reference(1), name: "Synthetic bank", kind: "bank" }],
    [
      "accounts",
      { id: reference(2), name: "Synthetic card", kind: "credit_card" },
    ],
    [
      "transactions",
      {
        id: reference(3),
        amount: "100.00",
        kind: "expense",
        status: "posted",
        occurred_on: "2026-10-01",
        description: "Synthetic purchase",
        from_account_id: reference(1),
      },
    ],
    [
      "transactions",
      {
        id: reference(4),
        amount: "100.00",
        kind: "bill_payment",
        status: "posted",
        occurred_on: "2026-10-02",
        description: "Synthetic card repayment",
        from_account_id: reference(1),
        to_account_id: reference(2),
      },
    ],
    [
      "transactions",
      {
        id: reference(5),
        amount: "100.00",
        kind: "transfer",
        status: "posted",
        occurred_on: "2026-10-03",
        description: "Synthetic lender repayment",
        from_account_id: reference(1),
      },
    ],
    [
      "account_snapshots",
      {
        id: reference(6),
        account_id: reference(1),
        as_of: "2026-10-01T00:00:00Z",
        reported_balance: "1000.01",
        source: "user_report",
      },
    ],
    [
      "bills",
      {
        id: reference(7),
        account_id: reference(2),
        statement_amount: "100.00",
        statement_date: "2026-10-01",
        period_start: "2026-09-01",
        period_end: "2026-09-30",
      },
    ],
    [
      "bill_payment_allocations",
      {
        id: reference(8),
        bill_id: reference(7),
        transaction_id: reference(4),
        amount: "1.00",
        verified: true,
      },
    ],
    [
      "fixed_deposits",
      {
        id: reference(9),
        name: "Synthetic deposit",
        institution: "Synthetic institution",
        principal: "500.00",
        opening_date: "2026-10-01",
        maturity_date: "2027-10-01",
      },
    ],
    [
      "loans",
      {
        id: reference(10),
        name: "Synthetic loan",
        lender: "Synthetic lender",
        repayment_account_id: reference(1),
      },
    ],
    [
      "emis",
      {
        id: reference(11),
        loan_id: reference(10),
        number: 1,
        due_date: "2026-11-01",
        amount: "100.00",
      },
    ],
    [
      "emi_payment_allocations",
      {
        id: reference(12),
        emi_id: reference(11),
        transaction_id: reference(5),
        amount: "1.00",
      },
    ],
    [
      "expense_groups",
      {
        id: reference(13),
        title: "Synthetic group",
        occurred_on: "2026-10-01",
        total_cost: "100.00",
        paid_by: "You",
        transaction_id: reference(3),
      },
    ],
    [
      "expense_shares",
      {
        id: reference(14),
        group_id: reference(13),
        participant: "Synthetic friend",
        amount: "1.00",
      },
    ],
    [
      "settlements",
      {
        id: reference(15),
        group_id: reference(13),
        transaction_id: reference(5),
        counterparty: "Synthetic friend",
        direction: "outgoing",
        amount: "1.00",
      },
    ],
    [
      "reminders",
      {
        id: reference(16),
        title: "Synthetic reminder",
        trigger_at: "2026-11-01T00:00:00Z",
      },
    ],
  ];
  await session(owner);
  for (const [table, fields] of rows) {
    const row = {
      ...fields,
      user_id: owner,
      updated_at: "1900-01-01T00:00:00Z",
    };
    const keys = Object.keys(row);
    await db.query(
      `insert into public.${table}(${keys.join(",")}) values(${keys.map((_, index) => `$${index + 1}`).join(",")})`,
      Object.values(row),
    );
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
  `);
  await db.query("insert into auth.users values($1),($2)", [alice, bob]);
  const directory = join(process.cwd(), "supabase/migrations");
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(join(directory, name), "utf8"));
  await seed(alice);
  await seed(bob);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("server-owned workspace versions", () => {
  it.each(mutable)(
    "guards two writers and preserves exact token/financial values for %s",
    async (table, n) => {
      const recordId = id(alice, n);
      const before = (
        await query<{ value: Record<string, unknown> }>(
          alice,
          `select to_jsonb(r)-'updated_at' as value from public.api_${table} r where id=$1`,
          [recordId],
        )
      ).rows[0].value;
      const first = await token(table, alice, recordId);
      expect(first.startsWith("1900")).toBe(false); // clients cannot choose an INSERT version
      const changed = await query(
        alice,
        `update public.${table} set updated_at='1900-01-01' where id=$1 and updated_at=$2::timestamptz returning id`,
        [recordId, first],
      );
      expect(changed.rows).toHaveLength(1);
      const second = await token(table, alice, recordId);
      expect(
        (
          await query<{ newer: boolean }>(
            alice,
            "select $1::timestamptz>$2::timestamptz as newer",
            [second, first],
          )
        ).rows[0].newer,
      ).toBe(true);
      const stale = await query(
        alice,
        `update public.${table} set updated_at=now() where id=$1 and updated_at=$2::timestamptz returning id`,
        [recordId, first],
      );
      expect(stale.rows).toEqual([]);
      expect(await token(table, alice, recordId)).toBe(second);
      const fresh = await query(
        alice,
        `update public.${table} set updated_at=now() where id=$1 and updated_at=$2::timestamptz returning id`,
        [recordId, second],
      );
      expect(fresh.rows).toHaveLength(1);
      const after = (
        await query<{ value: Record<string, unknown> }>(
          alice,
          `select to_jsonb(r)-'updated_at' as value from public.api_${table} r where id=$1`,
          [recordId],
        )
      ).rows[0].value;
      expect(after).toEqual(before);
      expect(
        (
          await query(bob, `select * from public.api_${table} where id=$1`, [
            recordId,
          ])
        ).rows,
      ).toEqual([]);
    },
  );

  it("increments microseconds even when a stored version is ahead of the clock, including two writes in one transaction", async () => {
    await db.exec(
      "reset role; alter table public.accounts disable trigger zzz_finance_record_version",
    );
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query(
      "update public.accounts set updated_at='2099-01-01T00:00:00.123456Z' where id=$1",
      [id(alice, 1)],
    );
    await db.exec(
      "alter table public.accounts enable trigger zzz_finance_record_version",
    );
    await session(alice);
    await db.exec("begin");
    try {
      await db.query("update public.accounts set name=name where id=$1", [
        id(alice, 1),
      ]);
      await db.query("update public.accounts set name=name where id=$1", [
        id(alice, 1),
      ]);
      const result = await db.query<{ exact: boolean }>(
        "select updated_at='2099-01-01T00:00:00.123458Z'::timestamptz as exact from public.accounts where id=$1",
        [id(alice, 1)],
      );
      expect(result.rows[0].exact).toBe(true);
      const value = await db.query<{ token: string }>(
        "select to_jsonb(r)->>'updated_at' as token from public.api_accounts r where id=$1",
        [id(alice, 1)],
      );
      expect(value.rows[0].token).toContain(".123458");
      const roundTrip = await db.query<{ exact: boolean }>(
        "select updated_at=$2::timestamptz as exact from public.accounts where id=$1",
        [id(alice, 1), value.rows[0].token],
      );
      expect(roundTrip.rows[0].exact).toBe(true);
    } finally {
      await db.exec("rollback");
    }
  });

  it("keeps all editable views decimal-safe, invoker-scoped and versioned without an older stamping trigger running afterward", async () => {
    await db.exec("reset role");
    for (const [table] of mutable) {
      const column = await db.query<{ nullable: string; type: string }>(
        "select is_nullable as nullable,data_type as type from information_schema.columns where table_schema='public' and table_name=$1 and column_name='updated_at'",
        [table],
      );
      expect(column.rows).toEqual([
        { nullable: "NO", type: "timestamp with time zone" },
      ]);
      const view = await db.query<{ options: string[] }>(
        "select reloptions as options from pg_class where oid=$1::regclass",
        [`public.api_${table}`],
      );
      expect(view.rows[0].options).toContain("security_invoker=true");
      const triggers = await db.query<{ name: string }>(
        "select tgname as name from pg_trigger where tgrelid=$1::regclass and not tgisinternal and (tgtype&2)=2 and (tgtype&16)=16 order by tgname",
        [`public.${table}`],
      );
      expect(triggers.rows.at(-1)?.name).toBe("zzz_finance_record_version");
    }
    const exact = await query<{ amount: unknown }>(
      alice,
      "select amount from public.api_transactions where id=$1",
      [id(alice, 3)],
    );
    expect(exact.rows[0].amount).toBe("100.00");
  });

  it("stale deletes remove no rows while fresh tokens can delete the owned row", async () => {
    const recordId = id(alice, 14);
    const first = await token("expense_shares", alice, recordId);
    await query(
      alice,
      "update public.expense_shares set participant=participant where id=$1",
      [recordId],
    );
    const second = await token("expense_shares", alice, recordId);
    const stale = await query(
      alice,
      "delete from public.expense_shares where id=$1 and updated_at=$2::timestamptz returning id",
      [recordId, first],
    );
    expect(stale.rows).toEqual([]);
    const foreign = await query(
      bob,
      "delete from public.expense_shares where id=$1 and updated_at=$2::timestamptz returning id",
      [recordId, second],
    );
    expect(foreign.rows).toEqual([]);
    const fresh = await query(
      alice,
      "delete from public.expense_shares where id=$1 and updated_at=$2::timestamptz returning id",
      [recordId, second],
    );
    expect(fresh.rows).toEqual([{ id: recordId }]);
  });
});

describe("versioned allocation RPCs", () => {
  it.each([
    ["bill_payment_allocations", "allocate_bill_payment", 7, 4, 90],
    ["emi_payment_allocations", "allocate_emi_payment", 11, 5, 91],
  ] as const)(
    "creates only once and rejects stale, forged or relinked updates in %s",
    async (table, rpc, target, payment, n) => {
      const recordId = id(alice, n);
      const sql =
        rpc === "allocate_bill_payment"
          ? `select public.${rpc}($1,$2,$3,$4,true,$5::timestamptz) as id`
          : `select public.${rpc}($1,$2,$3,$4,$5::timestamptz) as id`;
      const createSql =
        rpc === "allocate_bill_payment"
          ? `select public.${rpc}($1,$2,$3,$4,true) as id`
          : `select public.${rpc}($1,$2,$3,$4) as id`;
      const args = [
        recordId,
        id(alice, target),
        id(alice, payment),
        "2.00",
        null,
      ];
      // A different payment avoids the existing target/payment unique pair.
      const freshPayment = id(alice, n + 20);
      await query(
        alice,
        "insert into public.transactions(id,user_id,amount,kind,status,occurred_on,description,from_account_id,to_account_id) values($1,$2,100,'bill_payment','posted','2026-10-04','Synthetic second payment',$3,$4)",
        [
          freshPayment,
          alice,
          id(alice, 1),
          rpc === "allocate_bill_payment" ? id(alice, 2) : null,
        ],
      );
      args[2] = freshPayment;
      expect((await query(alice, createSql, args.slice(0, 4))).rows).toEqual([
        { id: recordId },
      ]);
      const first = await token(table, alice, recordId);
      await rejected(query(alice, createSql, args.slice(0, 4)), "23505");
      await rejected(query(alice, sql, args), "23505");
      expect(await token(table, alice, recordId)).toBe(first);
      expect(
        (await query(alice, sql, [...args.slice(0, 3), "3.00", first])).rows,
      ).toEqual([{ id: recordId }]);
      const second = await token(table, alice, recordId);
      expect(second).not.toBe(first);
      await rejected(
        query(alice, sql, [...args.slice(0, 3), "4.00", first]),
        "40001",
      );
      await rejected(
        query(bob, sql, [...args.slice(0, 3), "4.00", second]),
        "40001",
      );
      await rejected(
        query(alice, sql, [
          recordId,
          id(alice, 999),
          freshPayment,
          "4.00",
          second,
        ]),
        "40001",
      );
      // A valid token cannot bypass the existing payment/target allocation caps.
      await rejected(
        query(alice, sql, [...args.slice(0, 3), "101.00", second]),
        "P0001",
      );
      const row = await query<{ amount: string; token: string }>(
        alice,
        `select amount::text as amount,to_jsonb(r)->>'updated_at' as token from public.${table} r where id=$1`,
        [recordId],
      );
      expect(row.rows).toEqual([{ amount: "3.00", token: second }]);
      await rejected(query(null, sql, args), "42501");
      await session(null, "anon");
      await rejected(db.query(sql, args), "42501");
    },
  );

  it("exposes only the replacement invoker signatures and retains creation defaults", async () => {
    await db.exec("reset role");
    const functions = await db.query<{
      name: string;
      count: number;
      defaults: number;
      definer: boolean;
      config: string[];
      anon: boolean;
    }>(
      "select p.proname as name,p.pronargs as count,p.pronargdefaults as defaults,p.prosecdef as definer,p.proconfig as config,has_function_privilege('anon',p.oid,'EXECUTE') as anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('allocate_bill_payment','allocate_emi_payment') order by p.proname",
    );
    expect(functions.rows).toEqual([
      {
        name: "allocate_bill_payment",
        count: 6,
        defaults: 2,
        definer: false,
        config: ['search_path=""'],
        anon: false,
      },
      {
        name: "allocate_emi_payment",
        count: 5,
        defaults: 1,
        definer: false,
        config: ['search_path=""'],
        anon: false,
      },
    ]);
  });
});
