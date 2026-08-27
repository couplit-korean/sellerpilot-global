import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { makeProductDetailPersistable, resolveProductDetailAssets } from "../app/_publishing/product-detail-persistence";
import { detailAnimatedGifMaximumUrlLength, validateDetailAnimatedGif } from "../lib/product-media-contract";

test("detail GIF contract accepts only complete public HTTPS GIF and static poster inputs", () => {
  const valid = validateDetailAnimatedGif({
    gifUrl: "https://media.example.com/product/use.GIF?version=2",
    posterUrl: "https://media.example.com/product/use.webp?version=2",
    alt: "컵에 시리얼을 따르는 장면",
    caption: "시리얼을 따르는 양을 확인하세요.",
  });
  assert.equal(valid.canAnimate, true);
  assert.equal(valid.gifUrl, "https://media.example.com/product/use.GIF?version=2");
  assert.equal(valid.posterUrl, "https://media.example.com/product/use.webp?version=2");
  assert.deepEqual(valid.issues, []);

  for (const gifUrl of [
    "http://media.example.com/use.gif",
    "https://media.example.com/use.jpg",
    "https://user:secret@media.example.com/use.gif",
    "https://localhost/use.gif",
    "https://127.0.0.1/use.gif",
    "https://media.example.com:8443/use.gif",
    `https://media.example.com/${"a".repeat(detailAnimatedGifMaximumUrlLength)}.gif`,
  ]) {
    const invalid = validateDetailAnimatedGif({
      gifUrl,
      posterUrl: "https://media.example.com/use.jpg",
      alt: "상품 사용 장면",
      caption: "상품 사용 안내",
    });
    assert.equal(invalid.canAnimate, false, gifUrl);
    assert.equal(invalid.gifUrl, null, gifUrl);
    assert.equal(invalid.posterUrl, "https://media.example.com/use.jpg", "유효한 poster는 fail-closed 대체로 남아야 합니다.");
    assert.ok(invalid.issues.includes("invalid_gif_url"), gifUrl);
  }
});

test("detail GIF contract refuses animation when poster, alt, or caption is incomplete", () => {
  const invalid = validateDetailAnimatedGif({
    gifUrl: "https://media.example.com/use.gif",
    posterUrl: "https://media.example.com/use.svg",
    alt: " ",
    caption: "",
  });
  assert.equal(invalid.canAnimate, false);
  assert.equal(invalid.posterUrl, null);
  assert.deepEqual(invalid.issues, ["invalid_poster_url", "missing_alt", "missing_caption"]);
  assert.match(invalid.alt, /정적 대체 이미지/);
});

test("Puck persistence preserves explicit GIF block properties without treating them as generated assets", () => {
  const data = {
    root: {},
    content: [{
      type: "AnimatedGifBlock",
      props: {
        id: "manual-gif",
        gifUrl: "https://media.example.com/use.gif",
        posterUrl: "https://media.example.com/use.jpg",
        alt: "상품 사용 장면",
        caption: "상품 사용 안내",
      },
    }],
  };
  const persisted = makeProductDetailPersistable(data, { hero: "https://signed.example/hero.jpg" });
  const resolved = resolveProductDetailAssets(persisted, { hero: "https://signed.example/fresh-hero.jpg" });
  assert.deepEqual(resolved, data);
  assert.notEqual(persisted, data);
});

test("Puck renderer offers a reduced-motion poster fallback and makes no generation or channel-delivery claim", async () => {
  const [puck, styles, readiness] = await Promise.all([
    readFile(new URL("../app/product-detail-puck.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/product-detail-media.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/channel-readiness-data.ts", import.meta.url), "utf8"),
  ]);
  assert.match(puck, /AnimatedGifBlock/);
  assert.match(puck, /상세페이지 GIF \(채널 전송 제외\)/);
  assert.match(puck, /validateDetailAnimatedGif/);
  assert.match(puck, /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(puck, /const \[allowsAnimation, setAllowsAnimation\] = useState\(false\)/);
  assert.match(puck, /showAnimation = media\.canAnimate && allowsAnimation && !gifFailed/);
  assert.match(puck, /referrerPolicy="no-referrer"/);
  assert.match(puck, /data-media-state=\{mediaState\}/);
  assert.doesNotMatch(puck, /from "next\/image"/);
  const generatedData = puck.slice(puck.indexOf("function createDetailData"), puck.indexOf("export function ProductDetailRender"));
  assert.doesNotMatch(generatedData, /AnimatedGifBlock/);
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(readiness, /SellerPilot 현재 전송: 검증·정규화 JPEG만 · GIF 채널 전송 미지원/);
});
