import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

test("the actual integrated route keeps request-window checks while selecting checkpoint v3 and enqueue v6", async () => {
  const route = await readFile(new URL("../app/api/admin/cs/channels/smartstore/history-resume-v5/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(route, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "history-resume-v5/route.ts", reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  assert.match(route, /sellerpilot-smartstore-history-checkpoint\/3/);
  assert.match(route, /same_succeeded_run_both_kinds_exact_full_kst_day_coverage/);
  assert.match(route, /sellerpilot_next_smartstore_history_window_v3/);
  assert.match(route, /sellerpilot_start_smartstore_inquiry_history_window_v6/);
  assert.match(route, /next\.key !== `smartstore:history:v3:/);
  assert.match(route, /inconsistent checkpoint/);
  assert.match(route, /totalWindowCount !== Math\.ceil\(totalDays \/ 30\)/);
  assert.doesNotMatch(route, /sellerpilot_next_smartstore_history_window_v2/);
  assert.doesNotMatch(route, /sellerpilot_start_smartstore_inquiry_history_window_v5/);
});
