import { describe, expect, it } from "vitest";
import { recordSchemas, transactionSchema } from "../src/lib/supabase/validation";
import { transactionSchema as localTransactionSchema } from "../src/lib/validation";

const owned={id:"11111111-1111-4111-8111-111111111111",userId:"22222222-2222-4222-8222-222222222222"};
describe("server record validation",()=>{
  it("preserves separate seller and platform and accepts older records without a platform", () => {
    const transaction = {
      ...owned,
      amount: "28.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-12",
      description: "Synthetic Biryani seller",
      merchant: "Synthetic Biryani seller",
      fromAccountId: owned.id,
      toAccountId: null,
    };
    for (const schema of [transactionSchema, localTransactionSchema]) {
      expect(schema.parse(transaction)).not.toHaveProperty("platform");
      expect(schema.parse({ ...transaction, platform: null })).toMatchObject({
        platform: null,
        merchant: transaction.merchant,
      });
      expect(
        schema.parse({ ...transaction, platform: " Swiggy " }),
      ).toMatchObject({
        platform: "Swiggy",
        merchant: transaction.merchant,
        description: transaction.description,
      });
      expect(
        schema.safeParse({ ...transaction, platform: "p".repeat(101) }).success,
      ).toBe(false);
    }
  });
  it("normalizes a snapshot calendar date without shifting its label",()=>{
    const snapshot=recordSchemas.snapshots.parse({...owned,accountId:owned.id,asOf:"2026-10-09",reportedBalance:"0.10",source:"user_report",verifiedByUser:false});
    expect(snapshot.asOf).toBe("2026-10-09T00:00:00.000Z");
    expect(recordSchemas.snapshots.safeParse({...snapshot,reportedBalance:null}).success).toBe(false);
  });
  it("allows pending undated purchases but rejects posting them",()=>{
    const transaction={...owned,amount:"10.01",currency:"INR",kind:"expense",status:"pending_review",occurredOn:null,description:"Unconfirmed purchase",fromAccountId:owned.id,toAccountId:null};
    expect(transactionSchema.safeParse(transaction).success).toBe(true);
    expect(transactionSchema.safeParse({...transaction,status:"posted"}).success).toBe(false);
    expect(transactionSchema.safeParse({...transaction,amount:"10.001"}).success).toBe(false);
    expect(transactionSchema.safeParse({...transaction,id:"11111111-1111-8111-8111-111111111111"}).success).toBe(true);
  });
  it("accepts only a masked numeric suffix of up to four digits",()=>{
    const account={...owned,name:"Fictional account",institution:"Fictional bank",kind:"bank",maskedSuffix:"1234",active:true};
    expect(recordSchemas.accounts.safeParse(account).success).toBe(true);
    expect(recordSchemas.accounts.safeParse({...account,maskedSuffix:"12345678"}).success).toBe(false);
  });
});
