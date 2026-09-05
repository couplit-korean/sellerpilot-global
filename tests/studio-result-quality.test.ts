import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspectStudioResultQuality } from "../lib/studio-result-quality";

test("the actual legacy catalog/copy warnings block publication even without raw provenance", () => {
  const quality = inspectStudioResultQuality({
    mode: "cli",
    warnings: [
      "외부 AI 문안 서비스의 최종 상세페이지 계약 불일치(studio_terminal_contract_invalid)로 판매자가 검수한 입력만 사용해 16개 상세 섹션을 안전하게 구성했습니다.",
      "외부 AI 이미지 처리의 요청 한도(gateway_rate_limited)로 사람이 승인한 1차 이미지 6장은 그대로 보존했습니다. 나머지 10장은 AI 생성 이미지가 아니라 원본 사진 기반 중립 카탈로그 이미지입니다.",
    ],
  });
  assert.equal(quality.status, "degraded");
  assert.equal(quality.blockedForPublication, true);
  assert.equal(quality.imageFallback, true);
  assert.equal(quality.copyFallback, true);
});

test("structured fallback and catalog provenance cannot be concealed with an empty warnings list", () => {
  assert.equal(inspectStudioResultQuality({ deterministic_fallback: { imageReason: "gateway_timeout" } }).imageFallback, true);
  assert.equal(inspectStudioResultQuality({ deterministic_fallback: { masterReason: "studio_terminal_contract_invalid" } }).copyFallback, true);
  assert.equal(inspectStudioResultQuality({ deterministic_fallback: { localizationReasons: ["gateway_rate_limited"] } }).copyFallback, true);
  assert.equal(inspectStudioResultQuality({ asset_audit_modes: { portrait: "source-photo-catalog" }, warnings: [] }).blockedForPublication, true);
});

test("normal review cautions and verified source-evidence roles are not fallback evidence", () => {
  const quality = inspectStudioResultQuality({
    warnings: ["게시 전 실물 표시사항을 다시 확인하세요.", "원산지는 판매자가 확인해야 합니다."],
    asset_audit_modes: { hero: "source-catalog", portrait: "scene-composite", "detail-care": "source-evidence" },
  });
  assert.equal(quality.blockedForPublication, false);
  assert.equal(quality.status, "not_flagged");
  assert.match(quality.message, /별도로 확인/);
});

test("missing legacy provenance is not relabeled as quality verified", () => {
  for (const value of [null, undefined, [], {}, { warnings: [null, 4, {}] }]) {
    const quality = inspectStudioResultQuality(value);
    assert.equal(quality.status, "not_flagged");
    assert.doesNotMatch(quality.message, /품질 통과|게시 준비 완료/);
  }
});

test("saved detail approval rejects degraded provenance before storage reads or save RPC", async () => {
  const route = await readFile(new URL("../app/api/admin/products/[id]/publish-context/route.ts", import.meta.url), "utf8");
  const put = route.slice(route.indexOf("export async function PUT"), route.indexOf("export async function PATCH"));
  const guard = put.indexOf("studioQuality.blockedForPublication");
  assert.ok(guard >= 0);
  assert.ok(guard < put.indexOf("detailBucket.download(asset.path)"));
  assert.ok(guard < put.indexOf('"sellerpilot_save_product_detail_page"'));
  assert.match(put, /STUDIO_DEGRADED_RESULT_REGENERATION_REQUIRED/);
  const preview = await readFile(new URL("../app/saved-product-detail-page.tsx", import.meta.url), "utf8");
  assert.match(preview, /&& !qualityBlocked/);
  assert.match(preview, /data-studio-quality="degraded"/);
  assert.doesNotMatch(preview, /운영 게시 준비 완료/);
});
