import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as zod from "zod";

const source = await readFile(
  new URL("../app/api/admin/products/[id]/publish-context/route.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "20000000-0000-4000-8000-000000000001";
const JOB_ID = "30000000-0000-4000-8000-000000000001";
const CLAIM_ID = "40000000-0000-4000-8000-000000000001";

type RouteExports = {
  GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response>;
};

type FixtureOptions = {
  strictContext?: Record<string, unknown>;
  strictError?: string;
  registrationContext?: Record<string, unknown>;
  registrationError?: string;
  publishedData?: Record<string, unknown> | null;
  publishedError?: { message: string } | null;
};

function assignment(metadata = true) {
  return {
    channel: "smartstore",
    environment: "production",
    market: "KR",
    categoryId: "50022679",
    categoryPath: ["생활", "주방"],
    providedAttributes: { color: "white", sizes: ["S", "M"] },
    status: "confirmed",
    confirmedAt: "2026-09-07T01:00:00+00:00",
    ...(metadata ? {
      requiredAttributes: [{ id: "color", required: true }],
      officialMetadata: { source: "provider-readback", leaf: true },
    } : {}),
  };
}

function editableContext(overrides: Record<string, unknown> = {}) {
  return {
    contract: "sellerpilot_product_registration_context_v1",
    contextMode: "editing_only",
    ownerId: OWNER_ID,
    product: {
      id: PRODUCT_ID,
      externalCode: "EXT-001",
      sku: "SKU-001",
      name: "편집 가능한 상품",
      description: "설명",
      sourceUrl: null,
      status: "draft",
    },
    manualFields: { sellingPriceKrw: 12900 },
    imageSpecs: [],
    sourceImagePaths: [`${OWNER_ID}/${JOB_ID}/input/001.jpg`],
    generatedImagePaths: {
      hero: `results/${JOB_ID}/claims/${CLAIM_ID}/hero.png`,
    },
    localizedListings: [],
    assignments: [assignment()],
    listings: [],
    detailPage: { data: null, version: 2, approvedVersion: 1, imageManifest: null },
    contentMode: "ai_generated",
    detailAssetSource: "ai_generated",
    studioResult: { productName: "편집 가능한 상품" },
    ...overrides,
  };
}

function approvedContext() {
  return {
    verifiedMarker: "strict-approved",
    ownerId: OWNER_ID,
    product: { id: PRODUCT_ID, name: "승인된 상품", status: "ready" },
    manualFields: { sellingPriceKrw: 12900 },
    imageSpecs: [],
    sourceImagePaths: [`${OWNER_ID}/${JOB_ID}/input/approved.jpg`],
    generatedImagePaths: {
      hero: `results/${JOB_ID}/claims/${CLAIM_ID}/approved-hero.png`,
    },
    localizedListings: [{ channel: "smartstore", title: "승인된 상품" }],
    assignments: [assignment(false)],
    listings: [{ channel: "smartstore", status: "draft" }],
    detailPage: { data: { root: {}, content: [] }, version: 2, approvedVersion: 2 },
    studioResult: { productName: "승인된 상품" },
    externalDetailImport: {
      status: "approved",
      approvedProductUpdatedAt: "2026-09-07T01:00:00+00:00",
    },
  };
}

async function run(url: string, options: FixtureOptions = {}) {
  const signed: Array<{ bucket: string; paths: string[] }> = [];
  const registrationCalls: string[] = [];
  const strictCalls: string[] = [];
  const userRpcCalls: string[] = [];
  const registration = options.registrationContext ?? editableContext();

  const serviceClient = {
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrls(paths: string[]) {
            signed.push({ bucket, paths });
            return {
              data: paths.map((path) => ({ signedUrl: `https://signed.invalid/${encodeURIComponent(path)}` })),
              error: null,
            };
          },
        };
      },
    },
  };
  const userClient = {
    async rpc(name: string) {
      userRpcCalls.push(name);
      if (name === "sellerpilot_get_product_publish_context") {
        return {
          data: options.publishedData ?? null,
          error: options.publishedError ?? { message: "not publishable" },
        };
      }
      if (name === "sellerpilot_get_product_operations_v2") {
        return { data: { productId: PRODUCT_ID, orders: [] }, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  const admin = {
    user: { id: OWNER_ID },
    userClient,
    serviceClient,
  };

  const sandbox = vm.createContext({
    exports: {},
    Request,
    Response,
    URL,
    TextEncoder,
    Buffer,
    Error,
    require(name: string) {
      if (name === "node:crypto") return { createHash };
      if (name === "next/server") return { NextResponse: Response };
      if (name === "zod") return zod;
      if (name.endsWith("/server-product-registration-context")) {
        return {
          async readProductRegistrationContext(_admin: unknown, productId: string) {
            registrationCalls.push(productId);
            if (options.registrationError) throw new Error(options.registrationError);
            return registration;
          },
        };
      }
      if (name.endsWith("/server-external-detail-publish-context")) {
        return {
          async readApprovedExternalDetailPublishContext(_admin: unknown, productId: string) {
            strictCalls.push(productId);
            if (options.strictError) throw new Error(options.strictError);
            return options.strictContext ?? approvedContext();
          },
        };
      }
      if (name.endsWith("/server-external-detail-import-api")) {
        return {
          externalDetailImportTarget: PRODUCT_ID,
          readExternalDetailImportContext: async () => ({
            externalDetailImport: { status: "approved", importedAt: "2026-09-07T00:00:00+00:00" },
          }),
        };
      }
      if (name.endsWith("/server-external-detail-manifest")) {
        return { approvedExternalDetailManifest: () => null };
      }
      if (name.endsWith("/admin-api")) {
        return {
          authenticateAdminRequest: async () => admin,
          isAdminApiError: () => false,
        };
      }
      if (name.endsWith("/product-intake")) {
        return { productEditSchema: { safeParse: () => ({ success: false }) } };
      }
      if (name.endsWith("/product-detail-image-manifest")) {
        return { inspectProductDetailImageDocument: () => ({ ok: true }) };
      }
      if (name.endsWith("/server-product-detail-manifest")) {
        return { resolveProductDetailDocumentAssetPaths: () => ({}) };
      }
      if (name.endsWith("/product-media-contract")) {
        return {
          detailAnimatedGifMaximumAltLength: 500,
          detailAnimatedGifMaximumCaptionLength: 500,
          detailAnimatedGifMaximumUrlLength: 4000,
          validateDetailAnimatedGif: () => ({ canAnimate: true }),
        };
      }
      if (name.endsWith("/studio-result-assets")) {
        return {
          validateStoredProductGeneratedAssetPaths(value: unknown) {
            if (!value || typeof value !== "object" || Array.isArray(value)) return null;
            return Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
          },
        };
      }
      if (name.endsWith("/studio-result-quality")) {
        return { inspectStudioResultQuality: () => ({ blockedForPublication: false }) };
      }
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  vm.runInContext(compiled, sandbox);
  const routes = sandbox.exports as RouteExports;
  const response = await routes.GET(new Request(url), { params: Promise.resolve({ id: PRODUCT_ID }) });
  return {
    response,
    body: await response.json() as Record<string, unknown>,
    registrationCalls,
    strictCalls,
    userRpcCalls,
    signed,
  };
}

test("draft mode keeps editing available when an approved external source is stale", async () => {
  const result = await run(
    `https://example.invalid/api/admin/products/${PRODUCT_ID}/publish-context?mode=draft`,
    { strictError: "EXTERNAL_DETAIL_APPROVAL_MISMATCH" },
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.externalDetailImportStatus, "unavailable");
  assert.deepEqual(JSON.parse(JSON.stringify(result.body.publicationBlocker)), {
    code: "EXTERNAL_DETAIL_APPROVAL_MISMATCH",
    message: "저장된 상세 승인과 현재 상품 정보의 연결을 확인해야 합니다. 상품 정보 입력·초안 저장은 계속할 수 있으며, 승인 연결이 복구되기 전에는 채널로 전송하지 않습니다.",
  });
  assert.equal((result.body.product as Record<string, unknown>).name, "편집 가능한 상품");
  assert.deepEqual(
    (result.body.sourceImages as Array<Record<string, unknown>>).map((image) => image.path),
    [`${OWNER_ID}/${JOB_ID}/input/001.jpg`],
  );
  assert.deepEqual(
    (result.body.generatedImages as Array<Record<string, unknown>>).map((image) => image.path),
    [`results/${JOB_ID}/claims/${CLAIM_ID}/hero.png`],
  );
  assert.deepEqual(result.registrationCalls, [PRODUCT_ID]);
  assert.deepEqual(result.strictCalls, [PRODUCT_ID]);
});

test("normal publish GET rejects the same stale approved source", async () => {
  const result = await run(
    `https://example.invalid/api/admin/products/${PRODUCT_ID}/publish-context`,
    { strictError: "EXTERNAL_DETAIL_APPROVAL_MISMATCH" },
  );

  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, "EXTERNAL_DETAIL_APPROVAL_MISMATCH");
  assert.equal(result.registrationCalls.length, 0);
  assert.equal(result.signed.length, 0);
});

test("draft mode still fails closed when strict approval ownership is invalid", async () => {
  const result = await run(
    `https://example.invalid/api/admin/products/${PRODUCT_ID}/publish-context?mode=draft`,
    { strictError: "EXTERNAL_DETAIL_OWNER_REQUIRED" },
  );

  assert.equal(result.response.status, 403);
  assert.equal(result.body.code, "EXTERNAL_DETAIL_OWNER_REQUIRED");
  assert.equal(result.signed.length, 0);
});

test("normal approved GET preserves the verified DTO and enriches assignment metadata", async () => {
  const approved = approvedContext();
  const result = await run(
    `https://example.invalid/api/admin/products/${PRODUCT_ID}/publish-context`,
    {
      strictContext: approved,
      registrationContext: editableContext({
        sourceImagePaths: [`${OWNER_ID}/${JOB_ID}/input/editing-only.jpg`],
        generatedImagePaths: {
          hero: `results/${JOB_ID}/claims/${CLAIM_ID}/editing-only.png`,
        },
      }),
    },
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.verifiedMarker, "strict-approved");
  assert.equal(Object.hasOwn(result.body, "publicationBlocker"), false);
  const assignments = result.body.assignments as Array<Record<string, unknown>>;
  assert.deepEqual(JSON.parse(JSON.stringify(assignments[0]?.requiredAttributes)), [{ id: "color", required: true }]);
  assert.deepEqual(JSON.parse(JSON.stringify(assignments[0]?.officialMetadata)), {
    source: "provider-readback",
    leaf: true,
  });
  assert.deepEqual(
    (result.body.sourceImages as Array<Record<string, unknown>>).map((image) => image.path),
    [`${OWNER_ID}/${JOB_ID}/input/approved.jpg`],
  );
  assert.deepEqual(
    (result.body.generatedImages as Array<Record<string, unknown>>).map((image) => image.path),
    [`results/${JOB_ID}/claims/${CLAIM_ID}/approved-hero.png`],
  );
  assert.deepEqual(result.signed, [
    { bucket: "sellerpilot-ai", paths: [`${OWNER_ID}/${JOB_ID}/input/approved.jpg`] },
    { bucket: "sellerpilot-ai", paths: [`results/${JOB_ID}/claims/${CLAIM_ID}/approved-hero.png`] },
  ]);
  assert.deepEqual(result.registrationCalls, [PRODUCT_ID]);
  assert.deepEqual(result.strictCalls, [PRODUCT_ID]);
  assert.equal(result.userRpcCalls.includes("sellerpilot_get_product_publish_context"), false);
});
