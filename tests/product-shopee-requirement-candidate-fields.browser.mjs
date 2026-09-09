import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { build } from "vite";

const repositoryRoot = new URL("..", import.meta.url);

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
import { ShopeeSgRequirementCandidateFields } from "../../app/_publishing/shopee/requirement-candidate-fields.tsx";
import { setRegistrationValue } from "../../lib/channel-registration-form.ts";

const credentialId = "0dc9112c-340e-4fe5-870f-d33d61cd8914";
const merchantId = "80000001";
const shopId = "70000001";
const categoryId = "100787";
const sourceFingerprint = "fixture-product";
const common = {
  category_id: Number(categoryId),
  brand: { brand_id: 0, original_brand_name: "" },
  attribute_list: [],
  normal_stock: 3,
  seller_stock: [{ stock: 3 }],
  weight: 0.4,
  dimension: { package_length: 28, package_width: 20, package_height: 7 },
};
const initialDraft = {
  shopId,
  country: "sg",
  body: { ...structuredClone(common), original_price: 4 },
  publish: { shop_id: Number(shopId), shop_region: "SG", item: { ...structuredClone(common), original_price: 5, logistic: [] } },
};
const draftData = {
  schemaVersion: 1,
  sourceFingerprint,
  common: { fields: {}, price: 5000, globalBaseUsdPrice: 4, quantity: 3, packageFields: { weight: 0.4, length: 28, width: 20, height: 7 } },
  channels: { [\`shopee:SG:\${shopId}:\${credentialId}\`]: { categoryId, patches: [] } },
};
const source = { state: "ready", snapshot: {
  contract: "sellerpilot_shopee_sg_requirement_snapshot_v1",
  observedAt: new Date().toISOString(),
  tuple: { credentialId, merchantId, shopId, region: "SG", categoryId, sourceFingerprint },
  resources: {
    category: { state: "ready", value: { categoryId, path: ["Health", "Supplements"], hasChildren: false } },
    brand: { state: "ready", value: { brands: [], mandatory: false, inputType: "TEXT_FIELD" } },
    attributes: { state: "ready", value: { attributeTree: [{
      attribute_id: 5,
      display_attribute_name: "Colors",
      mandatory: false,
      attribute_info: { input_type: 5, max_value_count: 5 },
      attribute_value_list: [],
    }] } },
    logistics: { state: "ready", value: { channels: [{ logistics_channel_id: 10, logistics_channel_name: "Fixture Express", enabled: true, compulsory_channel: true }] } },
    warehouses: { state: "ready", value: { warehouses: [{ warehouseId: "9001", locationId: "SG-LOC", name: "Fixture Pickup" }] } },
    eligibleShops: { state: "ready", value: { byWarehouse: [{ warehouseId: "9001", shops: [{ shop_id: Number(shopId) }] }] } },
  },
} };

function Fixture() {
  const [draft, setDraft] = useState(initialDraft);
  return <main>
    <ShopeeSgRequirementCandidateFields
      source={source}
      credentialId={credentialId}
      shopId={shopId}
      categoryId={categoryId}
      sourceFingerprint={sourceFingerprint}
      draftData={draftData}
      baseDraft={initialDraft}
      currentDraft={draft}
      onChange={(path, value) => setDraft((current) => setRegistrationValue(current, path, value))}
      onValidationChange={() => {}}
      onRefresh={() => {}}
    />
    <output data-draft>{JSON.stringify(draft)}</output>
  </main>;
}

createRoot(document.getElementById("root")).render(<Fixture />);
`;
}

async function buildFixture(workspace) {
  const fixtureRoot = join(workspace, "fixture");
  const output = join(workspace, "dist");
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(join(fixtureRoot, "index.html"), '<!doctype html><html lang="ko"><body><div id="root"></div><script type="module" src="./src.tsx"></script></body></html>');
  await writeFile(join(fixtureRoot, "src.tsx"), fixtureSource());
  await build({ root: fixtureRoot, base: "./", logLevel: "silent", build: { outDir: output, emptyOutDir: true } });
  return output;
}

async function serveFixture(output) {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://fixture.local").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relativePath.includes("..")) return void response.writeHead(400).end();
    void readFile(join(output, relativePath)).then((content) => {
      const contentType = relativePath.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8";
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

test("Shopee SG text inputs preserve spaces and separators during sequential typing", { timeout: 90_000 }, async () => {
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]);
  assert.ok(executablePath, "Shopee text-input test requires a local Chrome executable");

  const workspace = await mkdtemp(join(new URL(".", repositoryRoot).pathname, ".tmp-shopee-text-input-"));
  const profile = await mkdtemp(join(tmpdir(), "sellerpilot-shopee-text-profile-"));
  let browser;
  let server;
  try {
    const output = await buildFixture(workspace);
    const fixture = await serveFixture(output);
    server = fixture.server;
    browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"] });
    const page = await browser.newPage();
    await page.route(/^https?:\/\//, (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === "127.0.0.1" || host === "localhost") void route.continue();
      else void route.abort();
    });
    await page.goto(fixture.url, { waitUntil: "load" });

    const brand = page.getByLabel("공식 정책 허용 직접 브랜드명");
    await brand.pressSequentially("My Brand");
    assert.equal(await brand.inputValue(), "My Brand");

    const colors = page.getByLabel("Colors");
    await colors.pressSequentially("Red, Blue");
    assert.equal(await colors.inputValue(), "Red, Blue");
    await colors.blur();
    const draft = JSON.parse(await page.locator("[data-draft]").textContent());
    assert.deepEqual(draft.body.attribute_list, [{
      attribute_id: 5,
      attribute_value_list: [{ original_value_name: "Red" }, { original_value_name: "Blue" }],
    }]);
    assert.deepEqual(draft.publish.item.attribute_list, draft.body.attribute_list);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
    await rm(workspace, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
