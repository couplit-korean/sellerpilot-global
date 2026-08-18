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
        { CATE_L_CD: "120000012", CATE_L_NM: "スキンケア", CATE_M_CD: "220000170", CATE_M_NM: "洗顔・クレンジング", CATE_S_CD: "TEST-FACE-WASH", CATE_S_NM: "洗顔フォーム" },
        { CATE_L_CD: "120000012", CATE_L_NM: "スキンケア", CATE_M_CD: "220000170", CATE_M_NM: "洗顔・クレンジング", CATE_S_CD: "TEST-FACE-SOAP", CATE_S_NM: "洗顔せっけん" },
        { CATE_L_CD: "120000012", CATE_L_NM: "スキンケア", CATE_M_CD: "220000159", CATE_M_NM: "基礎化粧品", CATE_S_CD: "320001621", CATE_S_NM: "乳液・クリーム" },
        { CATE_L_CD: "100000003", CATE_L_NM: "バッグ・雑貨", CATE_M_CD: "200000047", CATE_M_NM: "バッグ", CATE_S_CD: "300000116", CATE_S_NM: "トートバッグ" },
        { CATE_L_CD: "100000003", CATE_L_NM: "バッグ・雑貨", CATE_M_CD: "200000047", CATE_M_NM: "バッグ", CATE_S_CD: "300002169", CATE_S_NM: "リュック・デイパック" },
        { CATE_L_CD: "100000042", CATE_L_NM: "シューズ", CATE_M_CD: "200000034", CATE_M_NM: "スニーカー・スリッポン", CATE_S_CD: "300000756", CATE_S_NM: "ローカットスニーカー" },
        { CATE_L_CD: "100000012", CATE_L_NM: "コスメ", CATE_M_CD: "200000159", CATE_M_NM: "メイクアップ", CATE_S_CD: "TEST-LIP", CATE_S_NM: "口紅・リップ" },
        { CATE_L_CD: "100000003", CATE_L_NM: "バッグ・雑貨", CATE_M_CD: "200000048", CATE_M_NM: "ヘアアクセサリー", CATE_S_CD: "TEST-HAIR-CLIP", CATE_S_NM: "ヘアクリップ" },
        { CATE_L_CD: "100000012", CATE_L_NM: "ポイントメイク", CATE_M_CD: "200000161", CATE_M_NM: "リップメイク", CATE_S_CD: "TEST-LIPSTICK", CATE_S_NM: "リップスティック" },
        { CATE_L_CD: "100000012", CATE_L_NM: "コスメ", CATE_M_CD: "200000160", CATE_M_NM: "メイク道具", CATE_S_CD: "TEST-BRUSH", CATE_S_NM: "メイクブラシ" },
        { CATE_L_CD: "100000012", CATE_L_NM: "コスメ", CATE_M_CD: "200000160", CATE_M_NM: "メイク道具", CATE_S_CD: "TEST-SPONGE", CATE_S_NM: "メイクスポンジ・パフ" },
        { CATE_L_CD: "100000012", CATE_L_NM: "コスメ", CATE_M_CD: "200000160", CATE_M_NM: "メイク道具", CATE_S_CD: "TEST-CURLER", CATE_S_NM: "ビューラー" },
        { CATE_L_CD: "100000020", CATE_L_NM: "食品", CATE_M_CD: "200000201", CATE_M_NM: "米・雑穀", CATE_S_CD: "TEST-RICE", CATE_S_NM: "白米" },
        { CATE_L_CD: "100000020", CATE_L_NM: "米・雑穀", CATE_M_CD: "200000204", CATE_M_NM: "ご飯パック", CATE_S_CD: "TEST-RICE-PACK", CATE_S_NM: "ご飯パック" },
        { CATE_L_CD: "100000020", CATE_L_NM: "食品", CATE_M_CD: "200000201", CATE_M_NM: "米・雑穀", CATE_S_CD: "TEST-RICE-GRAIN", CATE_S_NM: "米・雑穀" },
        { CATE_L_CD: "100000031", CATE_L_NM: "ベビー・マタニティ", CATE_M_CD: "200000310", CATE_M_NM: "産前・産後小物", CATE_S_CD: "TEST-MATERNITY-FOOD", CATE_S_NM: "マタニティ食品" },
        { CATE_L_CD: "100000020", CATE_L_NM: "食品", CATE_M_CD: "200000202", CATE_M_NM: "麺類", CATE_S_CD: "TEST-PASTA", CATE_S_NM: "パスタ・ペンネ" },
        { CATE_L_CD: "100000020", CATE_L_NM: "食品", CATE_M_CD: "200000203", CATE_M_NM: "粉類", CATE_S_CD: "TEST-FLOUR", CATE_S_NM: "小麦粉" },
        { CATE_L_CD: "100000030", CATE_L_NM: "おもちゃ", CATE_M_CD: "200000301", CATE_M_NM: "ぬいぐるみ", CATE_S_CD: "TEST-TEDDY", CATE_S_NM: "テディベア" },
        { CATE_L_CD: "100000030", CATE_L_NM: "おもちゃ", CATE_M_CD: "200000302", CATE_M_NM: "ミニカー", CATE_S_CD: "TEST-TOYCAR", CATE_S_NM: "車のおもちゃ" },
        { CATE_L_CD: "100000030", CATE_L_NM: "おもちゃ・知育", CATE_M_CD: "200000302", CATE_M_NM: "ミニカー・電車・飛行機", CATE_S_CD: "TEST-TOYCAR-OTHER", CATE_S_NM: "その他" },
        { CATE_L_CD: "100000030", CATE_L_NM: "おもちゃ・知育", CATE_M_CD: "200000302", CATE_M_NM: "ミニカー・電車・飛行機", CATE_S_CD: "TEST-TOYCAR-MINI", CATE_S_NM: "ミニカー" },
        { CATE_L_CD: "100000001", CATE_L_NM: "レディース服", CATE_M_CD: "200000005", CATE_M_NM: "アウター", CATE_S_CD: "TEST-HOODIE", CATE_S_NM: "パーカー" },
        { CATE_L_CD: "100000040", CATE_L_NM: "健康食品", CATE_M_CD: "200000401", CATE_M_NM: "サプリメント", CATE_S_CD: "TEST-OMEGA", CATE_S_NM: "オメガ3・フィッシュオイル" },
        { CATE_L_CD: "100000040", CATE_L_NM: "サプリメント", CATE_M_CD: "200000402", CATE_M_NM: "動物性由来成分", CATE_S_CD: "TEST-DHA-EPA", CATE_S_NM: "DHA・EPA" },
        { CATE_L_CD: "100000061", CATE_L_NM: "ペット用品", CATE_M_CD: "200000610", CATE_M_NM: "犬用食品", CATE_S_CD: "TEST-DOG-FISH", CATE_S_NM: "魚由来サプリメント" },
        { CATE_L_CD: "100000040", CATE_L_NM: "健康食品", CATE_M_CD: "200000401", CATE_M_NM: "サプリメント", CATE_S_CD: "TEST-VITAMIN", CATE_S_NM: "ビタミン" },
        { CATE_L_CD: "100000040", CATE_L_NM: "サプリメント", CATE_M_CD: "200000403", CATE_M_NM: "ビタミン", CATE_S_CD: "TEST-VITAMIN-OTHER", CATE_S_NM: "その他ビタミン" },
        { CATE_L_CD: "100000040", CATE_L_NM: "サプリメント", CATE_M_CD: "200000403", CATE_M_NM: "ビタミン", CATE_S_CD: "TEST-VITAMIN-A", CATE_S_NM: "ビタミンA" },
        { CATE_L_CD: "100000050", CATE_L_NM: "日用品雑貨", CATE_M_CD: "200000501", CATE_M_NM: "収納用品", CATE_S_CD: "TEST-STORAGE", CATE_S_NM: "収納ボックス・収納ケース" },
        { CATE_L_CD: "100000017", CATE_L_NM: "家具・インテリア", CATE_M_CD: "220000074", CATE_M_NM: "子供部屋家具", CATE_S_CD: "TEST-HANGER-CHILD", CATE_S_NM: "ハンガー" },
        { CATE_L_CD: "100000018", CATE_L_NM: "日用品雑貨", CATE_M_CD: "220000079", CATE_M_NM: "洗濯用品", CATE_S_CD: "TEST-HANGER-LAUNDRY", CATE_S_NM: "ハンガー" },
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
  ["고체 세정 비누 soap bar", "TEST-FACE-SOAP"],
  ["보습 스킨케어 크림", "320001621"],
  ["캔버스 토트 가방", "300000116"],
  ["로우컷 스니커 신발", "300000756"],
] as const;

for (const [query, expectedId] of qoo10RepresentativeCases) {
  test(`Qoo10 live leaf mapping chooses ${expectedId} for ${query}`, () => {
    assert.equal(normalizeSuggestions("qoo10", qoo10Response, query)[0]?.id, expectedId);
  });
}

const qoo10ProgramCatalogCases = [
  ["레드 립스틱", "TEST-LIPSTICK"],
  ["메이크업 브러시 세트", "TEST-BRUSH"],
  ["메이크업 스펀지", "TEST-SPONGE"],
  ["속눈썹 뷰러", "TEST-CURLER"],
  ["흰쌀밥", "TEST-RICE-PACK"],
  ["펜네 파스타", "TEST-PASTA"],
  ["밀가루", "TEST-FLOUR"],
  ["테디베어 완구", "TEST-TEDDY"],
  ["자동차 완구", "TEST-TOYCAR-MINI"],
  ["후드 재킷", "TEST-HOODIE"],
  ["오메가3 소프트젤", "TEST-DHA-EPA"],
  ["オメガ3 ソフトジェル", "TEST-DHA-EPA"],
  ["비타민 정제", "TEST-VITAMIN-OTHER"],
  ["ビタミン サプリメント", "TEST-VITAMIN-OTHER"],
  ["수납 박스", "TEST-STORAGE"],
  ["옷걸이 세트", "TEST-HANGER-LAUNDRY"],
  ["ハンガー セット", "TEST-HANGER-LAUNDRY"],
] as const;

for (const [query, expectedId] of qoo10ProgramCatalogCases) {
  test(`Qoo10 program catalog maps ${query}`, () => {
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

const smartstoreCategoryResponse = {
  ok: true,
  steps: [{
    name: "category-tree",
    ok: true,
    status: 200,
    data: { items: [
      { id: "500001", name: "풀오버", wholeCategoryName: "패션의류>여성의류>니트>풀오버", last: true },
      { id: "500002", name: "수납소파", wholeCategoryName: "가구/인테리어>거실가구>소파>수납소파", last: true },
      { id: "500003", name: "리빙박스", wholeCategoryName: "생활/건강>생활용품>수납/정리용품>리빙박스", last: true },
      { id: "500004", name: "공간박스", wholeCategoryName: "가구/인테리어>수납가구>공간박스", last: true },
    ] },
  }],
};

test("Smartstore category normalization ranks a storage-box leaf above unrelated equal-score leaves", () => {
  const suggestions = normalizeSuggestions("smartstore", smartstoreCategoryResponse, "[API TEST] 수납 박스 이미지 샘플");
  assert.equal(suggestions[0]?.id, "500003");
  assert.equal(suggestions.some((item) => item.id === "500001"), false);
});

test("Smartstore category normalization rejects arbitrary leaves without a lexical match", () => {
  assert.deepEqual(normalizeSuggestions("smartstore", smartstoreCategoryResponse, "산업용 무관 부품"), []);
});

const lazadaCategoryResponse = {
  ok: true,
  steps: [{
    name: "category-suggestion",
    ok: true,
    status: 200,
    data: { data: [
      { categoryId: "9001", categoryName: "Decorations", leaf: true, score: 0.58 },
      { categoryId: "9002", categoryName: "Aquariums, Tanks & Bowls", leaf: true, score: 0.58 },
    ] },
  }, {
    name: "category-tree",
    ok: true,
    status: 200,
    data: { data: [
      { category_id: "1001", name: "Lipstick", leaf: true },
      { category_id: "1002", name: "Facial Cleansers", leaf: true },
      { category_id: "1003", name: "Makeup Brushes", leaf: true },
    ] },
  }],
};

test("Lazada normalization rejects equal-score aquarium noise and chooses lipstick from the official tree", () => {
  assert.equal(normalizeSuggestions("lazada", lazadaCategoryResponse, "Sampel lipstik merah")[0]?.id, "1001");
});

test("Lazada normalization maps Malay soap wording to a beauty cleanser leaf", () => {
  assert.equal(normalizeSuggestions("lazada", lazadaCategoryResponse, "Sabun pembersih pepejal")[0]?.id, "1002");
});

test("Lazada normalization excludes a matching parent and keeps the official nested leaf path", () => {
  const response = {
    ok: true,
    steps: [{
      name: "category-tree",
      ok: true,
      status: 200,
      data: { data: [
        { category_id: "9", name: "Wheel Bearing Seals", leaf: true },
        {
          category_id: "10",
          name: "Stuffed Toys",
          leaf: false,
          children: [{ category_id: "11", name: "Teddy Bears", leaf: true }],
        },
      ] },
    }],
  };
  const suggestion = normalizeSuggestions("lazada", response, "Teddy bear plush toy")[0];
  assert.equal(suggestion?.id, "11");
  assert.deepEqual(suggestion?.path, ["Stuffed Toys", "Teddy Bears"]);
});
