import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { build } from "vite";

const repositoryRoot = new URL("..", import.meta.url);
const productId = "90000000-0000-4000-8000-000000000006";
const credentialId = "91000000-0000-4000-8000-000000000006";
const productionPatchApplied = process.env.EBAY_POLICY_REVIEW_PATCH_APPLIED === "1";

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through explicit local browser candidates.
    }
  }
  return null;
}

function fixtureSource() {
  return `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProductPublishWorkbench } from "../../app/product-publish-workbench.tsx";
import "../../app/product-publish-workbench.css";

const productId = ${JSON.stringify(productId)};
const credentialId = ${JSON.stringify(credentialId)};
const detailRoles = [
  "detail-overview", "detail-feature", "detail-use", "detail-package",
  "detail-routine", "detail-context", "detail-contents", "detail-care",
];
const context = {
  contentMode: "ai_generated",
  product: {
    id: productId,
    externalCode: "FIXTURE-EBAY-006-R2",
    sku: "FIXTURE-EBAY-006-R2",
    name: "Fixture ceramic organizer",
    description: "Approved fixture description for the US listing.",
    sourceUrl: null,
    status: "draft",
  },
  manualFields: {
    productName: "Fixture ceramic organizer",
    description: "Approved fixture description for the US listing.",
    sellerSku: "FIXTURE-EBAY-006-R2",
    categoryHint: "Home organization",
    brandName: "Fixture Brand",
    manufacturer: "Fixture Maker",
    countryOfOrigin: "Korea, Republic of",
    material: "Ceramic",
    packageContents: "1 organizer",
    condition: "NEW",
    gtinStatus: "NO_GTIN",
    gtin: "",
    sellingPrice: 18.75,
    currency: "USD",
    stock: 3,
    weightKg: 0.4,
    packageLengthCm: 20,
    packageWidthCm: 12,
    packageHeightCm: 8,
    shippingFeeKrw: 0,
    shippingRule: "",
    packagingRule: "",
  },
  imageSpecs: [],
  assignments: [{
    channel: "ebay",
    market: "US",
    categoryId: "20473",
    categoryPath: ["Home & Garden", "Organization"],
    providedAttributes: { Material: "Ceramic" },
    requiredAttributes: [],
    officialMetadata: {},
    status: "confirmed",
    confirmedAt: "2026-09-09T00:00:00.000Z",
  }],
  listings: [],
  sourceImages: [{ path: "fixture/source.jpg", url: "https://fixture.invalid/source.jpg" }],
  generatedImages: [
    ...["square", "hero", "portrait", "wide"].map((id) => ({
      id, path: \`fixture/generated/\${id}.jpg\`, url: \`https://fixture.invalid/\${id}.jpg\`,
    })),
    ...detailRoles.map((id) => ({
      id, path: \`fixture/generated/\${id}.jpg\`, url: \`https://fixture.invalid/\${id}.jpg\`,
    })),
  ],
  detailPage: {
    version: 1,
    approvedVersion: 1,
    imageManifest: {
      contract: "sellerpilot_detail_image_manifest_v2",
      algorithm: "sha256",
      digest: "a".repeat(64),
      images: detailRoles.map((role, index) => ({
        role,
        path: \`fixture/generated/\${role}.jpg\`,
        sourceSha256: (index + 1).toString(16).padStart(64, "0"),
      })),
    },
  },
  localizedListings: [],
  detailData: null,
  publicationBlocker: null,
};
const handoff = {
  productId,
  channel: "ebay",
  environment: "production",
  market: "US",
  marketplaceId: "EBAY_US",
  fulfillmentPolicyId: "fixture-fulfillment-us",
  paymentPolicyId: "fixture-payment-us",
  returnPolicyId: "fixture-return-us",
  merchantLocationKey: "fixture-warehouse-us",
  updatedAt: "2026-09-09T00:00:00.000Z",
};

window.__fixture = { requests: [], savedDraft: null, version: 0, operationMode: "failure" };
window.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || "GET";
  const body = init.body ? JSON.parse(String(init.body)) : null;
  window.__fixture.requests.push({ url, method, body });
  if (url.includes("/publish-context?mode=draft")) return Response.json(context);
  if (url.startsWith("/api/admin/channel-targets?")) return Response.json({ targets: [] });
  if (url === "/api/exchange-rates") return Response.json({});
  if (url.startsWith("/api/admin/product-detail-data?")) return Response.json({ detailData: null });
  if (url.startsWith("/api/admin/product-listing-handoff?") && method === "GET") return Response.json({ handoff });
  if (url === "/api/admin/product-listing-handoff" && method === "POST") return Response.json({ handoff: { ...body, updatedAt: "2026-09-09T00:00:01.000Z" } });
  if (url.startsWith("/api/admin/product-registration-drafts?") && method === "GET") return Response.json({ draft: window.__fixture.savedDraft });
  if (url === "/api/admin/product-registration-drafts" && method === "PUT") {
    window.__fixture.version += 1;
    window.__fixture.savedDraft = {
      draftId: productId,
      kind: "publish",
      productId,
      version: window.__fixture.version,
      data: body.data,
      updatedAt: "2026-09-09T00:00:02.000Z",
    };
    return Response.json({ draft: window.__fixture.savedDraft });
  }
  if (url === "/api/admin/channel-operations" && method === "POST") {
    return window.__fixture.operationMode === "success"
      ? Response.json({
        ok: true,
        safeMessage: "fixture official listing readback verified",
        remoteId: "fixture-listing-006-r2",
        attemptId: "92000000-0000-4000-8000-000000000006",
      })
      : Response.json({
        ok: false,
        message: "fixture provider rejection",
        attemptId: "93000000-0000-4000-8000-000000000006",
      }, { status: 422 });
  }
  throw new Error(\`unexpected fixture request: \${method} \${url}\`);
};

function Fixture() {
  const [version, setVersion] = useState(0);
  return <main>
    <div data-fixture-controls>
      <button type="button" onClick={() => setVersion((value) => value + 1)}>production workbench 다시 마운트</button>
      <button type="button" onClick={() => { window.__fixture.operationMode = "failure"; }}>failure transport</button>
      <button type="button" onClick={() => { window.__fixture.operationMode = "success"; }}>success transport</button>
    </div>
    <ProductPublishWorkbench
      key={version}
      productId={productId}
      selectedChannels={["ebay"]}
      refreshVersion={0}
      notify={(message) => { window.__fixture.lastNotification = message; }}
    />
  </main>;
}

createRoot(document.getElementById("root")).render(<Fixture />);
`;
}

function productionWorkbenchPlugin(patchPolicyReview) {
  const supabaseFixtureModule = `
export function createClient() {
  return {
    auth: { getSession: async () => ({ data: { session: { access_token: "fixture-access-token" } } }) },
    rpc(name) {
      return {
        abortSignal: async () => ({
          data: name === "sellerpilot_list_credentials" ? [{
            id: ${JSON.stringify(credentialId)}, channel: "ebay", environment: "production", status: "active",
          }] : null,
          error: null,
        }),
      };
    },
  };
}`;
  return {
    name: "sellerpilot-ebay-production-workbench-fixture",
    enforce: "pre",
    resolveId(specifier) {
      if (specifier.includes("lib/supabase/client")) {
        return "\0sellerpilot-fixture-supabase-client";
      }
      return null;
    },
    load(id) {
      if (id !== "\0sellerpilot-fixture-supabase-client") return null;
      return supabaseFixtureModule;
    },
    transform(code, id) {
      if (id.endsWith("/lib/supabase/client.ts")) return { code: supabaseFixtureModule, map: null };
      if (!patchPolicyReview || !id.endsWith("/lib/channel-registration-form.ts")) return null;
      const anchor = /\[\s*["']sellerpilotAssets["']\s*,\s*["']shipping["']\s*,\s*["']shippingRuleReview["']\s*\],/;
      assert.equal(anchor.test(code), true, "frozen patch anchor must match the production helper");
      return {
        code: code.replace(anchor, (needle) => '["sellerpilotAssets", "shipping", "policyReview"],\n  ' + needle),
        map: null,
      };
    },
  };
}

async function buildFixture(workspace, patchPolicyReview) {
  const fixtureRoot = join(workspace, "fixture");
  const output = join(workspace, "dist");
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(join(fixtureRoot, "index.html"), '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./src.tsx"></script></body></html>');
  await writeFile(join(fixtureRoot, "src.tsx"), fixtureSource());
  await build({
    root: fixtureRoot,
    base: "./",
    logLevel: "silent",
    plugins: [productionWorkbenchPlugin(patchPolicyReview)],
    build: { outDir: output, emptyOutDir: true },
  });
  return output;
}

async function serveFixture(output) {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://fixture.local").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relativePath.includes("..")) {
      response.writeHead(400).end();
      return;
    }
    void readFile(join(output, relativePath)).then((content) => {
      const contentType = relativePath.endsWith(".js") ? "text/javascript"
        : relativePath.endsWith(".css") ? "text/css"
          : "text/html; charset=utf-8";
      response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" }).end(content);
    }).catch(() => response.writeHead(404).end());
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not expose a local port");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function withBrowserFixture(patchPolicyReview, run) {
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]);
  assert.ok(executablePath, "compiled production workbench test requires a local Chrome executable");
  const workspace = await mkdtemp(join(new URL(".", repositoryRoot).pathname, ".tmp-ebay-workbench-r2-"));
  const profile = await mkdtemp(join(tmpdir(), "sellerpilot-ebay-workbench-r2-profile-"));
  let context;
  let server;
  try {
    const output = await buildFixture(workspace, patchPolicyReview);
    const fixture = await serveFixture(output);
    server = fixture.server;
    context = await chromium.launchPersistentContext(profile, { executablePath, headless: true });
    const page = await context.newPage();
    const browserErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.stack ?? error.message}`));
    await page.goto(fixture.url);
    try {
      await page.locator(".publish-channel-card").waitFor();
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${browserErrors.join("\n")}\nBODY=${(await page.locator("body").textContent()) ?? ""}`);
    }
    await run(page);
  } finally {
    if (context) await context.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(workspace, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
}

test("production ProductPublishWorkbench exposes the eBay policy-review dead end before the frozen patch", {
  timeout: 120_000,
  skip: productionPatchApplied,
}, async () => {
  await withBrowserFixture(false, async (page) => {
    const card = page.locator(".publish-channel-card");
    await card.getByText("채널 배송비·배송 정책 대조", { exact: true }).waitFor();
    assert.equal(await card.locator('input[id*="policyReview"]').count(), 0);
    const execute = card.locator("button.publish-execute");
    await assert.doesNotReject(() => execute.getAttribute("disabled"));
    assert.equal(await execute.isDisabled(), true);
    assert.match((await execute.textContent()) ?? "", /필수 보완 1개 후 등록/);
  });
});

test("corrected production workbench saves, reloads, executes, and classifies failure/success", { timeout: 180_000 }, async () => {
  // The frozen branch injects the one-line patch only while building this fixture.
  // Once central has applied the patch, the opt-in run exercises production source
  // as-is and avoids inserting the allowlisted path a second time.
  await withBrowserFixture(!productionPatchApplied, async (page) => {
    const card = page.locator(".publish-channel-card");
    const policyReview = card.locator('input[id*="policyReview"]');
    await policyReview.waitFor();
    await policyReview.fill("확인");

    await page.waitForFunction(() => window.__fixture.savedDraft?.data?.channels
      && Object.values(window.__fixture.savedDraft.data.channels).some((entry) => entry.patches.some((patch) =>
        patch.path.join(".") === "sellerpilotAssets.shipping.policyReview" && patch.value === "확인")));
    const savedVersion = await page.evaluate(() => window.__fixture.version);
    assert.ok(savedVersion >= 1);

    await page.getByRole("button", { name: "production workbench 다시 마운트" }).click();
    await card.getByText("모든 입력값 준비", { exact: true }).waitFor();
    assert.equal(await card.locator('input[id*="policyReview"]').inputValue(), "확인");
    const execute = card.locator("button.publish-execute");
    assert.equal(await execute.isEnabled(), true);

    await page.getByRole("button", { name: "failure transport" }).click();
    await execute.click();
    const failureConfirm = card.locator("button.publish-confirm-execute");
    await page.waitForTimeout(250);
    if (await failureConfirm.count() === 0) {
      const debug = await page.evaluate(() => ({ body: document.body.textContent, notification: window.__fixture.lastNotification }));
      throw new Error(`production confirmation did not open: ${JSON.stringify(debug)}`);
    }
    await failureConfirm.click();
    await card.locator(".publish-result.failed").getByText("fixture provider rejection", { exact: false }).waitFor();

    await page.getByRole("button", { name: "success transport" }).click();
    await card.locator("button.publish-execute").click();
    await card.locator("button.publish-confirm-execute").click();
    await card.locator(".publish-result.succeeded").getByText("fixture official listing readback verified", { exact: false }).waitFor();

    const operationRequests = await page.evaluate(() => window.__fixture.requests.filter((request) =>
      request.url === "/api/admin/channel-operations" && request.method === "POST"));
    assert.equal(operationRequests.length, 2);
    for (const request of operationRequests) {
      assert.equal(request.body.productId, productId);
      assert.equal(request.body.credentialId, credentialId);
      assert.equal(request.body.channel, "ebay");
      assert.equal(request.body.operation, "listing.create");
      assert.equal(request.body.confirmWrite, true);
      assert.equal(request.body.market, "US");
      assert.equal(request.body.targetId, "EBAY_US");
      assert.equal(request.body.currency, "USD");
      assert.equal(request.body.price, 18.75);
      assert.equal(request.body.arguments.sellerpilotAssets.shipping.policyReview, "확인");
      assert.equal(request.body.arguments.offer.listingPolicies.fulfillmentPolicyId, "fixture-fulfillment-us");
      assert.equal(request.body.arguments.offer.listingPolicies.paymentPolicyId, "fixture-payment-us");
      assert.equal(request.body.arguments.offer.listingPolicies.returnPolicyId, "fixture-return-us");
      assert.equal(request.body.arguments.offer.merchantLocationKey, "fixture-warehouse-us");
    }
  });
});
