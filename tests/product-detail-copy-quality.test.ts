import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeProductDetailData, type ProductDetailData } from "../app/product-detail-puck";

test("saved Puck detail data cannot bypass customer-copy quality filtering", () => {
  const unsafe = {
    root: {},
    content: [{
      type: "StoryBlock",
      props: {
        id: "legacy-scene-copy",
        eyebrow: "SCENE 01",
        title: "그릇 크기는 예시",
        body: "사진마다 그릇 크기와 담긴 양이 다릅니다.",
        points: "연출 이미지는 주방 장면을 보여 줍니다.",
        tone: "light",
        primary: "#25352d",
        accent: "#d9eeae",
      },
    }],
  } as unknown as ProductDetailData;

  const sanitized = sanitizeProductDetailData(unsafe);
  const props = sanitized.content[0]?.props as Record<string, unknown>;
  assert.equal(props.eyebrow, "PRODUCT");
  assert.equal(props.body, "상품의 구성과 옵션을 확인해 주세요.");
  assert.equal(props.points, "");
  assert.doesNotMatch(JSON.stringify(sanitized), /SCENE 01|사진마다|연출 이미지/);
});
