import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerHooks } from "node:module";
import { coreFirstDraftAssetIds } from "../../lib/ai-generated-assets";

// Node's direct TS loader does not implement Next's next/image CJS interop.
// Keep the gallery test independent of Next's image optimizer and bundler.
const imageModule = `import { createElement } from ${JSON.stringify(import.meta.resolve("react"))}; export default function Image({src,alt,sizes}) { return createElement("img",{src,alt,sizes}); }`;
registerHooks({ resolve(specifier, context, next) {
  return specifier === "next/image"
    ? { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(imageModule)}` }
    : next(specifier, context);
} });
const { FirstDraftImageReview } = await import("../../app/_publishing/first-draft-image-review");

test("the extracted image review renders all six roles without a server or generator", () => {
  const props = { firstDraftImages: coreFirstDraftAssetIds.map(id => ({ id, url: `https://example.test/${id}.png` })), studioDraftImagesMerged: false, firstDraftConceptStatus: "현재 작업 대기", studioDraftBlockedReason: "" };
  const html = renderToStaticMarkup(createElement(FirstDraftImageReview, props));
  assert.equal((html.match(/<figure>/g) ?? []).length, 6);
  assert.equal((html.match(/<figcaption>/g) ?? []).length, 6);
  assert.match(html, /현재 작업 대기/);
  for (const id of coreFirstDraftAssetIds) assert.ok(html.includes(`/${id}.png`));
  assert.equal(renderToStaticMarkup(createElement(FirstDraftImageReview, { ...props, firstDraftImages: [] })), "");
});
