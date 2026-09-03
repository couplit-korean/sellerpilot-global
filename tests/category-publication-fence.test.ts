import assert from "node:assert/strict";
import test from "node:test";
import {
  activeProductionCredentialMap,
  bindEbayCategoryTree,
  ebayCategoryInspectionArguments,
  resolveEbayCategoryInspection,
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

test("eBay manual inspection bootstraps a fresh tree for the current marketplace", async () => {
  const calls: Record<string, unknown>[] = [];
  const resolved = await resolveEbayCategoryInspection({
    categoryId: " 20473 ",
    marketplaceId: "EBAY_US",
    query: " Lotte Sand Milk Biscuit 315g ",
    bootstrap: async (arguments_) => {
      calls.push(arguments_);
      return { ok: true, remoteId: "0" };
    },
  });

  assert.deepEqual(calls, [{
    query: "Lotte Sand Milk Biscuit 315g",
    marketplaceId: "EBAY_US",
    categoryTreeId: "",
  }]);
  assert.deepEqual(resolved, {
    arguments: { categoryId: "20473", categoryTreeId: "0" },
    binding: { marketplaceId: "EBAY_US", categoryTreeId: "0" },
  });
});

test("eBay manual inspection reuses only a current-market in-memory binding", async () => {
  let calls = 0;
  const resolved = await resolveEbayCategoryInspection({
    categoryId: "20473",
    binding: { marketplaceId: "EBAY_US", categoryTreeId: "0" },
    marketplaceId: "EBAY_US",
    query: "Lotte Sand Milk Biscuit 315g",
    bootstrap: async () => {
      calls += 1;
      return { ok: true, remoteId: "3" };
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(resolved.arguments, { categoryId: "20473", categoryTreeId: "0" });
});

test("eBay manual inspection replaces a stale-market binding with provider readback", async () => {
  const resolved = await resolveEbayCategoryInspection({
    categoryId: "20473",
    binding: { marketplaceId: "EBAY_GB", categoryTreeId: "3" },
    marketplaceId: "EBAY_US",
    query: "Lotte Sand Milk Biscuit 315g",
    bootstrap: async () => ({ ok: true, remoteId: "0" }),
  });

  assert.deepEqual(resolved.binding, { marketplaceId: "EBAY_US", categoryTreeId: "0" });
  assert.deepEqual(resolved.arguments, { categoryId: "20473", categoryTreeId: "0" });
});

test("eBay manual inspection fails closed when bootstrap has no provider tree", async () => {
  await assert.rejects(
    resolveEbayCategoryInspection({
      categoryId: "20473",
      marketplaceId: "EBAY_US",
      query: "Lotte Sand Milk Biscuit 315g",
      bootstrap: async () => ({ ok: true, remoteId: "" }),
    }),
    /공식 카테고리 트리를 확인하지 못했습니다/,
  );
});
