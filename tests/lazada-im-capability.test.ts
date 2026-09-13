import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseLazadaImCapability, lazadaImCredentialBinding } from "../lib/channels/lazada-im-capability";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";
import { csCredentialBindingEvidence } from "../lib/channels/cs-credential-binding";
import type { CredentialRefreshSnapshot } from "../lib/channels/protocols";

const commerce = { account_platform: "seller_center", country_user_info: [
  { country: "my", seller_id: "300872000183", user_id: "100001" },
  { country: "sg", seller_id: "1754224042", user_id: "100002" },
] };
const source = withLazadaProviderAccountIdentity({ ...commerce,
  app_key: "commerce-app", app_secret: "commerce-secret", access_token: "commerce-access",
  refresh_token: "commerce-refresh", im_app_key: "im-app", im_app_secret: "im-secret",
  im_access_token: "old-im-access", im_refresh_token: "old-im-refresh",
}, commerce).payload;
const tokenResponse = { code: "0", access_token: "new-im-access", refresh_token: "new-im-refresh",
  expires_in: 3600, refresh_expires_in: 7200,
  account_platform: "seller_center", country_user_info: [commerce.country_user_info[0]] };

async function run(response = tokenResponse, probeCode = "0") {
  const previous = globalThis.fetch;
  const events: string[] = [];
  const stages: CredentialRefreshSnapshot[] = [];
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    if (url.pathname.endsWith("/auth/token/refresh")) {
      events.push("refresh");
      assert.equal(url.searchParams.get("app_key"), "im-app");
      assert.equal(url.searchParams.get("refresh_token"), "old-im-refresh");
      return Response.json(response);
    }
    assert.equal(url.pathname, "/rest/im/session/list");
    assert.equal(url.searchParams.get("access_token"), "new-im-access");
    events.push("probe");
    return Response.json({ code: probeCode, data: { session_list: [] } });
  };
  try {
    const result = await diagnoseLazadaImCapability({ payload: source, country: "MY",
      begin: () => { events.push("begin"); }, assertLease: () => {},
      stage: (snapshot) => { events.push(snapshot.recoveryOnly ? "recovery" : "verified"); stages.push(snapshot); } });
    return { result, events, stages };
  } catch (error) { return { error, events, stages }; }
  finally { globalThis.fetch = previous; }
}

test("IM refresh preserves commerce identity and stages rotating tokens before country proof", async () => {
  const value = await run();
  assert.equal(value.error, undefined);
  assert.deepEqual(value.events, ["begin", "refresh", "recovery", "begin", "verified", "probe"]);
  assert.equal(value.stages[0].payload.provider_account_subject, undefined);
  assert.equal(value.stages[1].payload.provider_account_subject, source.provider_account_subject);
  assert.equal(value.stages[1].payload.access_token, source.access_token);
  assert.equal(value.result?.lazadaImCapability.country, "MY");
  assert.equal(value.result?.lazadaImCapability.sellerId, "300872000183");
  assert.doesNotMatch(JSON.stringify(value.result), /new-im-access|new-im-refresh|commerce-access/);
});

test("different seller retains only recovery snapshot and never probes/activates", async () => {
  const value = await run({ ...tokenResponse, country_user_info: [
    { country: "my", seller_id: "999999", user_id: "100001" },
  ] });
  assert.match(String(value.error), /LAZADA_IM_SELLER_MISMATCH/);
  assert.deepEqual(value.events, ["begin", "refresh", "recovery"]);
});

test("missing IM identity cannot borrow commerce country grants", () => {
  assert.throws(() => lazadaImCredentialBinding(source, "my"), /IM_IDENTITY_REQUIRED/);
});

test("MY IM grant cannot authorize SG and commerce token changes do not alter IM binding", async () => {
  const value = await run();
  const payload = value.stages[1].payload;
  assert.throws(() => lazadaImCredentialBinding(payload, "sg"), /COUNTRY_GRANT_REQUIRED/);
  const before = lazadaImCredentialBinding(payload, "my");
  assert.deepEqual(lazadaImCredentialBinding({ ...payload, access_token: "changed-commerce" }, "my"), before);
  assert.notEqual(lazadaImCredentialBinding({ ...payload, im_access_token: "changed-im" }, "my").tokenFingerprint, before.tokenFingerprint);
  const binding = csCredentialBindingEvidence({ channel: "lazada", operation: "inquiries.list", credential: payload,
    request: { arguments: { sellerpilotLazadaCountry: "MY" } } });
  assert.equal(binding?.tokenFingerprint, before.tokenFingerprint);
  assert.deepEqual(binding?.targetFingerprints, [before.targetFingerprint]);
});

test("failed provider permission read cannot produce a capability proof", async () => {
  const value = await run(tokenResponse, "InsufficientPermission");
  assert.match(String(value.error), /PERMISSION_READ_FAILED/);
  assert.equal(value.result, undefined);
});

test("invalid expiry is retained for recovery but not activated", async () => {
  const value = await run({ ...tokenResponse, expires_in: 0 });
  assert.match(String(value.error), /TOKEN_EXPIRY_INVALID/);
  assert.deepEqual(value.events, ["begin", "refresh", "recovery"]);
});


test("refresh country list variant retains the same strict seller proof", async () => {
  const variant = { ...tokenResponse, country_user_info: undefined, country_user_info_list: tokenResponse.country_user_info };
  const value = await run(variant as unknown as typeof tokenResponse);
  assert.equal(value.error, undefined);
  assert.equal(value.result?.lazadaImCapability.sellerId, "300872000183");
});
test("conflicting country response fields remain in recovery and never gain a binding", async () => {
  const variant = { ...tokenResponse, country_user_info_list: [{ ...commerce.country_user_info[0], seller_id: "99999999" }] };
  const value = await run(variant);
  assert.match(String(value.error), /LAZADA_IM_IDENTITY_CONFLICT/);
  assert.equal(value.stages.length, 1);
  assert.equal(value.stages[0].recoveryOnly, true);
});
