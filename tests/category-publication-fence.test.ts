import assert from "node:assert/strict";
import test from "node:test";
import {
  activeProductionCredentialMap,
  bindEbayCategoryTree,
  ebayCategoryInspectionArguments,
  selectActiveProductionCredential,
  type CredentialRow,
} from "../app/category-classification-workbench";

const production: CredentialRow = {
  id: "production-credential",
  channel: "ebay",
  environment: "production",
  status: "active",
};
const sandbox: CredentialRow = {
  id: "sandbox-credential",
  channel: "ebay",
  environment: "sandbox",
  status: "active",
};

test("category credentials always select the active production row even when sandbox sorts later", () => {
  const rows = [production, sandbox];
  assert.equal(selectActiveProductionCredential(rows, "ebay")?.id, production.id);
  assert.equal(activeProductionCredentialMap(rows).get("ebay")?.id, production.id);
  assert.equal(selectActiveProductionCredential([sandbox], "ebay"), undefined);
  assert.equal(activeProductionCredentialMap([sandbox]).has("ebay"), false);
});

test("category credential parsing rejects malformed and non-production RPC rows", () => {
  assert.equal(selectActiveProductionCredential([
    { ...production, status: "revoked" },
    { ...production, id: "preview", environment: "preview" },
    sandbox,
  ], "ebay"), undefined);
  assert.equal(selectActiveProductionCredential({ rows: [production] }, "ebay"), undefined);
});

test("eBay inspection keeps the provider tree bound to the selected marketplace", () => {
  const gb = bindEbayCategoryTree({ ok: true, remoteId: "3" }, "EBAY_GB");
  assert.deepEqual(gb, { marketplaceId: "EBAY_GB", categoryTreeId: "3" });
  assert.deepEqual(
    ebayCategoryInspectionArguments(" 183454 ", gb ?? undefined, "EBAY_GB"),
    { categoryId: "183454", categoryTreeId: "3" },
  );
  assert.equal(ebayCategoryInspectionArguments("183454", gb ?? undefined, "EBAY_DE"), null);
  assert.equal(bindEbayCategoryTree({ ok: true, remoteId: "" }, "EBAY_GB"), null);
  assert.equal(bindEbayCategoryTree({ ok: true, remoteId: "US-tree" }, "EBAY_US"), null);
});

test("eBay US tree zero remains valid but cannot be replayed for a non-US marketplace", () => {
  const us = bindEbayCategoryTree({ ok: true, remoteId: "0" }, "ebay_us");
  assert.deepEqual(
    ebayCategoryInspectionArguments("123", us ?? undefined, "EBAY_US"),
    { categoryId: "123", categoryTreeId: "0" },
  );
  assert.equal(ebayCategoryInspectionArguments("123", us ?? undefined, "EBAY_GB"), null);
});
