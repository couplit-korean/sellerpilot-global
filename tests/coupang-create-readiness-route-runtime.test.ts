import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const source = await readFile(
  new URL("../app/api/admin/coupang-create-readiness/route.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: "coupang-create-readiness/route.ts",
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length ?? 0, 0);

test("actual readiness route returns HTTP 503 when an official provider GET fails", async () => {
  const productId = "10000000-0000-4000-8000-000000000001";
  const credentialId = "20000000-0000-4000-8000-000000000001";
  const fields = Array.from({ length: 19 }, (_, index) => ({
    key: `field-${index}`,
    label: `필드 ${index}`,
    status: index === 0 ? "blocked" : "resolved",
    fieldPaths: [],
    allowedSources: [],
    selectedSource: null,
    message: "조회 실패",
  }));
  let providerReads = 0;
  const publishContext = { product: { id: productId } };
  const sandbox = vm.createContext({
    exports: {}, Request, Response, URL, URLSearchParams, AbortController,
    structuredClone, TextEncoder, console,
    require(name: string) {
      if (name === "node:crypto") return { createHash };
      if (name === "next/server") return { NextResponse: Response };
      if (name === "zod") return { z };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => ({
          userClient: { rpc: async (rpcName: string) => rpcName === "sellerpilot_get_product_publish_context"
            ? { data: publishContext, error: null }
            : { data: [{
              id: credentialId, channel: "coupang", environment: "production", status: "active",
              version: 7, fingerprint: "ABCDEF123456", expires_at: "2099-01-01T00:00:00.000Z",
            }], error: null } },
          serviceClient: { rpc: async () => ({ data: {
            access_key: "access", secret_key: "secret", vendor_id: "vendor", requested_by: "seller",
          }, error: null }) },
        }),
        isAdminApiError: () => false,
      };
      if (name.endsWith("/channels/coupang-create-source-identity")) return {
        bindCoupangCreateSourceIdentity: (value: unknown) => value,
      };
      if (name.endsWith("/channels/protocols")) return {
        coupangRequest: async () => { providerReads += 1; throw new Error("provider unavailable"); },
        runWithChannelRequestSignal: (_signal: unknown, callback: () => unknown) => callback(),
        runWithProviderReadOnlyTransport: (callback: () => unknown) => callback(),
      };
      if (name.endsWith("/product-registration/coupang/create-readiness-source")) return {
        coupangCreatePublishContextWithApprovedManifest: (value: unknown) => value,
        buildCoupangCreateReadinessSource: async (_input: unknown, dependencies: {
          readCategoryMetadata(): Promise<unknown>;
        }) => {
          try { await dependencies.readCategoryMetadata(); } catch { /* expected */ }
          return {
            contract: "sellerpilot_coupang_create_readiness_source_v1",
            status: "not_ready", reason: "provider_read_failed", stage: "category_metadata",
            attemptedReads: ["category_metadata"],
            completeness: {
              contract: "sellerpilot_coupang_create_completeness_v1",
              channel: "coupang", operation: "listing.create", fields,
              counts: { resolved: 18, manual_required: 0, provider_read_required: 0, blocked: 1 },
              blockingFieldKeys: ["category"], overallStatus: "blocked",
              canBindCreateSourceRevision: false,
            },
          };
        },
      };
      if (name.endsWith("/product-registration/source-fingerprint")) return {
        productRegistrationSourceFingerprint: () => "source-fingerprint",
      };
      if (name.endsWith("/server-external-detail-import-api")) return {
        externalDetailImportTarget: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      };
      if (name.endsWith("/server-external-detail-publish-context")) return {
        readApprovedExternalDetailPublishContext: async () => publishContext,
      };
      if (name.endsWith("/server-product-detail-manifest")) return {
        approvedProductDetailManifestFromPublishContext: () => ({ ok: true, value: { version: 1 } }),
        marketplaceArgumentsForApprovedDetailFingerprint: (value: unknown) => value,
      };
      throw new Error(`unexpected module ${name}`);
    },
  });
  vm.runInContext(compiled.outputText, sandbox);
  const post = (sandbox.exports as { POST(request: Request): Promise<Response> }).POST;
  const response = await post(new Request("https://example.invalid/api/admin/coupang-create-readiness", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      productId, credentialId, credentialVersion: 7, categoryId: "59631",
      sourceFingerprint: "source-fingerprint", draft: { body: { displayCategoryCode: 59631 } },
    }),
  }));
  assert.equal(providerReads, 1);
  assert.equal(response.status, 503);
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(payload.reason, "provider_read_failed");
  assert.equal(payload.providerWritePerformed, false);
  assert.equal(payload.jobCreated, false);
});
