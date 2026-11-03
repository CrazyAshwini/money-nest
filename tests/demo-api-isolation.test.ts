import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const owner="11111111-1111-4111-8111-111111111111";
const mocks=vi.hoisted(()=>({client:vi.fn(),getUser:vi.fn(),quota:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createSupabaseServerClient:mocks.client}));
vi.mock("@/lib/private-profile-store",async(original)=>({
  ...await original<typeof import("../src/lib/private-profile-store")>(),privateProfileEnabled:()=>false,
}));
vi.mock("@/lib/rate-limit",async(original)=>({
  ...await original<typeof import("../src/lib/rate-limit")>(),requireRouteRateLimit:mocks.quota,
}));
import { GET as workspaceGET,POST as workspacePOST,DELETE as workspaceDELETE } from "../src/app/api/workspace/route";
import { GET as profileGET,POST as profilePOST,PATCH as profilePATCH } from "../src/app/api/profile/route";
import { GET as documentsGET,POST as documentsPOST } from "../src/app/api/documents/route";
import { GET as ordersGET,POST as ordersPOST } from "../src/app/api/orders/route";
import { GET as handoffGET,POST as handoffPOST } from "../src/app/api/imports/handoff/route";
import { POST as commitPOST } from "../src/app/api/imports/commit/route";
import { POST as transferPOST } from "../src/app/api/profile/import/route";
import { GET as settingsGET,POST as settingsPOST } from "../src/app/api/ai/settings/route";
import { GET as botGET,POST as botPOST } from "../src/app/api/ai/bot/route";
import { POST as receiptPOST } from "../src/app/api/ai/receipt/route";
import { POST as aiOrdersPOST } from "../src/app/api/ai/orders/route";
import { authenticateAIOwnerRequest } from "../src/lib/ai-owner-auth";
import { DEMO_SESSION_COOKIE } from "../src/lib/demo-session";

const origin="https://money-nest.example";
function request(method="POST",path="/api/workspace",demo=true) {
  return new NextRequest(`${origin}${path}`,{method,headers:{host:"money-nest.example",origin,
    "content-type":"application/json",cookie:`synthetic-real-supabase-session=present${demo?`; ${DEMO_SESSION_COOKIE}=1`:""}`},
    ...(method==="GET"?{}:{body:JSON.stringify({unreviewed:"must not be read"})})});
}
beforeEach(()=>{
  vi.clearAllMocks();
  vi.stubEnv("APP_URL",origin); vi.stubEnv("FINANCE_PRIVATE_ENABLED","false");
  vi.stubEnv("FINANCE_CLOUD_OWNER_ID",owner); vi.stubEnv("FINANCE_CLOUD_ACCESS_MODE","owner");
  mocks.getUser.mockResolvedValue({data:{user:{id:owner,email:"synthetic.owner@example.test",email_confirmed_at:"2026-10-01T00:00:00Z",is_anonymous:false}},error:null});
  mocks.client.mockResolvedValue({auth:{getUser:mocks.getUser}});
});
afterEach(()=>vi.unstubAllEnvs());

describe("public fictional demo is isolated from a simultaneous real session",()=>{
  it.each([
    ["workspacePOST",workspacePOST,"POST"],["workspaceDELETE",workspaceDELETE,"DELETE"],
    ["profilePOST",profilePOST,"POST"],["profilePATCH",profilePATCH,"PATCH"],
    ["documentsGET",documentsGET,"GET"],["documentsPOST",documentsPOST,"POST"],
    ["ordersGET",ordersGET,"GET"],["ordersPOST",ordersPOST,"POST"],
    ["handoffGET",handoffGET,"GET"],["handoffPOST",handoffPOST,"POST"],
    ["commitPOST",commitPOST,"POST"],["transferPOST",transferPOST,"POST"],
    ["settingsGET",settingsGET,"GET"],["settingsPOST",settingsPOST,"POST"],
    ["botGET",botGET,"GET"],["botPOST",botPOST,"POST"],
    ["receiptPOST",receiptPOST,"POST"],["aiOrdersPOST",aiOrdersPOST,"POST"],
  ] as const)("%s rejects demo access before body, real Auth, quotas, storage or providers",async(_name,handler,method)=>{
    const input=request(method);
    const result=await handler(input);
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({code:"demo_read_only"});
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(input.bodyUsed).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.quota).not.toHaveBeenCalled();
  });
  it("keeps cookie-based demo workspace and profile reads fictional",async()=>{
    const workspace=await workspaceGET(request("GET"));
    expect((await workspace.json()).backend).toBe("demo");
    expect((await (await profileGET(request("GET"))).json()).backend).toBe("demo");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("retains the explicit read-only demo query without requiring a real session",async()=>{
    const result=await workspaceGET(request("GET","/api/workspace?demo=true",false));
    expect(result.status).toBe(200);
    expect((await result.json()).backend).toBe("demo");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("continues authenticating real-owner AI requests after leaving demo",async()=>{
    expect(await authenticateAIOwnerRequest(request("POST","/api/ai/bot",false))).toEqual({ownerId:owner,cloud:true});
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });
});
