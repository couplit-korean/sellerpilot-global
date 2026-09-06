import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { productDetailDataToHtml } from "../app/_publishing/product-detail-html";
import { resolveProductDetailLocale } from "../lib/product-detail-locale";
import type { ProductDetailData } from "../app/product-detail-puck";
// Styling has no role in textual SSR assertions; load actual Puck renderer/config.
registerHooks({ load(url, context, next) { return url.endsWith(".css") ? { format: "module", source: "export default {}", shortCircuit: true } : next(url, context); } });
const { ProductDetailRender } = await import("../app/product-detail-puck");
function document(locale?: string): ProductDetailData {
  return { root: locale ? { props: { locale } } : {}, content: [
    { type: "VerificationRibbonBlock", props: { id: "v", classification: "Biscuits", healthFunctionalStatus: "", targetCustomer: "Snack lovers", verificationStatus: "verified", evidence: "Package label", primary: "#123456", accent: "#abcdef", surface: "#ffffff" } },
    { type: "StoryBlock", props: { id: "s", sectionType: "spec", eyebrow: "LOTTE", title: "315g", body: "52.5g / 265kcal", points: "Sodium 100mg\nTrans fat <0.5g", tone: "light", primary: "#123456", accent: "#abcdef", layout: "editorial", motion: "none", buyerQuestion: "Per sachet?", evidence: "Package label", verificationStatus: "needs-review" } },
    { type: "HeroBlock", props: { id: "h", eyebrow: "LOTTE", title: "Biscuits", description: "Milk flavour", cta: "See product", imageUrl: "", imageAlt: "", primary: "#123456", accent: "#abcdef", surface: "#fff", layout: "split" } },
    { type: "CtaBlock", props: { id: "c", audience: "You", title: "Choose", description: "Read the label", checklist: "Allergens", button: "See product", primary: "#123456", accent: "#abcdef" } },
  ] } as ProductDetailData;
}
for (const [locale, label] of [["ja-JP", "商品分類"], ["en-US", "Product category"]]) {
  test(`${locale}: actual React render and HTML export have no Korean chrome; facts unchanged`, () => {
    const d=document(locale); const before=JSON.stringify(d);
    const html=productDetailDataToHtml(d);
    const rendered=renderToStaticMarkup(createElement(ProductDetailRender,{result:null,imageUrl:"",data:d}));
    for(const output of [html,rendered]) { assert.doesNotMatch(output,/[\uAC00-\uD7A3]/u); assert.match(output,/52\.5g \/ 265kcal/); assert.match(output,/Sodium 100mg/); }
    assert.ok(rendered.includes(label)); assert.equal(JSON.stringify(d),before);
  });
}
test("legacy Korean remains Korean and explicit locale reaches render/export",()=>{
  const d=document(); assert.equal(resolveProductDetailLocale(d),"ko");
  const ko=renderToStaticMarkup(createElement(ProductDetailRender,{result:null,imageUrl:"",data:d}));
  assert.match(ko,/상품 분류/); assert.doesNotMatch(ko,/구매 전 질문|버튼 문구|Package label/);
  assert.match(productDetailDataToHtml(d),/상품 분류/);
  assert.doesNotMatch(productDetailDataToHtml(d,"en-GB"),/[\uAC00-\uD7A3]/u);
  assert.doesNotMatch(renderToStaticMarkup(createElement(ProductDetailRender,{result:null,imageUrl:"",data:d,locale:"ja-JP"})),/[\uAC00-\uD7A3]/u);
});
test("unsupported locale is explicit failure, not claimed English coverage",()=>{
  assert.throws(()=>productDetailDataToHtml(document("de-DE")),/PRODUCT_DETAIL_CHROME_LOCALE_UNSUPPORTED/);
  assert.throws(()=>resolveProductDetailLocale(null,"zz"),/PRODUCT_DETAIL_CHROME_LOCALE_UNSUPPORTED/);
});

test("Korean Puck targets pass their target locale; foreign target copy keeps its own rich/plain path", async()=>{
  const { readFile } = await import("node:fs/promises");
  const workbench=await readFile(new URL("../app/product-publish-workbench.tsx",import.meta.url),"utf8");
  assert.match(workbench,/const puckDetailLocale = target\?\.locale \?\? writeListing\?\.locale/);
  assert.match(workbench,/\["coupang", "elevenst", "smartstore"\]\.includes\(channel\)/);
  assert.match(workbench,/productDetailDataToHtml\(publishContextDesignedDetailData\(context\), puckDetailLocale\)/);
  assert.match(workbench,/buildLocalizedRichDetail\(writeListing/);
  assert.match(workbench,/buildLocalizedPlainDetail\(writeListing/);
});
