import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { analyzeServerProductResearch, runOneServerProductResearch } from "../lib/server-product-research.ts";
import { analyzeServerStudioSources } from "../lib/server-product-studio.ts";
import { readSourceBytesBounded } from "./first-draft-image-lane.mjs";

const rpcActions = Object.freeze({
  sellerpilot_service_claim_product_research_ai_job: "claim",
  sellerpilot_service_touch_product_research_ai_job: "touch",
  sellerpilot_service_release_product_research_ai_job: "release",
  sellerpilot_service_complete_product_research_ai_job: "complete",
});
export async function runLocalProductResearchOnce({ api, invokeSegment }) {
  let claim = null;
  let directory = null;
  let timer = null;
  let heartbeatBusy = false;
  let lastHeartbeat = Date.now();
  let sourceUrls = null;
  const controller = new AbortController();
  const transport = async (action, arguments_, extra = {}) => {
    const response = await api("/api/ai/worker/research", { method: "POST", body: JSON.stringify({ action, arguments: arguments_, ...extra }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Local research ${action} HTTP ${response.status}`);
    return payload.data;
  };
  const identity = () => ({ p_job_id: claim.id, p_claim_token: claim.claim_token });
  const rpc = async (name, args) => {
    const action = rpcActions[name];
    if (!action) return { data: null, error: { code: "invalid_action" } };
    try {
      const data = await transport(action, args);
      if (action === "claim" && data) {
        claim = data;
        directory = await mkdtemp(join(tmpdir(), "sellerpilot-local-research-"));
        console.log(`[상품사진 분석 시작] ${claim.id} · Mac Codex · attempt=${claim.attempt_count}`);
        timer = setInterval(async () => {
          if (heartbeatBusy || controller.signal.aborted) return;
          heartbeatBusy = true;
          try {
            if (await transport("touch", identity()) !== "running") controller.abort(new Error("Research ownership lost"));
            else lastHeartbeat = Date.now();
          } catch {
            if (Date.now() - lastHeartbeat > 90_000) controller.abort(new Error("Research heartbeat unavailable"));
          } finally { heartbeatBusy = false; }
        }, 30_000);
      }
      return { data, error: null };
    } catch { return { data: null, error: { code: "research_transport_failed" } }; }
  };
  const touchOwnedClaim = async () => {
    if (await transport("touch", identity()) !== "running") throw new Error("Research ownership lost");
  };
  const generateStructured = async ({ schema, prompt, images, signal, tags }) => {
    const imageFiles = [];
    for (const source of images ?? []) {
      const file = join(directory, `${createHash("sha256").update(source.bytes).digest("hex")}.png`);
      await writeFile(file, source.bytes, { mode: 0o600 });
      imageFiles.push({ file });
    }
    const segmentId = `${tags?.[0]?.replace(/[^a-z0-9]/gi, "-") || "research"}-${createHash("sha256").update(prompt + imageFiles.map(i => i.file).join()).digest("hex").slice(0, 12)}`;
    const value = await invokeSegment({ touchOwnedClaim, jobDir: directory, schema: z.toJSONSchema(schema), segmentId, prompt, imageFiles, timeoutMs: 175_000, artifactAttempts: 1, reasoningEffort: "medium", jobId: claim.id, claimToken: claim.claim_token, leaseSignal: AbortSignal.any([signal, controller.signal]), stage: segmentId });
    return schema.parse(value);
  };
  try {
    const response = await runOneServerProductResearch({
      rpc, runtimeBudgetMs: 12 * 60_000, signal: controller.signal,
      analyzeSources: (sources, _dependencies, signal) => analyzeServerStudioSources(sources, { generateStructured }, signal, {
        callTimeoutMs: 180_000,
        onIdentity: details => console.log(`[상품사진 동일성] ${claim.id} · ${JSON.stringify(details)}`),
      }),
      analyze: (input, signal, dependencies) => analyzeServerProductResearch(input, signal, {
        ...dependencies,
        generate: async (prompt, callSignal) => {
          const schema = JSON.parse(await readFile("scripts/ai-product-research-output.schema.json", "utf8"));
          schema.properties.mode.const = "server-research";
          const result = await invokeSegment({ touchOwnedClaim, jobDir: directory, schema, segmentId: "product-research", prompt, timeoutMs: 175_000, artifactAttempts: 1, reasoningEffort: "medium", jobId: claim.id, claimToken: claim.claim_token, leaseSignal: callSignal, stage: "product-research" });
          return JSON.stringify(result);
        },
      }),
      download: async (path, signal) => {
        sourceUrls ??= transport("sources", identity());
        const entry = (await sourceUrls).find(item => item.path === path);
        if (!entry) throw new Error("Source path not authorized");
        return readSourceBytesBounded(await fetch(entry.url, { signal }));
      },
      upload: (path, bytes) => transport("upload", identity(), { path, bytes: Buffer.from(bytes).toString("base64") }),
      remove: paths => transport("remove", identity(), { paths }),
      logError: (stage, details) => console.error(`[상품사진 분석 오류] ${claim?.id ?? "claim"} · ${stage} · ${JSON.stringify(details)}`),
    });
    const outcome = await response.json();
    if (!response.ok) throw new Error(outcome.message || `Research HTTP ${response.status}`);
    if (claim) console.log(`[상품사진 분석 종료] ${claim.id} · ${JSON.stringify(outcome)}`);
    return outcome;
  } finally {
    if (timer) clearInterval(timer);
    controller.abort();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
