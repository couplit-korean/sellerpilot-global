import assert from 'node:assert/strict';
import test from 'node:test';
import { processCsGatewayJob } from '../../scripts/cs-gateway-job.mjs';

const job = {id:'00000000-0000-4000-8000-000000000011',claim_token:'00000000-0000-4000-8000-000000000012',channel:'shopee',operation:'inquiries.list',credential:{},request:{arguments:{}}};
const refresh={payload:{accessToken:'synthetic-refreshed-token'}};
async function execute(scenario, rejectStage = false) {
  const calls=[]; let stopped=0; let providerCalls=0;
  await processCsGatewayJob(job, {
    createGatewayHeartbeat:()=>({start:async()=>{},assertHealthy:async()=>{},stop:async()=>{stopped++;}}),
    persistWorkerCompletion:async(path,payload)=>{
      if (rejectStage && payload.action==='stage') throw new Error('SYNTHETIC_STAGE_RESPONSE_LOST');
      calls.push({path,payload}); return {status:'recorded'};
    },
    reserveProviderRequest:async()=>{},
    executeProvider:async({hooks})=>{providerCalls++;await scenario(hooks);throw new Error('SYNTHETIC_READ_FAILED');},
  });
  assert.equal(stopped,1); assert.equal(providerCalls,1);
  const completions=calls.filter(call=>call.path.endsWith('/complete'));
  assert.equal(completions.length,1);
  return completions[0].payload;
}

test('a read failure after a durably staged refresh persists the refresh and remains a failed read', async()=>{
  const result=await execute(async hooks=>{await hooks.beginCredentialMutation();await hooks.stageCredentialRefresh(refresh);});
  assert.equal(result.status,'failed');
  assert.equal(result.error,'CS_PROVIDER_EXECUTION_FAILED:SYNTHETIC_READ_FAILED');
  assert.deepEqual(result.credentialRefresh,refresh);
});
test('a refresh without a durable stage remains reconciliation required',async()=>{
  const result=await execute(async hooks=>{await hooks.beginCredentialMutation();});
  assert.equal(result.status,'reconciliation_required');
  assert.equal('credentialRefresh' in result,false);
});
test('a lost stage response never treats in-memory credentials as a durable receipt',async()=>{
  const result=await execute(async hooks=>{await hooks.beginCredentialMutation();await hooks.stageCredentialRefresh(refresh);},true);
  assert.equal(result.status,'reconciliation_required');
  assert.equal('credentialRefresh' in result,false);
});
test('a business mutation stays uncertain even after a successful credential stage',async()=>{
  const result=await execute(async hooks=>{await hooks.beginProviderMutation();await hooks.beginCredentialMutation();await hooks.stageCredentialRefresh(refresh);});
  assert.equal(result.status,'reconciliation_required');
  assert.deepEqual(result.credentialRefresh,refresh);
});
test('a second unresolved refresh does not reuse the first staged receipt',async()=>{
  const result=await execute(async hooks=>{await hooks.beginCredentialMutation();await hooks.stageCredentialRefresh(refresh);await hooks.beginCredentialMutation();});
  assert.equal(result.status,'reconciliation_required');
  assert.equal('credentialRefresh' in result,false);
});
