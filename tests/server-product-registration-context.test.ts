import assert from "node:assert/strict";
import test from "node:test";
import type { AdminApiContext } from "../lib/admin-api";
import {
  PRODUCT_REGISTRATION_CONTEXT_RPC,
  productRegistrationContextFromRead,
  readProductRegistrationContext,
} from "../lib/server-product-registration-context";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER_ID = "10000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "20000000-0000-4000-8000-000000000001";
const JOB_ID = "30000000-0000-4000-8000-000000000001";
const CLAIM_ID = "40000000-0000-4000-8000-000000000001";

function context(overrides: Record<string, unknown> = {}) {
  return {
    contract: "sellerpilot_product_registration_context_v1",
    contextMode: "editing_only",
    ownerId: OWNER_ID,
    product: {
      id: PRODUCT_ID,
      externalCode: "EXTERNAL",
      sku: "SKU",
      name: "상품",
      description: "설명",
      sourceUrl: null,
      status: "draft",
    },
    manualFields: {},
    imageSpecs: [{ originalPath: `${OWNER_ID}/${JOB_ID}/original/001.source` }],
    sourceImagePaths: [`${OWNER_ID}/${JOB_ID}/input/001.jpg`],
    generatedImagePaths: {
      hero: `results/${JOB_ID}/claims/${CLAIM_ID}/hero.png`,
    },
    localizedListings: [],
    assignments: [{
      channel: "smartstore",
      environment: "production",
      market: "KR",
      categoryId: "50022679",
      categoryPath: ["생활"],
      providedAttributes: { color: "white", sizes: ["S", "M"] },
      requiredAttributes: [],
      officialMetadata: {},
    }],
    listings: [{ id: "50000000-0000-4000-8000-000000000001", channel: "smartstore", market: "KR", targetId: "" }],
    detailPage: { data: null, version: 0, approvedVersion: 0, imageManifest: null },
    contentMode: "ai_generated",
    detailAssetSource: "ai_generated",
    studioResult: {},
    studioJob: { id: JOB_ID, kind: "product_studio", status: "failed" },
    ...overrides,
  };
}

function adminWith(result: { data: unknown; error: { message?: string } | null } | Error) {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  const admin = {
    user: { id: OWNER_ID },
    serviceClient: {
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push({ name, parameters });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  } as unknown as AdminApiContext;
  return { admin, calls };
}

test("helper binds the service read to the authenticated owner and product", async () => {
  const fixture = adminWith({ data: context(), error: null });
  const result = await readProductRegistrationContext(fixture.admin, PRODUCT_ID);
  assert.equal((result.product as Record<string, unknown>).id, PRODUCT_ID);
  assert.deepEqual(fixture.calls, [{
    name: PRODUCT_REGISTRATION_CONTEXT_RPC,
    parameters: { p_owner_id: OWNER_ID, p_product_id: PRODUCT_ID },
  }]);
});

test("helper rejects cross-owner source paths before a route can sign them", () => {
  assert.throws(
    () => productRegistrationContextFromRead(context({
      sourceImagePaths: [`${OTHER_OWNER_ID}/${JOB_ID}/input/001.jpg`],
    }), OWNER_ID, PRODUCT_ID),
    /PRODUCT_REGISTRATION_CONTEXT_SOURCE_PATH_INVALID/,
  );
  assert.throws(
    () => productRegistrationContextFromRead(context({
      generatedImagePaths: { hero: `results/not-a-job/claims/${CLAIM_ID}/hero.png` },
    }), OWNER_ID, PRODUCT_ID),
    /PRODUCT_REGISTRATION_CONTEXT_GENERATED_PATH_INVALID/,
  );
});

test("helper rejects malformed metadata and mismatched identity", () => {
  assert.throws(
    () => productRegistrationContextFromRead(context({ ownerId: OTHER_OWNER_ID }), OWNER_ID, PRODUCT_ID),
    /PRODUCT_REGISTRATION_CONTEXT_INVALID/,
  );
  assert.throws(
    () => productRegistrationContextFromRead(context({
      assignments: [{
        channel: "smartstore",
        environment: "production",
        market: "KR",
        categoryId: "50022679",
        categoryPath: [],
        providedAttributes: { unsafe: 1 },
        requiredAttributes: [],
        officialMetadata: {},
      }],
    }), OWNER_ID, PRODUCT_ID),
    /PRODUCT_REGISTRATION_CONTEXT_INVALID/,
  );
});

test("helper sanitizes backend failures and preserves stable contract failures", async () => {
  const secretFailure = adminWith(new Error("private database URL"));
  await assert.rejects(
    readProductRegistrationContext(secretFailure.admin, PRODUCT_ID),
    /PRODUCT_REGISTRATION_CONTEXT_UNAVAILABLE/,
  );
  const stableFailure = adminWith({
    data: null,
    error: { message: "PRODUCT_REGISTRATION_CONTEXT_SOURCE_JOB_OWNER_MISMATCH: details" },
  });
  await assert.rejects(
    readProductRegistrationContext(stableFailure.admin, PRODUCT_ID),
    /PRODUCT_REGISTRATION_CONTEXT_SOURCE_JOB_OWNER_MISMATCH/,
  );
});
