import fs from "node:fs/promises";
import path from "node:path";
import { testCatalogSources } from "./test-catalog-sources.mjs";

const outputDirectory = path.resolve("public/test-catalog");
await fs.mkdir(outputDirectory, { recursive: true });

for (const source of testCatalogSources) {
  const target = path.join(outputDirectory, source.file);
  if (await fs.stat(target).then((item) => item.size > 0).catch(() => false)) {
    console.log(`${source.sku}\t${source.file}\tskipped`);
    continue;
  }
  const redirect = new URL(`https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(source.title)}`);
  redirect.searchParams.set("width", "1200");
  let response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await fetch(redirect, { headers: { "user-agent": "SellerPilotTestCatalog/1.0 (product image license verification)" } });
    if (response.ok && response.headers.get("content-type")?.startsWith("image/")) break;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
  }
  if (!response?.ok || !response.headers.get("content-type")?.startsWith("image/")) {
    throw new Error(`Image download failed: ${source.title} (${response?.status ?? "no response"})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 2_000_000) throw new Error(`Image exceeds Shopee 2 MB limit: ${source.title}`);
  await fs.writeFile(target, bytes);
  console.log(`${source.sku}\t${source.file}\t${bytes.length}`);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
