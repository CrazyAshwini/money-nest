import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyPersonalLoanCommand,
  type PersonalLoanCommand,
} from "../src/lib/personal-loans";
import type { WorkspaceData } from "../src/lib/types";
import { toDatabase } from "../src/lib/supabase/validation";
let db: PGlite;
const legacyAdjustment = randomUUID();
const alice = randomUUID(),
  bob = randomUUID(),
  bank = randomUUID();
async function session(owner: string) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
}
async function read() {
  return (
    await db.query<{ state: { workspace: WorkspaceData; revision: string } }>(
      "select read_finance_cloud_state() as state",
    )
  ).rows[0].state;
}
function command(
  overrides: Partial<PersonalLoanCommand> = {},
): PersonalLoanCommand {
  return {
    id: randomUUID(),
    interestId: randomUUID(),
    loanId: randomUUID(),
    action: "create",
    direction: "lent",
    person: "Synthetic friend",
    amount: "5000.00",
    interest: "0.00",
    occurredOn: "2026-10-01",
    accountId: bank,
    notes: "",
    ...overrides,
  };
}
async function save(c: PersonalLoanCommand, revision?: string) {
  const before = await read();
  const after = applyPersonalLoanCommand(before.workspace, alice, c);
  const loan = after.loans.find(
    (l) => !before.workspace.loans.some((old) => old.id === l.id),
  );
  const added = after.transactions.filter(
    (t) => !before.workspace.transactions.some((old) => old.id === t.id),
  );
  return db.query("select commit_personal_loan($1,$2,$3)", [
    revision ?? before.revision,
    loan ? toDatabase(loan as unknown as Record<string, unknown>, alice) : null,
    added.map((t) =>
      toDatabase(t as unknown as Record<string, unknown>, alice),
    ),
  ]);
}
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
  for (const file of readdirSync(join(process.cwd(), "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (file.endsWith("_personal_loan_ledger.sql")) {
      await db.query("insert into auth.users(id) values($1),($2)", [
        alice,
        bob,
      ]);
      await db.query(
        "insert into transactions(id,user_id,amount,kind,description) values($1,$2,7.77,'adjustment','Legacy correction')",
        [legacyAdjustment, alice],
      );
    }
    await db.exec(
      readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"),
    );
  }
  await session(alice);
  await db.query(
    "insert into accounts(id,user_id,name,kind,opening_balance,opening_balance_date) values($1,$2,'Synthetic bank','bank',10000,'2026-09-01')",
    [bank, alice],
  );
}, 60000);
afterAll(async () => {
  await db?.close();
});
describe("atomic personal-loan PostgreSQL enforcement", () => {
  it("preserves a historical adjustment across the additive migration", async () => {
    await session(alice);
    const row = (
      await db.query(
        "select amount::text as amount,kind,description,loan_id,loan_event from api_transactions where id=$1",
        [legacyAdjustment],
      )
    ).rows[0];
    expect(row).toEqual({
      amount: "7.77",
      kind: "adjustment",
      description: "Legacy correction",
      loan_id: null,
      loan_event: null,
    });
  });

  it("commits loan and exact decimal disbursement together and audits both", async () => {
    await session(alice);
    const c = command();
    await save(c);
    const state = await read();
    expect(state.workspace.loans.find((l) => l.id === c.loanId)).toMatchObject({
      ledgerManaged: true,
      contractualPrincipal: "5000.00",
    });
    expect(
      state.workspace.transactions.find((t) => t.id === c.id),
    ).toMatchObject({ loanId: c.loanId, amount: "5000.00", kind: "transfer" });
    expect(
      state.workspace.auditEvents.filter((a) =>
        [c.id, c.loanId].includes(a.entityId),
      ),
    ).toHaveLength(2);
  });
  it("rolls back a standalone agreement without disbursement", async () => {
    const id = randomUUID();
    await expect(
      db.query(
        "insert into loans(id,user_id,name,lender,kind,contractual_principal,repayment_account_id,disbursed_on,ledger_managed) values($1,$2,'Test','Test','lent',10,$3,'2026-10-01',true)",
        [id, alice, bank],
      ),
    ).rejects.toThrow(/commit together/);
    expect(
      (await db.query("select id from loans where id=$1", [id])).rows,
    ).toHaveLength(0);
  });
  it("rejects a stale revision with no partial loan or event", async () => {
    const before = await read();
    const c = command();
    await expect(
      save(c, String(BigInt(before.revision) - 1n)),
    ).rejects.toMatchObject({ code: "40001" });
    expect((await read()).workspace.loans.some((l) => l.id === c.loanId)).toBe(
      false,
    );
  });
  it("locks against principal overpayment and forbids update/delete of events", async () => {
    const c = command();
    await save(c);
    const repay = command({
      action: "repay",
      loanId: c.loanId,
      amount: "3000.00",
      occurredOn: "2026-10-02",
    });
    await save(repay);
    await expect(
      db.query(
        "insert into transactions(id,user_id,amount,kind,status,occurred_on,description,to_account_id,loan_id,loan_event) values($1,$2,2000.01,'transfer','posted','2026-10-03','Overpay',$3,$4,'repayment')",
        [randomUUID(), alice, bank, c.loanId],
      ),
    ).rejects.toThrow(/exceeds outstanding/);
    await expect(
      db.query("update transactions set amount=1 where id=$1", [repay.id]),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.query("delete from transactions where id=$1", [repay.id]),
    ).rejects.toThrow();
    const reverse = command({
      action: "reverse",
      loanId: c.loanId,
      amount: repay.amount,
      reversesTransactionId: repay.id,
      occurredOn: "2026-10-03",
    });
    await save(reverse);
    const state = await read();
    expect(
      state.workspace.transactions.find((t) => t.id === reverse.id),
    ).toMatchObject({ fromAccountId: bank, reversesTransactionId: repay.id });
  });
  it("rolls back principal if a companion interest event fails", async () => {
    const c = command({ direction: "borrowed", amount: "100.00" });
    await save(c);
    const before = await read();
    const repayment = command({
      action: "repay",
      loanId: c.loanId,
      amount: "100.00",
      interest: "1.00",
      occurredOn: "2026-10-02",
    });
    const next = applyPersonalLoanCommand(before.workspace, alice, repayment);
    const added = next.transactions
      .filter(
        (t) => !before.workspace.transactions.some((old) => old.id === t.id),
      )
      .map((t) => toDatabase(t as unknown as Record<string, unknown>, alice));
    added[1].to_account_id = bank;
    await expect(
      db.query("select commit_personal_loan($1,null,$2)", [
        before.revision,
        added,
      ]),
    ).rejects.toThrow();
    expect(
      (await read()).workspace.transactions.some((t) => t.id === repayment.id),
    ).toBe(false);
  });
  it("hides and protects Alice's loans, counterparties and events from Bob", async () => {
    const before = await read();
    const loan = before.workspace.loans[0];
    const event = before.workspace.transactions[0];
    await session(bob);
    expect((await db.query("select * from api_loans")).rows).toEqual([]);
    expect((await db.query("select * from api_transactions")).rows).toEqual([]);
    expect(
      (
        await db.query(
          "update loans set name='Foreign' where id=$1 returning id",
          [loan.id],
        )
      ).rows,
    ).toEqual([]);
    await expect(
      db.query(
        "insert into transactions(id,user_id,amount,kind,status,occurred_on,description,to_account_id,loan_id,loan_event) values($1,$2,1,'transfer','posted','2026-10-02','Foreign',$3,$4,'repayment')",
        [randomUUID(), bob, bank, loan.id],
      ),
    ).rejects.toThrow();
    await expect(
      db.query("select commit_personal_loan(0,$1,$2)", [
        {
          ...toDatabase(loan as unknown as Record<string, unknown>, alice),
          id: randomUUID(),
        },
        [toDatabase(event as unknown as Record<string, unknown>, alice)],
      ]),
    ).rejects.toThrow();
    await session(alice);
    expect((await read()).workspace.loans[0].name).toBe(loan.name);
  });
  it("commits and reverses principal plus interest atomically", async () => {
    const c = command({ direction: "borrowed", amount: "100.00" });
    await save(c);
    const repay = command({
      action: "repay",
      loanId: c.loanId,
      amount: "100.00",
      interest: "5.25",
      occurredOn: "2026-10-02",
    });
    await save(repay);
    const reverse = command({
      action: "reverse",
      loanId: c.loanId,
      amount: "100.00",
      reversesTransactionId: repay.id,
      occurredOn: "2026-10-03",
    });
    await save(reverse);
    const events = (await read()).workspace.transactions.filter(
      (t) => t.loanId === c.loanId,
    );
    expect(events).toHaveLength(5);
    expect(events.find((t) => t.id === reverse.interestId)).toMatchObject({
      kind: "refund",
      amount: "5.25",
      refundOfTransactionId: repay.interestId,
    });
  });
  it("enforces the remaining participant share on linked reimbursements", async () => {
    const purchase = randomUUID(),
      group = randomUUID();
    await db.query(
      "insert into transactions(id,user_id,amount,kind,status,occurred_on,description,from_account_id) values($1,$2,600,'expense','posted','2026-10-01','Shared meal',$3)",
      [purchase, alice, bank],
    );
    await db.query(
      "insert into expense_groups(id,user_id,title,occurred_on,total_cost,paid_by,transaction_id) values($1,$2,'Meal','2026-10-01',600,'You',$3)",
      [group, alice, purchase],
    );
    await db.query(
      "insert into expense_shares(user_id,group_id,participant,amount,is_owner) values($1,$2,'You',200,true),($1,$2,'Friend',400,false)",
      [alice, group],
    );
    const sql =
      "insert into transactions(id,user_id,amount,kind,status,occurred_on,description,to_account_id,refund_of_transaction_id,refund_reason,external_payer) values($1,$2,$3,'refund','posted','2026-10-02','Shared reimbursement',$4,$5,'shared_reimbursement','Friend')";
    await db.query(sql, [randomUUID(), alice, "400.00", bank, purchase]);
    await expect(
      db.query(sql, [randomUUID(), alice, "0.01", bank, purchase]),
    ).rejects.toThrow(/exceeds remaining/);
  });
  it("archiving preserves linked history and blocks new payments", async () => {
    const before = await read();
    await db.query("update accounts set active=false where id=$1", [bank]);
    expect((await read()).workspace.transactions).toEqual(
      before.workspace.transactions,
    );
    await expect(save(command())).rejects.toThrow(/active/);
  });
});
