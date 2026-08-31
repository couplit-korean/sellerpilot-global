import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260831131000_competitor_match_review_ledger.sql", import.meta.url);
const routeUrl = new URL("../app/api/admin/competitor-prices/reviews/route.ts", import.meta.url);
const uiUrl = new URL("../app/_publishing/competitor-price-v3-ui.tsx", import.meta.url);

test("review API is admin-authenticated, user-scoped, fenced, and never performs a commerce mutation", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /authenticateAdminRequest\(request/);
  assert.match(route, /admin\.userClient\.rpc\("sellerpilot_review_competitor_match"/);
  assert.match(route, /admin\.userClient\.rpc\("sellerpilot_get_competitor_match_review_history"/);
  assert.doesNotMatch(route, /serviceClient\.rpc|SUPABASE_SECRET_KEY|sellerpilot_(?:save|publish|update).*price/iu);
  for (const fence of [
    "p_expected_fingerprint",
    "p_expected_checked_at",
    "p_expected_latest_review_id",
    "p_request_id",
  ]) assert.match(route, new RegExp(fence));
  assert.match(route, /status: 409/);
  assert.match(route, /NO_STORE_HEADERS/);
});

test("UI permits review only for persisted probable observations and applies server readback", async () => {
  const ui = await readFile(uiUrl, "utf8");
  assert.match(ui, /!compact[\s\S]{0,120}Boolean\(productId\)/);
  assert.match(ui, /item\.automatedMatchTier === "probable"/);
  assert.match(ui, /typeof item\.observationId === "string"/);
  assert.match(ui, /override\.review\.sourceObservationFingerprint !== item\.observationFingerprint/);
  assert.match(ui, /serverLatestReviewId !== override\.baseLatestReviewId/);
  assert.match(ui, /serverLatestReviewId !== override\.review\.id/);
  assert.match(ui, /expectedFingerprint: item\.observationFingerprint/);
  assert.match(ui, /expectedCheckedAt: item\.checkedAt/);
  assert.match(ui, /expectedLatestReviewId: item\.latestHumanReview\?\.id \?\? null/);
  assert.match(ui, /const \[requestId\] = useState\(\(\) => crypto\.randomUUID\(\)\)/);
  assert.match(ui, /signal: AbortSignal\.timeout\(15_000\)/);
  assert.match(ui, /onClick=\{\(\) => setSourceLinkOpened\(true\)\}/);
  assert.match(ui, /reason === "source_opened" && !sourceLinkOpened/);
  assert.match(ui, /reviewReasonCodesMatchDecision\(value\.decision/);
  assert.match(ui, /!saved\.latestForSource/);
  assert.match(ui, /if \(!response\.ok\)[\s\S]{0,1400}onSaved\(\{ \.\.\.saved, sourceCurrent: true \}\)/);
  assert.doesNotMatch(ui, /onApplyPrice|applyCompetitorPrice|updateListingPrice/);
});

test("one forward migration owns the immutable review ledger and effective-tier projection", async () => {
  const migrationNames = (await readdir(new URL("../supabase/migrations/", import.meta.url)))
    .filter((name) => name.includes("competitor_match_review"));
  assert.deepEqual(migrationNames, ["20260831131000_competitor_match_review_ledger.sql"]);
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /source_snapshot jsonb not null/);
  assert.match(migration, /source_snapshot_sha256 text not null/);
  assert.match(migration, /before update or delete on sellerpilot_private\.competitor_match_review_events/);
  assert.match(migration, /p_expected_latest_review_id is distinct from v_latest\.id/);
  assert.match(migration, /observation_fingerprint is distinct from p_expected_fingerprint/);
  assert.match(migration, /review\.source_observation_fingerprint = observation\.observation_fingerprint/);
  assert.match(migration, /then 'exact'[\s\S]{0,180}then 'rejected'[\s\S]{0,120}else observation\.match_tier/);
  assert.match(migration, /p_reason_codes <> '\["review_withdrawn"\]'::jsonb/);
  const reviewRpc = migration.slice(
    migration.indexOf("create or replace function public.sellerpilot_review_competitor_match"),
    migration.indexOf("create or replace function public.sellerpilot_get_competitor_match_review_history"),
  );
  assert.ok(
    reviewRpc.indexOf("for update;") < reviewRpc.indexOf("'latestForSource'"),
    "idempotent leaf readback must happen only after the product lock",
  );
  assert.doesNotMatch(migration, /update sellerpilot_private\.competitor_match_review_events|delete from sellerpilot_private\.competitor_match_review_events/);
});
