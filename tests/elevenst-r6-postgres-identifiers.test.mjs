import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrations = [
  "20260910014500_elevenst_credential_version_cas.sql",
  "20260910022500_elevenst_new_product_server_sources.sql",
  "20260910030000_elevenst_new_product_source_approval.sql",
  "20260910031600_elevenst_new_product_source_readback.sql",
  "20260910031700_elevenst_new_product_execution_cas.sql",
  "20260910043000_elevenst_final_body_recovery_and_lock_order_r4.sql",
  "20260910044500_elevenst_recovery_observation_and_identifier_hardening_r6.sql",
];

function scanSource(source) {
  const output = [...source];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("--", index)) {
      const end = source.indexOf("\n", index + 2);
      const stop = end < 0 ? source.length : end;
      for (let cursor = index; cursor < stop; cursor += 1) output[cursor] = " ";
      index = stop;
      continue;
    }
    if (source[index] === "'") {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "'" && source[cursor + 1] === "'") cursor += 2;
        else if (source[cursor] === "'") { cursor += 1; break; }
        else cursor += 1;
      }
      for (let blank = index; blank < cursor; blank += 1) output[blank] = " ";
      index = cursor;
      continue;
    }
    if (source[index] === "$") {
      const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(source.slice(index));
      if (delimiter) {
        for (let cursor = index; cursor < index + delimiter[0].length; cursor += 1) output[cursor] = " ";
        index += delimiter[0].length;
        continue;
      }
    }
    index += 1;
  }
  return output.join("");
}

function identifiers(source) {
  const sql = scanSource(source);
  return [...sql.matchAll(/"(?:""|[^"])+"|[A-Za-z_][A-Za-z0-9_$]*/gu)]
    .map((match) => match[0].startsWith('"')
      ? match[0].slice(1, -1).replaceAll('""', '"')
      : match[0]);
}

test("all r6 cumulative SQL bare and quoted identifiers fit PostgreSQL 63-byte storage", async () => {
  for (const migration of migrations) {
    const source = await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8");
    const violations = identifiers(source)
      .filter((identifier) => Buffer.byteLength(identifier, "utf8") > 63);
    assert.deepEqual(violations, [], migration);
  }
});

test("r6 names the exact previously truncated catalog objects before short renames", async () => {
  const source = await readFile(new URL(
    "../supabase/migrations/20260910044500_elevenst_recovery_observation_and_identifier_hardening_r6.sql",
    import.meta.url,
  ), "utf8");
  assert.equal(Buffer.byteLength(
    "sellerpilot_100317_elevenst_source_readback_before_execution_cas",
  ), 64);
  assert.equal(Buffer.byteLength(
    "product_category_assignments_one_elevenst_production_confirmed_idx",
  ), 66);
  assert.match(source, /sellerpilot_100317_elevenst_source_readback_before_execution_ca/u);
  assert.match(source, /product_category_assignments_one_elevenst_production_confirmed_/u);
  assert.match(source, /sellerpilot_100445_11st_source_readback_pre_cas/u);
  assert.match(source, /product_cat_one_11st_prod_confirmed_uidx/u);
  assert.equal(Buffer.byteLength("sellerpilot_100445_11st_source_readback_pre_cas"), 47);
  assert.equal(Buffer.byteLength("product_cat_one_11st_prod_confirmed_uidx"), 40);
});
