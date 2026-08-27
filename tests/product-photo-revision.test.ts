import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { productRevisionJobRequestSchema } from "../lib/ai-cli-contract";
import { recoverAmbiguousProductRevision } from "../lib/product-revision-recovery";
import { createRevisionPhotoSelectionFence, releaseStaleRevisionPhoto } from "../lib/product-revision-photo-fence";
import { verifyNormalizedStudioImages } from "../lib/studio-image-validation";
import { fetchJsonWithDeadline } from "../lib/bounded-json-request";
import { classifyExactJobAdmission } from "../lib/exact-job-admission";

const jobId = "078a8aa1-098a-4df0-bb50-d643db33b91a";

const manualFields = {
  researchInput: "https://example.com/products/revision-one",
  productName: "사진 리비전 검증 상품",
  sellerSku: "REVISION-001",
  categoryHint: "일반상품",
  brandName: "검증 브랜드",
  manufacturer: "검증 제조사",
  countryOfOrigin: "대한민국",
  material: "검증 소재",
  packageContents: "상품 1개",
  condition: "NEW" as const,
  gtinStatus: "NO_GTIN" as const,
  gtin: "",
  sellingPrice: 10000,
  currency: "KRW" as const,
  stock: 0,
  weightKg: 1,
  packageLengthCm: 10,
  packageWidthCm: 10,
  packageHeightCm: 10,
  shippingFeeKrw: 0,
  shippingRule: "기본 배송",
  packagingRule: "완충 포장",
  description: "같은 상품 원장에 사진과 상세페이지를 안전하게 교체하는 검증용 상품 설명입니다.",
  productUrl: "https://example.com/products/revision-one",
  imageRightsConfirmed: true,
  productFactsConfirmed: true,
};

function jpeg(width: number, height: number, type = "image/jpeg") {
  const bytes = new Uint8Array(24);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  bytes[7] = height >> 8;
  bytes[8] = height & 0xff;
  bytes[9] = width >> 8;
  bytes[10] = width & 0xff;
  bytes.set([0xff, 0xd9], 22);
  return new Blob([bytes], { type });
}

test("product photo revision accepts normalized main-first images and stock zero", () => {
  const result = productRevisionJobRequestSchema.safeParse({
    jobId,
    manualFields,
    imagePaths: [`owner/${jobId}/input/001.jpg`],
    imageSpecs: [{
      name: "main.png",
      role: "main",
      originalName: "main.png",
      originalBytes: 24,
      originalMediaType: "image/png",
      originalPath: `owner/${jobId}/original/001.source`,
      originalWidth: 1800,
      originalHeight: 1800,
      width: 1200,
      height: 1200,
      bytes: 24,
      mediaType: "image/jpeg",
      fit: "contain",
    }],
  });
  assert.ok(result.success);
  assert.equal(productRevisionJobRequestSchema.safeParse({
    ...result.data,
    imageSpecs: [{ ...result.data.imageSpecs[0], role: "front" }],
  }).success, false);
});

test("server image verification rejects wrong dimensions and MIME", async () => {
  assert.equal(await verifyNormalizedStudioImages(["valid"], async () => jpeg(1200, 1200)), true);
  assert.equal(await verifyNormalizedStudioImages(["wrong-size"], async () => jpeg(1199, 1200)), false);
  assert.equal(await verifyNormalizedStudioImages(["wrong-type"], async () => jpeg(1200, 1200, "image/png")), false);
});

test("server image verification bounds concurrency and streamed response bytes", async () => {
  let active = 0;
  let maximumActive = 0;
  const paths = Array.from({ length: 12 }, (_, index) => `image-${index}`);
  assert.equal(await verifyNormalizedStudioImages(paths, async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return jpeg(1200, 1200);
  }), true);
  assert.ok(maximumActive <= 3);

  const oversized = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2 * 1024 * 1024));
      controller.enqueue(new Uint8Array(2 * 1024 * 1024));
      controller.close();
    },
  }), { headers: { "content-type": "image/jpeg" } });
  assert.equal(await verifyNormalizedStudioImages(["oversized"], async () => oversized), false);
});

test("bounded JSON requests reject stalled fetch and body work without adopting late results", async () => {
  let finishFetch: ((response: Response) => void) | null = null;
  const lateFetch = fetchJsonWithDeadline({
    fetcher: async () => new Promise<Response>((resolve) => { finishFetch = resolve; }),
    input: "/late-fetch",
    parentSignal: new AbortController().signal,
    timeoutMs: 5,
    fallbackPayload: {},
  });
  await assert.rejects(lateFetch, (error: unknown) => error instanceof DOMException && error.name === "TimeoutError");
  (finishFetch as ((response: Response) => void) | null)?.(new Response("{}", { headers: { "content-type": "application/json" } }));

  let finishJson: ((value: unknown) => void) | null = null;
  const lateJson = fetchJsonWithDeadline({
    fetcher: async () => ({
      json: () => new Promise<unknown>((resolve) => { finishJson = resolve; }),
    }) as Response,
    input: "/late-json",
    parentSignal: new AbortController().signal,
    timeoutMs: 5,
    fallbackPayload: {},
  });
  await assert.rejects(lateJson, (error: unknown) => error instanceof DOMException && error.name === "TimeoutError");
  (finishJson as ((value: unknown) => void) | null)?.({ stale: true });
});

test("ambiguous submission recovery only adopts the exact job id", async () => {
  const checked: string[] = [];
  const recovered = await recoverAmbiguousProductRevision({
    jobId,
    signal: new AbortController().signal,
    attempts: 3,
    wait: async () => undefined,
    readState: async (candidate) => {
      checked.push(candidate);
      return checked.length === 1 ? null : { jobId: candidate, status: "pending" as const };
    },
  });
  assert.deepEqual(checked, [jobId, jobId]);
  assert.deepEqual(recovered, { jobId, status: "pending" });
});

test("exact job admission never treats a damaged or retryable response as a new-job rejection", () => {
  assert.equal(classifyExactJobAdmission({ status: 202, ok: true, requestedJobId: jobId, returnedJobId: jobId }), "accepted");
  for (const status of [408, 425, 429, 500, 503]) {
    assert.equal(classifyExactJobAdmission({ status, ok: false, requestedJobId: jobId }), "ambiguous");
  }
  assert.equal(classifyExactJobAdmission({ status: 202, ok: true, requestedJobId: jobId }), "ambiguous");
  assert.equal(classifyExactJobAdmission({ status: 202, ok: true, requestedJobId: jobId, returnedJobId: crypto.randomUUID() }), "ambiguous");
  assert.equal(classifyExactJobAdmission({ status: 400, ok: false, requestedJobId: jobId }), "rejected");
});

test("rapid mobile photo reselection revokes every stale decoded object URL", () => {
  const fence = createRevisionPhotoSelectionFence();
  const firstMain = fence.nextMain();
  const latestMain = fence.nextMain();
  const pendingRole = fence.nextRole("front");
  const pendingExtras = fence.nextExtras();
  const released: string[] = [];
  assert.equal(releaseStaleRevisionPhoto(fence.isCurrent(firstMain), "blob:old-main", (url) => released.push(url)), true);
  assert.equal(releaseStaleRevisionPhoto(fence.isCurrent(latestMain), "blob:latest-main", (url) => released.push(url)), false);
  fence.invalidateAll();
  assert.equal(releaseStaleRevisionPhoto(fence.isCurrent(pendingRole), "blob:old-role", (url) => released.push(url)), true);
  assert.equal(releaseStaleRevisionPhoto(fence.isCurrent(pendingExtras), "blob:old-extra", (url) => released.push(url)), true);
  const afterClear = fence.nextMain();
  fence.unmount();
  assert.equal(releaseStaleRevisionPhoto(fence.isCurrent(afterClear), "blob:unmounted", (url) => released.push(url)), true);
  fence.mount();
  const afterStrictModeReplay = fence.nextMain();
  assert.equal(fence.isCurrent(afterStrictModeReplay), true);
  assert.deepEqual(released, ["blob:old-main", "blob:old-role", "blob:old-extra", "blob:unmounted"]);
});

test("revision route and UI preserve uncertain uploads and query the exact job", async () => {
  const route = await readFile(new URL("../app/api/admin/products/[id]/revision/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const picker = await readFile(new URL("../app/product-revision-image-picker.tsx", import.meta.url), "utf8");
  const studio = await readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8");
  const regenerationRoute = await readFile(new URL("../app/api/ai/product-studio/regenerate/route.ts", import.meta.url), "utf8");
  assert.match(route, /searchParams\.get\("jobId"\)/);
  assert.match(route, /p_job_id: jobId\.data/);
  assert.match(route, /reconciliationRequired: true/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /sellerpilot_abandon_uncreated_product_revision_job/);
  assert.match(route, /const abandonAndCleanupIfUncreated = async/);
  assert.match(route, /if \(error \|\| !safeToRemove\) return false/);
  assert.match(route, /if \(!verified\.normalized\) \{[\s\S]*await abandonAndCleanupIfUncreated\(\)/);
  assert.match(route, /if \(!verified\.originals\) \{[\s\S]*await abandonAndCleanupIfUncreated\(\)/);
  assert.match(route, /export const maxDuration = 300/);
  assert.equal((route.match(/createSignedUrls\(/g) ?? []).length, 1);
  assert.match(route, /verifyPreservedStudioImages/);
  assert.doesNotMatch(page, /storage\.from\("sellerpilot-ai"\)\.remove/);
  assert.match(page, /\[408, 425, 429\]\.includes\(response\.status\) \|\| response\.status >= 500/);
  assert.match(page, /revision\?jobId=\$\{encodeURIComponent\(candidateJobId\)\}/);
  assert.match(page, /confirmationPending: true/);
  assert.match(page, /const retryScope = createPageAbortScope\(\[\], 30_000/);
  assert.match(page, /finally \{[\s\S]{0,100}retryScope\.dispose\(\)/);
  assert.match(page, /productRevisionMonitorMaximumAgeMs = 30 \* 60 \* 1_000/);
  assert.match(page, /const pollScope = createPageAbortScope\(\[signal\], 15_000/);
  assert.match(page, /status: "monitoring_deferred"/);
  assert.match(page, /onOpenActivity=\{\(\) => navigate\("registration-activity"\)\}/);
  assert.match(page, /authenticatedJsonWithDeadline/);
  assert.match(page, /const lifecycleController = new AbortController\(\)/);
  assert.doesNotMatch(page, /useState\(\(\) => new AbortController\(\)\)/);
  const saveStart = page.indexOf("const saveProductDetails = async");
  const inventoryPollStart = page.indexOf("if (!inventorySaving) return;", saveStart);
  const saveBody = page.slice(saveStart, inventoryPollStart);
  assert.match(saveBody, /\/revision`[\s\S]*controller\.signal,[\s\S]*90_000/);
  const acceptedRevisionPoint = saveBody.indexOf("if (!acceptedRevision) throw new Error");
  const revisionInventoryPoint = saveBody.indexOf("inventory-revision-${jobId}");
  assert.ok(acceptedRevisionPoint > 0 && revisionInventoryPoint > acceptedRevisionPoint);
  assert.doesNotMatch(saveBody.slice(0, acceptedRevisionPoint), /applyInventoryAcrossSafeBatches/);
  const inventoryPollBody = page.slice(inventoryPollStart, page.indexOf("const saveCommerceNotes", inventoryPollStart));
  assert.doesNotMatch(inventoryPollBody, /setInterval/);
  assert.match(inventoryPollBody, /authenticatedJsonWithDeadline/);
  assert.match(inventoryPollBody, /window\.setTimeout/);
  assert.match(inventoryPollBody, /15_000/);
  const regenerationBody = page.slice(page.indexOf("const regenerateDetailAsset"), page.indexOf("useEffect(() =>", page.indexOf("const regenerateDetailAsset")));
  assert.match(regenerationBody, /classifyExactJobAdmission/);
  assert.match(regenerationBody, /deduplicatedExistingJob[\s\S]*queued\.deduplicated === true/);
  assert.match(regenerationBody, /`\/api\/ai\/jobs\/\$\{monitoredJobId\}`/);
  assert.match(regenerationBody, /regenerationDeadline = deadlineAfter\(30 \* 60_000\)/);
  assert.match(regenerationBody, /Math\.min\(15_000, deadlineRemaining\(regenerationDeadline\)\)/);
  assert.match(studio, /getStudioSessionWithDeadline[\s\S]*AbortSignal\.timeout\(15_000\)/);
  assert.equal((studio.match(/createClient\(\)\.auth\.getSession\(\)/g) ?? []).length, 1);
  assert.match(studio, /if \(generating \|\| generateInFlightRef\.current\) return;[\s\S]*queuedOwnJobIdRef\.current[\s\S]*onRunningChange\(false\)/);
  assert.match(studio, /maximumAgeMs: 30 \* 60_000/);
  assert.match(studio, /uncertainRegenerationJobIdRef\.current[\s\S]*등록 진행 중·히스토리/);
  assert.match(studio, /disabled=\{Boolean\(regeneratingAssetId\) \|\| generating \|\| Boolean\(uncertainRegenerationJobId\)\}/);
  assert.match(studio, /fetchJsonWithStudioJobTimeout\([\s\S]*method: "PUT"[\s\S]*30_000/);
  assert.match(regenerationRoute, /deduplicated: data !== parsed\.data\.jobId/);
  assert.match(page, /photoSelectionFence\.nextMain\(\)/);
  assert.match(page, /photoSelectionFence\.nextRole\(slotId\)/);
  assert.match(page, /photoSelectionFence\.invalidateRole\(slotId\)/);
  assert.match(picker, /selectionFence\.mount\(\)/);
  assert.match(picker, /역할별 사진보다 대표사진을 먼저 선택해 주세요/);
  assert.match(picker, /추가 사진보다 대표사진을 먼저 선택해 주세요/);
  assert.match(picker, /id=\{`product-revision-\$\{role\.id\}-camera`\}[\s\S]{0,300}capture="environment"[\s\S]{0,300}disabled=\{roleDisabled\}[\s\S]{0,300}selectRole\(role\.id, event\)/);
  assert.match(picker, /id=\{`product-revision-\$\{role\.id\}`\}[\s\S]{0,300}disabled=\{roleDisabled\}[\s\S]{0,300}selectRole\(role\.id, event\)/);
  assert.match(picker, /aria-label=\{`\$\{role\.label\} 사진 촬영`\}/);
  assert.match(picker, /aria-label=\{`\$\{role\.label\} 사진 앨범에서 선택`\}/);
  assert.match(picker, /id="product-revision-extras-camera"[\s\S]{0,300}capture="environment"[\s\S]{0,300}disabled=\{extraInputDisabled\}[\s\S]{0,300}selectExtras\(event\)/);
  assert.match(picker, /id="product-revision-extras"[\s\S]{0,300}multiple[\s\S]{0,300}disabled=\{extraInputDisabled\}[\s\S]{0,300}selectExtras\(event\)/);
  assert.match(picker, /aria-label="추가 사진 촬영"/);
  assert.match(picker, /aria-label="추가 사진 앨범에서 선택"/);
  assert.match(picker, /const roleDisabled = disabled \|\| processing \|\| \(!photo && totalPhotoCount >= 100\)/);
  assert.match(picker, /const extraInputDisabled = disabled \|\| processing \|\| totalPhotoCount >= 100/);
});

test("revision migration uses product-first locks, full FK indexes, retention, and no marketplace enqueue", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260826090900_atomic_product_photo_revision.sql", import.meta.url), "utf8");
  assert.match(migration, /product_ai_revisions_product_time_idx[\s\S]*\(product_id, created_at desc\)/);
  assert.match(migration, /product_ai_revisions_base_job_idx[\s\S]*where base_ai_job_id is not null/);
  assert.match(migration, /product_ai_revisions_previous_job_idx[\s\S]*where previous_ai_job_id is not null/);
  const applyStart = migration.indexOf("create function sellerpilot_private.apply_product_ai_revision");
  const applyEnd = migration.indexOf("create or replace function sellerpilot_private.reconcile_product_after_ai_success", applyStart);
  const applyBody = migration.slice(applyStart, applyEnd);
  assert.ok(applyBody.indexOf("from sellerpilot_private.products product") < applyBody.indexOf("select revision.* into v_revision"));
  assert.match(applyBody, /interval '30 days'/);
  assert.match(applyBody, /listing_count_preserved/);
  assert.doesNotMatch(applyBody, /channel_gateway_jobs|sellerpilot_enqueue_channel_gateway_job/);
  assert.match(migration, /delete from sellerpilot_private\.ai_job_completion_receipts/);
  assert.match(migration, /base_product_edit_fingerprint/);
  assert.match(migration, /product_facts_without_stock/);
  assert.match(migration, /job\.created_by = auth\.uid\(\) or job\.kind = 'product_studio'/);
  assert.match(migration, /create or replace function public\.sellerpilot_get_ai_job[\s\S]*job\.created_by = auth\.uid\(\) or job\.kind = 'product_studio'/);
  assert.match(migration, /sellerpilot_private\.reconcile_product_from_ai\([\s\S]*v_job_created_by/);
  assert.match(migration, /product_ai_revision_abandoned_jobs/);
  assert.match(migration, /job\.request_payload[\s\S]*- 'revision_base_product_updated_at'[\s\S]*= p_request_payload/);
});

test("mobile edit picker keeps representative photo full-width and roles in a 2-column grid", async () => {
  const [css, commerceCss] = await Promise.all([
    readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8"),
    readFile(new URL("../app/commerce-ux-refactor.css", import.meta.url), "utf8"),
  ]);
  assert.match(css, /\.product-revision-images\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.product-revision-role-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.product-revision-role-grid > div > button,[\s\S]*width:\s*44px;\s*height:\s*44px/);
  assert.match(commerceCss, /\.product-revision-source-actions\.two-way\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(commerceCss, /\.product-revision-role-grid label\.product-revision-source-choice\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.product-revision-source-actions > label,[\s\S]{0,180}min-height:\s*48px/);
});
