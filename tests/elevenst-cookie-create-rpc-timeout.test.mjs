import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260905014700_extend_exact_elevenst_get_bind_rpc_timeout.sql",
  import.meta.url,
);
const sql = await readFile(migrationUrl, "utf8");

test("14700 keeps the global timeout and scopes 60 seconds to three exact 11st RPCs", () => {
  assert.match(sql, /Keep that global default/u);
  assert.equal((sql.match(/set statement_timeout = '60s'/gu) ?? []).length, 3);
  assert.match(sql, /sellerpilot_service_get_elevenst_cookie_create_recovery_status\(uuid\)/u);
  assert.match(sql, /sellerpilot_service_record_elevenst_cookie_create_observation\([\s\S]*uuid,text,text,integer,integer,boolean,boolean,text/u);
  assert.match(sql, /sellerpilot_service_bind_elevenst_cookie_create_observation\(uuid\)/u);
  assert.match(sql, /b9faa28e-a73f-4457-bb34-d643cf9a9a74/u);
  assert.match(sql, /9598600918/u);
  assert.match(sql, /AUTO-780720401E2D4E4EA45F/u);
  assert.match(sql, /elevenst_cookie_create_jobs_are_current\(\)/u);
  assert.doesNotMatch(sql, /alter role authenticator/iu);
  assert.doesNotMatch(sql, /insert\s+into\s+sellerpilot_private\.channel_gateway_jobs/iu);
  assert.doesNotMatch(sql, /update\s+sellerpilot_private\.channel_gateway_jobs/iu);
});
