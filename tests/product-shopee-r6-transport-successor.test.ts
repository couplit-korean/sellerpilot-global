import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertShopeeSgExactOneFullDraft,
  bindShopeeSgCreateTransportPayload,
  bindShopeeSgTransportBytes,
  bindShopeeSgWarehouseEligibleShopTransport,
  bindShopeeSgWarehouseListTransport,
  canonicalShopeeSgObjectSha256,
  parseShopeeSgTransportBody,
} from "../lib/product-registration/shopee/transport-json";

test("r6 hashes the exact JSON byte string the transport sends, not a canonical object", () => {
  const sentBody = { z_last: 1, a_first: 2, seller_stock: [{ location_id: "SG-LOC", stock: 3 }] };
  const transport = bindShopeeSgTransportBytes(sentBody);
  const canonicalSha = canonicalShopeeSgObjectSha256(sentBody);
  const sentSha = createHash("sha256").update(JSON.stringify(sentBody), "utf8").digest("hex");
  assert.equal(transport.bytes, JSON.stringify(sentBody));
  assert.equal(transport.sha256, sentSha);
  assert.notEqual(transport.sha256, canonicalSha);
  assert.deepEqual(parseShopeeSgTransportBody(transport), sentBody);
  const reordered = { a_first: 2, seller_stock: sentBody.seller_stock, z_last: 1 };
  assert.equal(canonicalShopeeSgObjectSha256(reordered), canonicalSha);
  assert.notEqual(bindShopeeSgTransportBytes(reordered).bytes, transport.bytes);
});

test("r6 create payload digest binds one global and one local transport byte string", () => {
  const globalBody = { b: 1, a: 2 };
  const localBody = { shop_id: "1719148844", item: { item_name: "Lotte" } };
  const bound = bindShopeeSgCreateTransportPayload({ globalBody, localBody });
  assert.equal(bound.global.bytes, JSON.stringify(globalBody));
  assert.equal(bound.local.bytes, JSON.stringify(localBody));
  assert.notEqual(bound.global.sha256, canonicalShopeeSgObjectSha256(globalBody));
  const combined = `${bound.global.bytes.length}:${bound.global.bytes}\n${bound.local.bytes.length}:${bound.local.bytes}`;
  assert.equal(
    bound.payloadSha256,
    createHash("sha256").update(combined, "utf8").digest("hex"),
  );
});

test("r6 warehouse list transport rejects the warehouse_type body bypass", () => {
  const allowed = bindShopeeSgWarehouseListTransport({
    cursor: { next_id: 0, page_size: 30 },
  });
  assert.equal(allowed.bytes, JSON.stringify({ cursor: { next_id: 0, page_size: 30 } }));
  assert.equal(JSON.parse(allowed.bytes).warehouse_type, undefined);
  assert.throws(
    () => bindShopeeSgWarehouseListTransport({
      warehouse_type: 1,
      cursor: { next_id: 0, page_size: 30 },
    }),
    /SHOPEE_SG_WAREHOUSE_LIST_BODY_FORBIDDEN/u,
  );
  const eligible = bindShopeeSgWarehouseEligibleShopTransport({
    warehouse_id: 9001,
    warehouse_type: 1,
    cursor: { next_id: 0, page_size: 30 },
  });
  assert.equal(JSON.parse(eligible.bytes).warehouse_id, 9001);
  assert.throws(
    () => bindShopeeSgWarehouseEligibleShopTransport({
      warehouse_id: 9001,
      warehouse_type: 1,
      cursor: { next_id: 0, page_size: 30 },
      location_id: "TWS03",
    }),
    /SHOPEE_SG_WAREHOUSE_ELIGIBILITY_BODY_FORBIDDEN/u,
  );
});

test("r6 rejects one matching full draft plus a stale or conflicting current draft", () => {
  const full = {
    kind: "publish",
    data: {
      common: { fields: { productName: "Lotte Sand" }, quantity: 3, globalBaseUsdPrice: 20 },
      channels: { sg: { categoryId: "100787" } },
    },
  };
  assert.equal(assertShopeeSgExactOneFullDraft([full]), full);
  assert.throws(
    () => assertShopeeSgExactOneFullDraft([
      full,
      { kind: "publish", data: { common: { fields: { productName: "stale" } }, channels: { sg: {} } } },
    ]),
    /SHOPEE_SG_FULL_DRAFT_CARDINALITY/u,
  );
  assert.throws(
    () => assertShopeeSgExactOneFullDraft([
      full,
      { kind: "publish", data: { common: { fields: { productName: "conflict" }, quantity: 9, globalBaseUsdPrice: 1 }, channels: { sg: { categoryId: "100000" } } } },
    ]),
    /SHOPEE_SG_FULL_DRAFT_CARDINALITY/u,
  );
  assert.throws(
    () => assertShopeeSgExactOneFullDraft([]),
    /SHOPEE_SG_FULL_DRAFT_CARDINALITY/u,
  );
});
