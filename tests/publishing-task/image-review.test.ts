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
  const props = {
    firstDraftImages: coreFirstDraftAssetIds.map(id => ({ id, url: `https://example.test/${id}.png` })),
    phase: "source-photo-catalog" as const,
    confirmedGeneratedCount: 0,
    firstDraftConceptStatus: "현재 6장은 원본사진을 규격에 맞춘 임시 초안입니다.",
    retryAvailable: false,
    onRetry: () => undefined,
  };
  const html = renderToStaticMarkup(createElement(FirstDraftImageReview, props));
  assert.equal((html.match(/<figure>/g) ?? []).length, 6);
  assert.equal((html.match(/<figcaption>/g) ?? []).length, 6);
  assert.match(html, /원본사진을 규격에 맞춘 임시 초안/);
  assert.doesNotMatch(html, /동일한 품질|생성된 6장입니다/);
  for (const id of coreFirstDraftAssetIds) assert.ok(html.includes(`/${id}.png`));
  assert.match(html, /생성 확인 0 \/ 6장/);
  const partial = renderToStaticMarkup(createElement(FirstDraftImageReview, {
    ...props,
    firstDraftImages: props.firstDraftImages.slice(0, 2),
    phase: "partial",
    confirmedGeneratedCount: 2,
    firstDraftConceptStatus: "역할별 생성 이미지 2 / 6장을 확인했습니다.",
  }));
  assert.equal((partial.match(/<figure>/g) ?? []).length, 6);
  assert.equal((partial.match(/생성 대기/g) ?? []).length, 4);
  assert.match(partial, /role="status"/);
  assert.equal(renderToStaticMarkup(createElement(FirstDraftImageReview, { ...props, phase: "idle", firstDraftImages: [] })), "");
});
