import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

const sqlPath = new URL("../supabase/migrations/20260908145334_cs_coupang_local_read_executor.sql", import.meta.url);
const patchPath = new URL("../docs/cs-parallel/proposals/coupang/patches/008-coupang-inquiries-local-executor.patch", import.meta.url);

test("Coupang live-read proposal widens only inquiries.list as read", async () => {
  const [sql, patch] = await Promise.all([
    readFile(sqlPath, "utf8"),
    readFile(patchPath, "utf8"),
  ]);

  assert.match(sql, /'coupang','inquiries\.list'[\s\S]*is distinct from 'read'/u);
  assert.match(sql, /'coupang','inquiries\.reply'[\s\S]*is not null/u);
  assert.match(sql, /'coupang','orders\.list'[\s\S]*is not null/u);
  assert.match(sql, /'coupang','shipment\.confirm'[\s\S]*is not null/u);
  assert.doesNotMatch(sql, /insert\s+into\s+sellerpilot_private\.local_channel_executor_routes/iu);
  assert.doesNotMatch(sql, /update\s+sellerpilot_private\.local_channel_executor_routes/iu);
  assert.doesNotMatch(sql, /delete\s+from\s+sellerpilot_private\.local_channel_executor_routes/iu);

  assert.match(patch, /^\+[ ]{2}"coupang:inquiries\.list",$/mu);
  assert.match(patch, /localChannelExecutorAccess\("coupang", "inquiries\.list"\), "read"/u);
  assert.match(patch, /isLocalChannelExecutorTuple\("coupang", "inquiries\.reply"\), false/u);
  assert.doesNotMatch(patch, /^\+.*coupang:(?:orders\.list|inquiries\.reply|shipment\.confirm|listing\.update)/mu);
  await execFileAsync("git", ["apply", "--reverse", "--check", fileURLToPath(patchPath)], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
  });
});

test("Coupang live-read proposal pins the observed production preimage", async () => {
  const sql = await readFile(sqlPath, "utf8");
  for (const digest of [
    "6b1f84d12642c644bf679af54d3f7d85",
    "51ffc1577c1e2636c11924fba65bf273",
    "3eb4ef53f44490f60892312a2c0a2731",
    "5ffadee0a3f1b1baa6ebcfe995c8d78b",
  ]) {
    assert.match(sql, new RegExp(digest, "u"));
  }
  assert.match(sql, /COUPANG_CS_LOCAL_READ_PREIMAGE_DRIFT/u);
  assert.match(sql, /COUPANG_CS_LOCAL_READ_POSTCONDITION_FAILED/u);
  assert.match(sql, /revoke all on function[\s\S]*from public,anon,authenticated,service_role/iu);
});
