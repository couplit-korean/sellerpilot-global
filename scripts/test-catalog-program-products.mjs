import { testCatalogSources } from "./test-catalog-sources.mjs";
import { fileURLToPath } from "node:url";

const categoryFacts = {
  cosmetics: {
    categoryHint: "뷰티 화장품",
    names: ["보습 크림 용기", "고체 세정 비누", "레드 립스틱"],
    materials: ["사진상 크림 제형·용기, 상세 성분 미확인", "사진상 고체 비누, 상세 성분 미확인", "사진상 립스틱·플라스틱 용기, 상세 성분 미확인"],
    packageContents: "사진 예시 상품 1개",
    weightKg: 0.2,
    dimensions: [12, 12, 8],
  },
  "beauty-tools": {
    categoryHint: "뷰티 화장도구",
    names: ["메이크업 브러시 세트", "메이크업 스펀지", "속눈썹 뷰러"],
    materials: ["사진상 합성모·금속·플라스틱, 상세 소재 미확인", "사진상 메이크업 스펀지, 상세 소재 미확인", "사진상 금속·고무 패드, 상세 소재 미확인"],
    packageContents: "사진 예시 상품 1세트",
    weightKg: 0.25,
    dimensions: [22, 15, 6],
  },
  food: {
    categoryHint: "식품",
    names: ["흰쌀밥 이미지 샘플", "펜네 파스타 이미지 샘플", "밀가루 이미지 샘플"],
    materials: ["사진상 조리된 흰쌀밥, 원재료·알레르기 정보 미확인", "사진상 건조 펜네 파스타, 원재료·알레르기 정보 미확인", "사진상 밀가루, 원재료·알레르기 정보 미확인"],
    packageContents: "사진 예시 식품 1개",
    weightKg: 0.5,
    dimensions: [20, 15, 8],
  },
  clothing: {
    categoryHint: "의류",
    names: ["반팔 티셔츠 전면 이미지 샘플", "반팔 티셔츠 후면 이미지 샘플", "후드 재킷 이미지 샘플"],
    materials: ["사진상 직물 티셔츠, 혼용률 미확인", "사진상 직물 티셔츠, 혼용률 미확인", "사진상 직물 후드 의류, 혼용률 미확인"],
    packageContents: "사진 예시 의류 1개",
    weightKg: 0.6,
    dimensions: [35, 28, 8],
  },
  toys: {
    categoryHint: "장난감",
    names: ["테디베어 완구 이미지 샘플", "노란색 자동차 완구 이미지 샘플", "소프트 자동차 완구 이미지 샘플"],
    materials: ["사진상 직물·충전재 완구, 상세 소재 미확인", "사진상 자동차 모형 완구, 상세 소재 미확인", "사진상 연질 플라스틱 완구, 상세 소재 미확인"],
    packageContents: "사진 예시 완구 1개",
    weightKg: 0.4,
    dimensions: [25, 20, 15],
  },
  "health-supplement": {
    categoryHint: "건강식품",
    names: ["어유 캡슐 이미지 샘플", "오메가3 소프트젤 이미지 샘플", "비타민 정제 이미지 샘플"],
    materials: ["사진상 어유 캡슐, 실제 원료·함량·효능 미확인", "사진상 오메가3 소프트젤, 실제 원료·함량·효능 미확인", "사진상 비타민 정제, 실제 원료·함량·효능 미확인"],
    packageContents: "사진 예시 건강식품 1개",
    weightKg: 0.2,
    dimensions: [12, 8, 8],
  },
  miscellaneous: {
    categoryHint: "잡화",
    names: ["캔버스 토트백 이미지 샘플", "수납 박스 이미지 샘플", "옷걸이 세트 이미지 샘플"],
    materials: ["사진상 캔버스 직물, 상세 소재 미확인", "사진상 수납 박스, 상세 소재 미확인", "사진상 옷걸이, 상세 소재 미확인"],
    packageContents: "사진 예시 잡화 1개",
    weightKg: 0.5,
    dimensions: [35, 30, 10],
  },
};

const categoryIndexes = new Map();

export const testCatalogProgramProducts = testCatalogSources.map((source) => {
  const facts = categoryFacts[source.category];
  const index = categoryIndexes.get(source.category) ?? 0;
  categoryIndexes.set(source.category, index + 1);
  const name = facts.names[index];
  return {
    ...source,
    imagePath: fileURLToPath(new URL(`../public/test-catalog/${source.file}`, import.meta.url)),
    productName: `[API TEST · 판매금지] ${name}`,
    categoryHint: facts.categoryHint,
    brandName: "No Brand",
    manufacturer: "공개 이미지 원문에 제조사 미기재",
    countryOfOrigin: "공개 이미지 원문에 원산지 미기재",
    material: facts.materials[index],
    packageContents: facts.packageContents,
    condition: "NEW",
    gtinStatus: "NO_GTIN",
    gtin: "",
    sellingPrice: 10000,
    currency: "KRW",
    stock: 1,
    weightKg: facts.weightKg,
    packageLengthCm: facts.dimensions[0],
    packageWidthCm: facts.dimensions[1],
    packageHeightCm: facts.dimensions[2],
    description: `[PROGRAM API TEST · NOT FOR SALE] ${name} 카테고리·이미지·채널 연동 검수용 자료입니다. 판매 목적의 상품 정보가 아니며, 제조사·원산지·상세 성분 또는 소재는 공개 이미지 원문에서 확인되지 않았습니다. 이미지 출처: ${source.creator}, 라이선스: ${source.license}.`,
    productUrl: source.source,
    imageRightsConfirmed: true,
    productFactsConfirmed: true,
  };
});
