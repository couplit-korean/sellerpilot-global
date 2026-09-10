import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
  "utf8",
);
const ui = await readFile(
  new URL("../app/product-publish-workbench.tsx", import.meta.url),
  "utf8",
);

test("Coupang CREATE readiness precedes revision binding, fingerprint and claim", () => {
  const readiness = route.indexOf("buildCoupangCreateReadinessSource({");
  const durableSnapshot = route.indexOf(
    "sellerpilot_service_record_coupang_create_official_snapshot",
    readiness,
  );
  const bind = route.indexOf("bindCoupangCreateSourceRevision({", readiness);
  const fingerprint = route.indexOf("const baseRequestFingerprint", bind);
  const claim = route.indexOf('sellerpilot_claim_channel_operation', fingerprint);
  assert.ok(readiness > 0 && durableSnapshot > readiness && bind > durableSnapshot
    && fingerprint > bind && claim > fingerprint);
  const gate = route.indexOf('mode: "coupang_create_completeness_required"', readiness);
  assert.ok(gate > readiness && gate < bind);
  assert.match(route.slice(readiness, bind), /providerWritePerformed: false/);
  assert.match(route.slice(readiness, bind), /jobCreated: false/);
  assert.match(route.slice(durableSnapshot, bind), /officialReadSnapshotDigestSha256/u);
});

test("Coupang CREATE provider preparation is GET-only before claim", () => {
  const readiness = route.lastIndexOf("runWithProviderReadOnlyTransport", route.indexOf("buildCoupangCreateReadinessSource({"));
  const bind = route.indexOf("bindCoupangCreateSourceRevision({", readiness);
  const block = route.slice(readiness, bind);
  assert.equal((block.match(/method: "GET"/gu) ?? []).length, 4);
  assert.doesNotMatch(block, /method: "(?:POST|PUT|PATCH|DELETE)"/u);
  assert.match(block, /runWithProviderReadOnlyTransport/u);
  assert.match(block, /placeCodes:/u);
  assert.match(block, /return\/shipping-places\/center-code/u);
  assert.match(block, /returnCenterCodes:/u);
  assert.doesNotMatch(block, /pageNum: "1"|pageSize: "50"/u);
});

test("workbench renders the 19-row gate and blocks direct and bulk execution", () => {
  assert.match(ui, /<CoupangCreateCompletenessFields/u);
  assert.match(ui, /setCoupangCreateValidation/u);
  assert.match(ui, /const coupangSnapshotCurrent = coupangCreateValidation\.canBindCreateSourceRevision/u);
  assert.match(ui, /coupangValidatedDraft === \(drafts\.coupang \?\? ""\)/u);
  assert.match(ui, /const coupangCreateReady =/u);
  assert.match(ui, /&& coupangCreateReady/u);
  assert.match(ui, /\|\| coupangCompletenessBlocked \|\|/u);
  assert.match(ui, /coupangCompletenessBlocked \? "쿠팡 공식 등록 조건 확인 후 등록"/u);
  assert.match(ui, /credentialVersion=\{credential\?\.version\}/u);
  assert.match(ui, /observedTuple\.credentialVersion === credential\?\.version/u);
  assert.match(ui, /createCredentialVersion \? \{ credentialVersion: createCredentialVersion \}/u);
});

test("Coupang CREATE re-reads source, manifest and credential immediately before claim", () => {
  const preclaim = route.indexOf('mode: "coupang_create_source_changed_before_claim"');
  const claim = route.indexOf('sellerpilot_claim_channel_operation', preclaim);
  assert.ok(preclaim > 0 && claim > preclaim);
  const blockStart = route.lastIndexOf('if (channel === "coupang" && operation === "listing.create")', preclaim);
  const block = route.slice(blockStart, claim);
  assert.match(block, /sellerpilot_get_product_publish_context/u);
  assert.match(block, /approvedProductDetailManifestFromPublishContext/u);
  assert.match(block, /sellerpilot_list_credentials/u);
  assert.match(block, /sellerpilot_decrypt_credential/u);
  assert.match(block, /bindCoupangCreateSourceRevision/u);
  assert.match(block, /officialReadSnapshotId/u);
  assert.match(block, /officialReadSnapshotDigestSha256/u);
  assert.match(block, /canonicalJson\(rebound\[coupangCreateSourceRevisionArgument\]\)/u);
});
