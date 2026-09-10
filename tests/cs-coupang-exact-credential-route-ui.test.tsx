import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoupangCredentialAccounts } from "../app/coupang-credential-accounts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://coupang-exact-credential.test";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-test";
process.env.SUPABASE_SECRET_KEY = "service-test";

const calls: Array<{ client: string; name: string; args: Record<string, unknown> }> = [];
let credentials: Array<Record<string, unknown>> = [];
const supabaseMock = `data:text/javascript,${encodeURIComponent(`
export function createClient(_url,key) {
  const client=key==='service-test'?'service':'user';
  return {
    auth:{getUser:async()=>({data:{user:{id:'admin'}},error:null})},
    rpc:async(name,args={})=>{
      globalThis.__coupangExactCredentialCalls.push({client,name,args});
      if(name==='sellerpilot_is_admin')return {data:true,error:null};
      if(name==='sellerpilot_list_credentials')return {data:globalThis.__coupangExactCredentials,error:null};
      if(name==='sellerpilot_decrypt_credential')return {data:{access_key:'old-access',secret_key:'old-secret',vendor_id:'VENDOR_B',requested_by:'wing-user'},error:null};
      if(name==='sellerpilot_create_coupang_credential_v1')return {data:'10000000-0000-4000-8000-000000000003',error:null};
      if(name==='sellerpilot_rotate_coupang_credential_v1')return {data:'10000000-0000-4000-8000-000000000004',error:null};
      return {data:null,error:{code:'unexpected_rpc'}};
    }
  };
}
`)}`;
(globalThis as typeof globalThis & { __coupangExactCredentialCalls: typeof calls }).__coupangExactCredentialCalls = calls;
(globalThis as typeof globalThis & { __coupangExactCredentials: typeof credentials }).__coupangExactCredentials = credentials;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@supabase/supabase-js") return { shortCircuit: true, url: supabaseMock };
  return nextResolve(specifier, context);
} });
const { POST } = await import("../app/api/admin/channel-credentials/rotate/route");

const base = {
  channel: "coupang",
  environment: "production",
  expiresAt: "2027-03-08T14:59:59.000Z",
  rotationDays: 180,
  warningDays: 14,
  graceDays: 0,
};

function request(body: Record<string, unknown>) {
  return new Request("https://sellerpilot.test/api/admin/channel-credentials/rotate", {
    method: "POST",
    headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Coupang create route calls only the exact new-vendor RPC", async () => {
  calls.length = 0;
  credentials = [];
  (globalThis as typeof globalThis & { __coupangExactCredentials: typeof credentials }).__coupangExactCredentials = credentials;
  const response = await POST(request({
    ...base,
    secretPayload: { access_key: "access-c", secret_key: "secret-c", vendor_id: "VENDOR_C", requested_by: "wing-user" },
  }) as never);
  assert.equal(response.status, 200);
  const exact = calls.find((call) => call.name === "sellerpilot_create_coupang_credential_v1");
  assert.ok(exact);
  assert.equal(exact.args.p_environment, "production");
  assert.equal((exact.args.p_secret_payload as Record<string, unknown>).vendor_id, "VENDOR_C");
  assert.equal(calls.some((call) => call.name === "sellerpilot_rotate_credential"), false);
  assert.equal((await response.json()).identityEvidence, "credential_incarnation_v1");
});

test("Coupang rotate route binds the chosen credential B and never chooses A", async () => {
  calls.length = 0;
  const a = "10000000-0000-4000-8000-000000000001";
  const b = "10000000-0000-4000-8000-000000000002";
  credentials = [
    { id: a, channel: "coupang", environment: "production", status: "active" },
    { id: b, channel: "coupang", environment: "production", status: "active" },
  ];
  (globalThis as typeof globalThis & { __coupangExactCredentials: typeof credentials }).__coupangExactCredentials = credentials;
  const response = await POST(request({
    ...base,
    credentialId: b,
    secretPayload: { access_key: "access-b2", secret_key: "secret-b2" },
  }) as never);
  assert.equal(response.status, 200);
  const decrypt = calls.find((call) => call.name === "sellerpilot_decrypt_credential");
  const rotate = calls.find((call) => call.name === "sellerpilot_rotate_coupang_credential_v1");
  assert.equal(decrypt?.args.p_credential_id, b);
  assert.equal(rotate?.args.p_credential_id, b);
  assert.equal((rotate?.args.p_secret_patch as Record<string, unknown>).vendor_id, undefined);
  assert.equal(calls.some((call) => Object.values(call.args).includes(a)), false);
  assert.equal(calls.some((call) => call.name === "sellerpilot_rotate_credential"), false);
});

test("Coupang account UI renders every active credential as an explicit target", async () => {
  const events: string[] = [];
  const accounts = [
    { id: "a", version: 2, fingerprint: "AAAAAAAAAAAA", environment: "production" as const, status: "active" as const, last_check_status: "passed" as const },
    { id: "b", version: 4, fingerprint: "BBBBBBBBBBBB", environment: "production" as const, status: "active" as const, last_check_status: null },
  ];
  const html = renderToStaticMarkup(React.createElement(CoupangCredentialAccounts, {
    accounts,
    testingId: "",
    onTest: (account) => events.push(`test:${account.id}`),
    onInspect: (account) => events.push(`inspect:${account.id}`),
    onRotate: (account) => events.push(`rotate:${account.id}`),
  }));
  assert.match(html, /data-coupang-credential-accounts="exact-credential-id"/);
  assert.match(html, /AAAAAAAAAAAA/);
  assert.match(html, /BBBBBBBBBBBB/);
  assert.equal((html.match(/이 계정 키 교체/g) ?? []).length, 2);
  const center = await readFile(new URL("../app/api-credential-center.tsx", import.meta.url), "utf8");
  assert.match(center, /candidates\.length === 1/);
  assert.match(center, /setOperationTarget\(\{ channel, credential: account as Credential \}\)/);
  assert.deepEqual(events, []);
});
