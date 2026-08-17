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
        { CATE_L_CD: "100000001", CATE_L_NM: "レディース服", CATE_M_CD: "200000004", CATE_M_NM: "トップス", CATE_S_CD: "300002252", CATE_S_NM: "Tシャツ・カットソー" },
        { CATE_L_CD: "100000010", CATE_L_NM: "飲料", CATE_M_CD: "200000071", CATE_M_NM: "コーヒー・ココア", CATE_S_CD: "300000602", CATE_S_NM: "レギュラーコーヒー" },
        { CATE_L_CD: "100000046", CATE_L_NM: "キッチン用品", CATE_M_CD: "200000495", CATE_M_NM: "食器・グラス・カトラリー", CATE_S_CD: "300000503", CATE_S_NM: "マグカップ・ティーカップ" },
        { CATE_L_CD: "100000018", CATE_L_NM: "日用品雑貨", CATE_M_CD: "200000137", CATE_M_NM: "バス用品", CATE_S_CD: "320001555", CATE_S_NM: "石鹼" },
        { CATE_L_CD: "120000012", CATE_L_NM: "スキンケア", CATE_M_CD: "220000159", CATE_M_NM: "基礎化粧品", CATE_S_CD: "320001621", CATE_S_NM: "乳液・クリーム" },
        { CATE_L_CD: "100000003", CATE_L_NM: "バッグ・雑貨", CATE_M_CD: "200000047", CATE_M_NM: "バッグ", CATE_S_CD: "300000116", CATE_S_NM: "トートバッグ" },
        { CATE_L_CD: "100000003", CATE_L_NM: "バッグ・雑貨", CATE_M_CD: "200000047", CATE_M_NM: "バッグ", CATE_S_CD: "300002169", CATE_S_NM: "リュック・デイパック" },
        { CATE_L_CD: "100000042", CATE_L_NM: "シューズ", CATE_M_CD: "200000034", CATE_M_NM: "スニーカー・スリッポン", CATE_S_CD: "300000756", CATE_S_NM: "ローカットスニーカー" },
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

const qoo10RepresentativeCases = [
  ["면 반팔 티셔츠 의류", "300002252"],
  ["고체 세정 비누 soap bar", "320001555"],
  ["보습 스킨케어 크림", "320001621"],
  ["캔버스 토트 가방", "300000116"],
  ["로우컷 스니커 신발", "300000756"],
] as const;

for (const [query, expectedId] of qoo10RepresentativeCases) {
  test(`Qoo10 live leaf mapping chooses ${expectedId} for ${query}`, () => {
    assert.equal(normalizeSuggestions("qoo10", qoo10Response, query)[0]?.id, expectedId);
  });
}

const shopeeGlobalResponse = {
  ok: true,
  steps: [{
    name: "global-categories",
    ok: true,
    status: 200,
    data: {
      response: {
        category_list: [
          { category_id: 100017, display_category_name: "Women Clothes", has_children: false },
          { category_id: 101240, display_category_name: "Mugs", has_children: false },
          { category_id: 100629, display_category_name: "Beauty & Personal Care > Bath & Body > Bar Soap", has_children: false },
          { category_id: 100630, display_category_name: "Shoes", has_children: false },
        ],
      },
    },
  }],
};

test("Shopee GlobalProduct normalization chooses a lexical category instead of the first leaf", () => {
  const suggestions = normalizeSuggestions("shopee", shopeeGlobalResponse, "White ceramic espresso cup");
  assert.equal(suggestions[0]?.id, "101240");
  assert.equal(suggestions[0]?.name, "Mugs");
  assert.equal(suggestions[0]?.leaf, true);
});

test("Shopee GlobalProduct normalization blocks arbitrary categories without a lexical match", () => {
  assert.deepEqual(normalizeSuggestions("shopee", shopeeGlobalResponse, "Unmapped industrial component"), []);
});

test("Shopee GlobalProduct normalization maps soap instead of an unrelated beauty leaf", () => {
  assert.equal(normalizeSuggestions("shopee", shopeeGlobalResponse, "Natural cleansing soap bar")[0]?.id, "100629");
});
