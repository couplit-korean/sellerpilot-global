import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const studio = await readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8");

test("AI final authoring requires the exact first-draft research job before uploads", () => {
  assert.match(studio, /sourceResearchJobId: string;/);
  assert.match(studio, /const normalizedSourceResearchJobId = sourceResearchJobId\?\.trim\(\) \?\? "";/);
  const generateStart = studio.indexOf("const generate = useCallback");
  const lineageGuard = studio.indexOf("if (!manualMvp && !normalizedSourceResearchJobId)", generateStart);
  const firstUpload = studio.indexOf("optimizeAndUploadStudioPhotos(", lineageGuard);
  assert.ok(lineageGuard >= 0 && lineageGuard < firstUpload, "lineage must fail closed before any photo upload");
  assert.match(studio, /JSON\.stringify\(\{ jobId, sourceResearchJobId: normalizedSourceResearchJobId,/);
});

test("MVP copy distinguishes six setting shots, support assets, and internal draft from publication", () => {
  assert.match(studio, /핵심 생활 설정샷 6개 · 대표\/근거 보조 자산 10개/);
  assert.match(studio, /상세페이지 AI 초안\/내부 draft를 준비했습니다\. 외부 채널에는 게시하지 않았습니다\./);
  assert.match(studio, /이는 AI 초안 완료가 아니며, AI 생성 없이/);
});
