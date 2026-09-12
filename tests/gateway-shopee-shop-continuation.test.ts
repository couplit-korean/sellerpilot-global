import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProviderExecutionInput } from '../lib/channels/provider-execution-contract';
import { executeCsProviderJob } from '../lib/cs/operations/provider';
import { gatewayWorkerCompletionSchema } from '../lib/channels/gateway-contract';
const credentialId='00000000-0000-4000-8000-000000039001';
function credential(shopIds: string[], mainAccountId = "9001") {
  return {
    partner_id: "2031489",
    partner_key: "synthetic-partner-key",
    main_account_id: mainAccountId,
    provider_account_identity_version: "v1",
    provider_account_subject: `shopee:main:${mainAccountId}`,
    shop_id: shopIds[0],
    shop_ids: shopIds,
    authorization_expires_at: "2099-01-01T00:00:00.000Z",
    shopee_targets: shopIds.map((id) => ({
      type: "shop",
      id,
      access_token: `access-${id}`,
      refresh_token: `refresh-${id}`,
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
      refresh_token_expires_at: "2099-02-01T00:00:00.000Z",
    })),
  };
}

function providerInput(arguments_: Record<string, unknown>, shopIds: string[], mainAccountId = "9001") {
  const events: string[] = [];
  const input: ProviderExecutionInput = {
    job: {
      id: "00000000-0000-4000-8000-000000039004",
      claim_token: "00000000-0000-4000-8000-000000039005",
      credential_id: credentialId,
      channel: "shopee",
      operation: "inquiries.list",
      environment: "production",
      request: { periodicKey: "inquiries:combined-integration", arguments: arguments_ },
      credential: credential(shopIds, mainAccountId),
      attempt_count: 1,
    },
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("provider-mutation"); },
      beginCredentialMutation: async () => { events.push("credential-mutation"); },
      stageCredentialRefresh: async () => { events.push("credential-stage"); },
    },
  };
  return { input, events };
}

const success = (shopId: unknown) => ({
  ok: true as const,
  channel: "shopee" as const,
  operation: "inquiries.list" as const,
  steps: [{
    name: "inquiries",
    ok: true,
    status: 200,
    data: {
      sellerpilotProviderContext: { shopId },
      response: { item_comment_list: [], more: false, next_cursor: "" },
    },
  }],
  safeMessage: "synthetic read",
});


test('actual multi-shop provider result passes the worker completion boundary and advances to the next authorized shop',async()=>{
 const firstInput=providerInput({kind:'product_review',cursor:'',pageSize:100},['1001','1002']);
 const first=await executeCsProviderJob(firstInput.input,async request=>success(request.arguments.shopId));
 const envelope={jobId:firstInput.input.job.id,claimToken:firstInput.input.job.claim_token,status:'succeeded',result:first};
 const parsed=gatewayWorkerCompletionSchema.safeParse(envelope);
 assert.equal(parsed.success,true,JSON.stringify(parsed.error?.issues));
 assert.equal(first.continuation?.arguments.sellerpilotShopeeTargetShopId,'1002');
 const next=providerInput(first.continuation!.arguments,['1002','1001']);let called='';
 await executeCsProviderJob(next.input,async request=>{called=String(request.arguments.shopId);return success(called);});
 assert.equal(called,'1002');
 for(const change of [
  {sellerpilotShopeeTargetContract:undefined},{sellerpilotShopeeTargetPlanDigest:'invalid'},
  {sellerpilotShopeeTargetShopId:''},{sellerpilotPaginationDepth:2},
  {sellerpilotPaginationTrail:['a'.repeat(64)]},{shopId:'1001'},
 ]){
  const result={...first,continuation:{...first.continuation,arguments:{...first.continuation!.arguments,...change}}};
  assert.equal(gatewayWorkerCompletionSchema.safeParse({...envelope,result}).success,false);
 }
});
