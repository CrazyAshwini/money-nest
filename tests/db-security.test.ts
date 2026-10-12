import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const bank = "33333333-3333-4333-8333-333333333333";
const card = "44444444-4444-4444-8444-444444444444";
const otherBank = "55555555-5555-4555-8555-555555555555";
const bill = "66666666-6666-4666-8666-666666666666";
const payment = "77777777-7777-4777-8777-777777777777";
const alloc = "88888888-8888-4888-8888-888888888888";
const legacyTransaction = "11111111-aaaa-4aaa-8aaa-111111111111";
let db: PGlite;
async function asUser(userId: string, sql: string) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  return db.exec(sql);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
    insert into auth.users values('${owner}'),('${other}');
  `);
  const migrationDirectory = join(process.cwd(), "supabase/migrations");
  for (const migration of readdirSync(migrationDirectory).filter(name => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(migrationDirectory,migration),"utf8"));
    if (migration.endsWith("_finance_core.sql")) {
      await db.exec(`insert into public.transactions(id,user_id,amount,kind,description,merchant) values('${legacyTransaction}','${owner}',0.10,'expense','Synthetic legacy seller','Synthetic legacy seller');`);
    }
  }
  await asUser(owner,`insert into public.accounts(id,user_id,name,kind) values('${bank}','${owner}','Test bank','bank'),('${card}','${owner}','Test card','credit_card');`);
  await asUser(other,`insert into public.accounts(id,user_id,name,kind) values('${otherBank}','${other}','Other bank','bank');`);
},60000);
afterAll(async ()=>{ await db?.close(); });

describe("executed PostgreSQL schema security and financial invariants",()=>{
  it("leaves existing sellers untouched and keeps new platform values isolated through the decimal-safe API", async () => {
    const legacy = await asUser(
      owner,
      `select amount,platform,merchant,description from api_transactions where id='${legacyTransaction}'`,
    );
    expect(legacy[0].rows[0]).toEqual({
      amount: "0.10",
      platform: null,
      merchant: "Synthetic legacy seller",
      description: "Synthetic legacy seller",
    });
    const purchase = "11111111-bbbb-4bbb-8bbb-111111111111";
    await asUser(
      owner,
      `insert into public.transactions(id,user_id,amount,kind,status,occurred_on,description,merchant,platform,from_account_id) values('${purchase}','${owner}',28.00,'expense','posted','2026-10-12','Synthetic Biryani seller','Synthetic Biryani seller','Swiggy','${bank}');`,
    );
    const saved = await asUser(
      owner,
      `select amount,platform,merchant,description from api_transactions where id='${purchase}'`,
    );
    expect(saved[0].rows[0]).toEqual({
      amount: "28.00",
      platform: "Swiggy",
      merchant: "Synthetic Biryani seller",
      description: "Synthetic Biryani seller",
    });
    expect(
      (
        await asUser(
          other,
          `select * from api_transactions where id='${purchase}'`,
        )
      )[0].rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(
          other,
          `update transactions set platform='Zomato' where id='${purchase}' returning id`,
        )
      )[0].rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(
          owner,
          `select platform from api_transactions where id='${purchase}'`,
        )
      )[0].rows[0],
    ).toEqual({ platform: "Swiggy" });
    await db.exec("reset role");
    const view = await db.query<{ reloptions: string[] }>(
      "select reloptions from pg_class where oid='public.api_transactions'::regclass",
    );
    expect(view.rows[0].reloptions).toContain("security_invoker=true");
  });
  it("enables RLS on every application table and exposes no anonymous grants",async()=>{
    await db.exec("reset role");
    const rls = await db.query<{count:number}>(`select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
    expect(rls.rows[0].count).toBe(0);
    const grants = await db.query(`select * from information_schema.role_table_grants where grantee='anon' and table_schema='public'`);
    expect(grants.rows).toHaveLength(0);
  });
  it("hides other owners and rejects cross-owner composite foreign keys",async()=>{
    const rows = await asUser(owner,"select id from accounts");
    expect(rows[0].rows).toHaveLength(2);
    await expect(asUser(owner,`insert into transactions(user_id,amount,kind,description,from_account_id) values('${owner}',10,'expense','Cross-user attempt','${otherBank}')`)).rejects.toThrow();
    await expect(asUser(owner,`insert into accounts(user_id,name,kind) values('${other}','Spoofed owner','bank')`)).rejects.toThrow();
  });
  it("preserves decimals as strings before JSON serialization",async()=>{
    await asUser(owner,`insert into account_snapshots(user_id,account_id,as_of,reported_balance,source) values('${owner}','${bank}',now(),999999999999.99,'user_report')`);
    const result=await asUser(owner,"select reported_balance from api_account_snapshots");
    expect(result[0].rows[0]).toEqual({reported_balance:"999999999999.99"});
  });
  it("rejects unconfirmed posted dates, full identifiers, empty snapshots and impossible due dates",async()=>{
    await expect(asUser(owner,`insert into accounts(user_id,name,kind,masked_suffix) values('${owner}','Unmasked','bank','12345678')`)).rejects.toThrow();
    await expect(asUser(owner,`insert into transactions(user_id,amount,kind,status,description,from_account_id) values('${owner}',10,'expense','posted','Undated','${bank}')`)).rejects.toThrow();
    await expect(asUser(owner,`insert into account_snapshots(user_id,account_id,as_of,source) values('${owner}','${bank}',now(),'user_report')`)).rejects.toThrow();
    await expect(asUser(owner,`insert into bills(user_id,account_id,statement_amount,statement_date,period_start,period_end,due_date) values('${owner}','${card}',10,'2026-10-01','2026-09-01','2026-09-30','2026-09-29')`)).rejects.toThrow();
    await expect(asUser(owner,`insert into loans(user_id,name,lender,repayment_account_id) values('${owner}','Wrong source','Fictional lender','${card}')`)).rejects.toThrow(/bank or wallet/);
  });
  it("allocates an existing payment, rejects excess and protects applied payments",async()=>{
    await asUser(owner,`insert into bills(id,user_id,account_id,statement_amount,statement_date,period_start,period_end,due_date) values('${bill}','${owner}','${card}',8000,'2026-10-01','2026-09-01','2026-09-30','2026-10-18');
      insert into transactions(id,user_id,amount,kind,status,occurred_on,description,from_account_id,to_account_id) values('${payment}','${owner}',3000,'bill_payment','posted','2026-10-08','Payment','${bank}','${card}');
      select allocate_bill_payment('${alloc}','${bill}','${payment}',3000,true);`);
    await expect(asUser(owner,`update bill_payment_allocations set amount=3000.01 where id='${alloc}'`)).rejects.toThrow(/exceed/);
    await expect(asUser(owner,`update transactions set status='voided' where id='${payment}'`)).rejects.toThrow(/Remove payment allocations/);
    await expect(asUser(owner,`update bills set statement_amount=2000 where id='${bill}'`)).rejects.toThrow(/conflicts/);
    const result=await asUser(owner,"select amount from api_bill_payment_allocations");
    expect(result[0].rows[0]).toEqual({amount:"3000.00"});
  });
  it("rejects wrong payment destination and same UUID bypass across allocation tables",async()=>{
    const payment2="99999999-9999-4999-8999-999999999999";
    const loan="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const emi="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await asUser(owner,`insert into transactions(id,user_id,amount,kind,status,occurred_on,description,from_account_id,to_account_id) values('${payment2}','${owner}',1000,'bill_payment','posted','2026-10-08','Unmatched payment','${bank}',null);
      insert into loans(id,user_id,name,lender,repayment_account_id) values('${loan}','${owner}','Test loan','Fictional lender','${bank}');
      insert into emis(id,user_id,loan_id,number,due_date,amount) values('${emi}','${owner}','${loan}',1,'2026-11-01',1000);`);
    await expect(asUser(owner,`select allocate_bill_payment('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${bill}','${payment2}',800,true)`)).rejects.toThrow(/destination/);
    await asUser(owner,`update transactions set to_account_id='${card}' where id='${payment2}'`);
    await asUser(owner,`select allocate_bill_payment('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${bill}','${payment2}',800,false)`);
    await expect(asUser(owner,`select allocate_emi_payment('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${emi}','${payment2}',800)`)).rejects.toThrow(/exceed/);
  });
  it("writes append-only audits and isolates private storage paths",async()=>{
    const result=await asUser(owner,"select * from audit_events");
    expect(result[0].rows.length).toBeGreaterThan(5);
    await expect(asUser(owner,"delete from audit_events")).rejects.toThrow();
    await expect(asUser(owner,`insert into storage.objects(bucket_id,name) values('finance-documents','${other}/secret.pdf')`)).rejects.toThrow();
    await asUser(owner,`insert into storage.objects(bucket_id,name) values('finance-documents','${owner}/receipt.pdf')`);
    const hidden=await asUser(other,"select * from storage.objects");
    expect(hidden[0].rows).toHaveLength(0);
  });
  it("bounds shared costs and protects the linked original expense",async()=>{
    const group="12345678-1234-4234-8234-123456789012";
    const expense="12345678-1234-4234-8234-123456789013";
    await asUser(owner,`insert into transactions(id,user_id,amount,kind,status,occurred_on,description,from_account_id) values('${expense}','${owner}',100,'expense','posted','2026-10-09','Fictional group meal','${bank}');
      insert into expense_groups(id,user_id,title,occurred_on,total_cost,paid_by,transaction_id) values('${group}','${owner}','Group meal','2026-10-09',100,'You','${expense}');
      insert into expense_shares(user_id,group_id,participant,amount,is_owner) values('${owner}','${group}','You',60,true);`);
    await expect(asUser(owner,`insert into expense_shares(user_id,group_id,participant,amount) values('${owner}','${group}','Friend',50)`)).rejects.toThrow(/Shares exceed/);
    await expect(asUser(owner,`update expense_groups set total_cost=50 where id='${group}'`)).rejects.toThrow(/below assigned/);
    await expect(asUser(owner,`update transactions set status='voided' where id='${expense}'`)).rejects.toThrow(/linked group/);
    await expect(asUser(owner,`update expense_groups set total_cost=110 where id='${group}'`)).rejects.toThrow(/covering/);
  });
  it("accepts a real external-lender EMI debit and prevents excess repayment",async()=>{
    const loan="12345678-1234-4234-8234-123456789014";
    const emi="12345678-1234-4234-8234-123456789015";
    const debit="12345678-1234-4234-8234-123456789016";
    const allocation="12345678-1234-4234-8234-123456789017";
    await asUser(owner,`insert into loans(id,user_id,name,lender,repayment_account_id) values('${loan}','${owner}','External lender loan','Fictional lender','${bank}');
      insert into emis(id,user_id,loan_id,number,due_date,amount) values('${emi}','${owner}','${loan}',1,'2026-11-01',500);
      insert into transactions(id,user_id,amount,kind,status,occurred_on,description,from_account_id,to_account_id) values('${debit}','${owner}',250,'bill_payment','posted','2026-10-09','External lender debit','${bank}',null);
      select allocate_emi_payment('${allocation}','${emi}','${debit}',250);`);
    const result=await asUser(owner,`select amount from api_emi_payment_allocations where id='${allocation}'`);
    expect(result[0].rows[0]).toEqual({amount:"250.00"});
    await expect(asUser(owner,`update emi_payment_allocations set amount=300 where id='${allocation}'`)).rejects.toThrow(/exceed/);
    await expect(asUser(owner,`update emis set amount=200 where id='${emi}'`)).rejects.toThrow(/conflicts/);
    await expect(asUser(owner,`update loans set repayment_account_id='${otherBank}' where id='${loan}'`)).rejects.toThrow();
  });
  it("commits imports atomically, retries by hash and rolls back bad rows",async()=>{
    const txn = {id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",amount:"0.10",currency:"INR",kind:"expense",status:"posted",occurredOn:"2026-10-09",description:"Synthetic CSV",merchant:"Synthetic CSV seller",platform:"Swiggy",fromAccountId:bank,toAccountId:null,sourceObjectId:"synthetic-file-row-1"};
    const hash="a".repeat(64);
    const result=await asUser(owner,`select commit_reviewed_import('${hash}','synthetic.csv','${JSON.stringify([txn])}'::jsonb) as result`);
    expect(result[0].rows[0]).toMatchObject({result:{count:1,alreadyCommitted:false}});
    const saved = await asUser(owner, `select amount,platform,merchant from api_transactions where id='${txn.id}'`);
    expect(saved[0].rows[0]).toEqual({amount:"0.10",platform:"Swiggy",merchant:"Synthetic CSV seller"});
    const retry=await asUser(owner,`select commit_reviewed_import('${hash}','synthetic.csv','${JSON.stringify([txn])}'::jsonb) as result`);
    expect(retry[0].rows[0]).toMatchObject({result:{count:0,alreadyCommitted:true}});
    const nextRow={...txn,id:"12345678-1234-4234-8234-123456789018",sourceObjectId:"synthetic-file-row-2"};
    const appended=await asUser(owner,`select commit_reviewed_import('${hash}','synthetic.csv','${JSON.stringify([txn,nextRow])}'::jsonb) as result`);
    expect(appended[0].rows[0]).toMatchObject({result:{count:1,alreadyCommitted:false}});
    const invalid=[{...txn,id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",sourceObjectId:"invalid-file-row-1"},{...txn,id:"ffffffff-ffff-4fff-8fff-ffffffffffff",sourceObjectId:"invalid-file-row-2",fromAccountId:otherBank}];
    await expect(asUser(owner,`select commit_reviewed_import('${"b".repeat(64)}','invalid.csv','${JSON.stringify(invalid)}'::jsonb)`)).rejects.toThrow();
    const absent=await asUser(owner,"select * from transactions where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'");
    expect(absent[0].rows).toHaveLength(0);
  });
});
