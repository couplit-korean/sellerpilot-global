import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSuggestions } from "../app/category-classification-workbench";

const qoo10Response = {
  ok: true,
  steps: [{
    name: "GetCatagoryListAll",
    ok: true,
    status: 200,
    data: {
      ResultCode: 0,
      ResultObject: [
        { CATE_L_CD: "100000001", CATE_L_NM: "レディース服", CATE_M_CD: "200000001", CATE_M_NM: "スーツ", CATE_S_CD: "300002246", CATE_S_NM: "パンツスーツ" },
        { CATE_L_CD: "100000010", CATE_L_NM: "飲料", CATE_M_CD: "200000071", CATE_M_NM: "コーヒー・ココア", CATE_S_CD: "300000602", CATE_S_NM: "レギュラーコーヒー" },
        { CATE_L_CD: "100000042", CATE_L_NM: "キッチン用品", CATE_M_CD: "200000147", CATE_M_NM: "食器・グラス・カトラリー", CATE_S_CD: "300000503", CATE_S_NM: "マグカップ・ティーカップ" },
        { CATE_L_CD: "100000073", CATE_L_NM: "キッチン家電", CATE_M_CD: "200000246", CATE_M_NM: "コーヒーメーカー", CATE_S_CD: "320001985", CATE_S_NM: "エスプレッソマシーン" },
      ],
    },
  }],
};

test("Qoo10 category normalization maps current QAPI fields and cross-locale cup terms", () => {
  const suggestions = normalizeSuggestions("qoo10", qoo10Response, "화이트 세라믹 에스프레소 컵");
  assert.equal(suggestions[0]?.id, "300000503");
  assert.deepEqual(suggestions[0]?.path, ["キッチン用品", "食器・グラス・カトラリー", "マグカップ・ティーカップ"]);
  assert.equal(suggestions[0]?.leaf, true);
});

test("Qoo10 category normalization does not return an arbitrary leaf without a lexical match", () => {
  assert.deepEqual(normalizeSuggestions("qoo10", qoo10Response, "분류 사전이 없는 임의 상품"), []);
});
