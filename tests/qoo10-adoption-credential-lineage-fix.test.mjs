import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adoptionMigrationUrl = new URL(
  "../supabase/migrations/20260901173400_adopt_exact_qoo10_already_live_readback.sql",
  import.meta.url,
);
const lineageFixMigrationUrl = new URL(
  "../supabase/migrations/20260901173600_align_exact_qoo10_adoption_credential_lineage.sql",
  import.meta.url,
);

const oldPredicate =
  "v_credential.created_by is distinct from v_listing.owner_id";
const correctedPredicate =
  "v_credential.created_by is distinct from v_source.created_by";

test("Qoo10 adoption credential follows the exact release actor, not seller ownership", async () => {
  const [adoptionMigration, lineageFixMigration] = await Promise.all([
    readFile(adoptionMigrationUrl, "utf8"),
    readFile(lineageFixMigrationUrl, "utf8"),
  ]);

  assert.equal(adoptionMigration.split(oldPredicate).length - 1, 1);
  assert.equal(adoptionMigration.includes(correctedPredicate), false);

  assert.match(
    adoptionMigration,
    /v_source\.created_by is distinct from\s+'21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid/u,
  );
  assert.match(
    adoptionMigration,
    /v_listing\.owner_id is distinct from v_attempt\.owner_id/u,
  );
  assert.match(
    adoptionMigration,
    /v_credential\.seller_account_key is distinct from\s+v_listing\.seller_account_key/u,
  );

  assert.equal(lineageFixMigration.split(oldPredicate).length - 1, 1);
  assert.equal(lineageFixMigration.split(correctedPredicate).length - 1, 1);
  assert.match(
    lineageFixMigration,
    /pg_get_functiondef[\s\S]*pre-image mismatch[\s\S]*execute v_expected[\s\S]*post-image mismatch/u,
  );
  assert.match(
    lineageFixMigration,
    /procedure\.prosecdef[\s\S]*procedure\.provolatile = 'v'[\s\S]*procedure\.proconfig = array\['search_path=""'\]::text\[\]/u,
  );
  assert.match(
    lineageFixMigration,
    /without a provider call/u,
  );
});
