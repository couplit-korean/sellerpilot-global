import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reconcileSmartstoreSnapshot } from "../lib/cs/channels/smartstore/reconciliation.ts";

const defaultFixture = fileURLToPath(new URL("../tests/fixtures/cs/smartstore/live-zero-reconciliation-v2.json", import.meta.url));
const inputPath = resolve(process.argv[2] ?? defaultFixture);
const raw = await readFile(inputPath, "utf8");
const forbiddenKeys = /(?:secret|token|password|customerBody|inquiryContent|answerContent)/i;
const snapshot = JSON.parse(raw);

function assertSafe(value, path = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) throw new Error(`SMARTSTORE_RECONCILIATION_SENSITIVE_FIELD:${path}.${key}`);
    assertSafe(child, `${path}.${key}`);
  }
}

assertSafe(snapshot);
const result = reconcileSmartstoreSnapshot(snapshot);
process.stdout.write(`${JSON.stringify({ inputPath, ...result }, null, 2)}\n`);
