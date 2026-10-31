import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Actual checked-in migrations on isolated PostgreSQL, with synthetic JWT claims.
// PGlite serializes one connection; this checks the atomic statement and bursts,
// while live multi-instance PostgREST contention remains a deployment check.
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
type Result = { allowed: boolean; retryAfter: number };
let db: PGlite;

async function session(owner: string | null, anonymous = false, role = "authenticated") {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [
    owner ?? "", JSON.stringify({ sub: owner, is_anonymous: anonymous }),
  ]);
}
async function consume(bucket: string) {
  return (await db.query<{ result: Result }>(
    "select public.consume_finance_rate_limit($1) as result", [bucket],
  )).rows[0].result;
}
async function denied(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid(),auth.jwt() to authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
  `);
  await db.query("insert into auth.users(id) values($1),($2)", [alice,bob]);
  const directory = join(process.cwd(), "supabase/migrations");
  for (const file of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort())
    await db.exec(readFileSync(join(directory, file), "utf8"));
}, 60000);
beforeEach(async () => {
  await db.exec("reset role; truncate private.finance_rate_limit_windows");
  await session(alice);
});
afterAll(async () => { await db?.close(); });

describe("shared server-defined finance quotas", () => {
  it.each([["receipt",10],["bot",20],["orders",10],["documents",20]] as const)(
    "limits the %s bucket to %i requests per window", async (bucket, quota) => {
      for (let n = 0; n < quota; n++) expect(await consume(bucket)).toEqual({ allowed: true, retryAfter: 0 });
      const blocked = await consume(bucket);
      expect(blocked.allowed).toBe(false);
      expect(Number.isInteger(blocked.retryAfter)).toBe(true);
      expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
      expect(blocked.retryAfter).toBeLessThanOrEqual(60);
    },
  );

  it("refills after the server's window expires without allowing callers to choose the clock", async () => {
    for (let n = 0; n < 11; n++) await consume("receipt");
    await db.exec("reset role");
    await db.query("update private.finance_rate_limit_windows set window_started_at=clock_timestamp()-interval '61 seconds' where user_id=$1 and bucket='receipt'", [alice]);
    await session(alice);
    expect(await consume("receipt")).toEqual({ allowed: true, retryAfter: 0 });
    await db.exec("reset role");
    expect((await db.query<{ request_count: number }>("select request_count from private.finance_rate_limit_windows")).rows).toEqual([{request_count:1}]);
  });

  it("isolates users and buckets even after one allowance is exhausted", async () => {
    for (let n = 0; n < 11; n++) await consume("receipt");
    expect((await consume("receipt")).allowed).toBe(false);
    expect(await consume("orders")).toEqual({ allowed: true, retryAfter: 0 });
    await session(bob);
    expect(await consume("receipt")).toEqual({ allowed: true, retryAfter: 0 });
    await session(alice);
    expect((await consume("receipt")).allowed).toBe(false);
  });

  it("accepts only ten requests in an overlapping burst and caps denied counters", async () => {
    const results = await Promise.all(Array.from({length:50}, () => consume("receipt")));
    expect(results.filter((result) => result.allowed)).toHaveLength(10);
    expect(results.filter((result) => !result.allowed)).toHaveLength(40);
    await db.exec("reset role");
    expect((await db.query<{ request_count: number }>("select request_count from private.finance_rate_limit_windows")).rows).toEqual([{request_count:11}]);
  });

  it("does not slide the fixed window forward when requests are denied", async () => {
    for (let n = 0; n < 10; n++) await consume("receipt");
    await db.exec("reset role");
    const before = (await db.query<{ started: string }>(
      "select window_started_at::text as started from private.finance_rate_limit_windows",
    )).rows[0].started;
    await session(alice);
    for (let n = 0; n < 5; n++) expect((await consume("receipt")).allowed).toBe(false);
    await db.exec("reset role");
    expect((await db.query<{ started: string }>(
      "select window_started_at::text as started from private.finance_rate_limit_windows",
    )).rows[0].started).toBe(before);
  });

  it("rejects unknown buckets before creating internal state", async () => {
    await denied(consume("unlimited"),"22023");
    await db.exec("reset role");
    expect((await db.query("select * from private.finance_rate_limit_windows")).rows).toEqual([]);
  });

  it("rejects signed-out, anonymous-role and anonymous authenticated sessions", async () => {
    await session(null);
    await denied(consume("receipt"),"42501");
    await session(alice,true);
    await denied(consume("receipt"),"42501");
    await denied(db.query("select private.consume_finance_rate_limit('receipt')"),"42501");
    await session(alice,false,"anon");
    await denied(consume("receipt"),"42501");
  });

  it("denies reading, editing or deleting counters through the authenticated role", async () => {
    for (const statement of [
      "select * from private.finance_rate_limit_windows",
      "update private.finance_rate_limit_windows set request_count=1",
      "delete from private.finance_rate_limit_windows",
      `insert into private.finance_rate_limit_windows values('${alice}','receipt',clock_timestamp(),1)`,
    ]) await denied(db.query(statement),"42501");
  });

  it("has no owner, quota or clock overrides and direct helper calls consume the same allowance", async () => {
    await denied(db.query("select public.consume_finance_rate_limit('receipt',$1,999,clock_timestamp())",[bob]),"42883");
    for (let n = 0; n < 10; n++)
      expect((await db.query<{ result: Result }>("select private.consume_finance_rate_limit('receipt') as result")).rows[0].result.allowed).toBe(true);
    expect((await consume("receipt")).allowed).toBe(false);
  });

  it("keeps only a private definer, a caller-privilege wrapper and narrowly granted execution", async () => {
    await db.exec("reset role");
    const functions = await db.query<{ schema: string; definer: boolean; config: string[]; anonymous: boolean; authenticated: boolean; args: number }>(`
      select n.nspname as schema,p.prosecdef as definer,p.proconfig as config,p.pronargs as args,
        has_function_privilege('anon',p.oid,'EXECUTE') as anonymous,
        has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.proname='consume_finance_rate_limit' order by n.nspname`);
    expect(functions.rows).toEqual([
      {schema:"private",definer:true,config:['search_path=""'],args:1,anonymous:false,authenticated:true},
      {schema:"public",definer:false,config:['search_path=""'],args:1,anonymous:false,authenticated:true},
    ]);
    expect((await db.query<{ rls: boolean }>("select relrowsecurity as rls from pg_class where oid='private.finance_rate_limit_windows'::regclass")).rows[0].rls).toBe(true);
  });
});
