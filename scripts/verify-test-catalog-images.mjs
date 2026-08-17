import { testCatalogSources } from "./test-catalog-sources.mjs";

const origin = process.argv[2] ?? "https://sellerpilot-global.vercel.app";
for (const source of testCatalogSources) {
  const url = `${origin}/test-catalog/${source.file}`;
  const response = await fetch(url, { redirect: "follow" });
  const contentType = response.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok || !contentType.startsWith("image/jpeg") || bytes.length === 0 || bytes.length > 2_000_000) {
    throw new Error(`${source.sku} failed: ${response.status} ${contentType} ${bytes.length}`);
  }
  console.log(`${source.sku}\t${response.status}\t${contentType}\t${bytes.length}`);
}
