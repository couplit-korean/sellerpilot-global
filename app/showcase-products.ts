import type { ProductStudioResult } from "./product-studio-types";

export type ShowcaseProduct = {
  slug: string;
  sku: string;
  name: string;
  category: string;
  image: string;
  photoCredit: string;
  sourceUrl?: string;
  result: ProductStudioResult;
};

type ShowcaseInput = {
  slug: string;
  sku: string;
  name: string;
  category: string;
  image: string;
  photoCredit: string;
  sourceUrl?: string;
  oneLine: string;
  targetCustomer: string;
  features: [string, string, string];
  themeName: string;
  palette: ProductStudioResult["design"]["palette"];
  heroCopy: string;
  heroSubcopy: string;
  thumbnail: ProductStudioResult["thumbnail"];
  usage: string[];
  specs: string[];
};

function createShowcaseProduct(input: ShowcaseInput): ShowcaseProduct {
  const result: ProductStudioResult = {
    mode: "demo",
    product: {
      name: input.name,
      category: input.category,
      oneLine: input.oneLine,
      targetCustomer: input.targetCustomer,
      features: input.features,
      cautions: [
        "판매 전 실제 제품 라벨과 공식 공급사 자료를 기준으로 정보를 확정하세요.",
        "국가와 판매 채널별 광고·표현 정책을 최종 검수하세요.",
      ],
    },
    design: {
      themeName: input.themeName,
      palette: input.palette,
      heroCopy: input.heroCopy,
      heroSubcopy: input.heroSubcopy,
      cta: "상품 정보 확인하기",
      sections: [
        {
          type: "benefit",
          eyebrow: "WHY YOU'LL LOVE IT",
          title: "선택해야 할 이유를 한눈에",
          body: "구매 결정에 필요한 핵심 특징을 간결하고 선명하게 정리했습니다.",
          points: input.features,
        },
        {
          type: "story",
          eyebrow: "PRODUCT STORY",
          title: input.oneLine,
          body: `${input.targetCustomer}을 위한 사용 경험과 제품의 분위기를 연결했습니다.`,
          points: ["일상에 자연스럽게 스며드는 구성", "선물하기 좋은 깔끔한 패키지", "모바일에서도 빠르게 읽히는 정보"],
        },
        {
          type: "howto",
          eyebrow: "HOW TO USE",
          title: "사용법은 짧고 정확하게",
          body: "구매 후 바로 이해할 수 있도록 권장 사용 흐름을 단계별로 안내합니다.",
          points: input.usage,
        },
        {
          type: "proof",
          eyebrow: "TRUST CHECK",
          title: "확인 가능한 정보만 담았습니다",
          body: "대표 이미지, 입력 설명과 공개 링크 정보를 교차 검토하는 운영 흐름을 반영했습니다.",
          points: ["대표 이미지 기반 상품 식별", "설명·이미지 교차 확인", "채널별 금칙어 사전 점검"],
        },
        {
          type: "spec",
          eyebrow: "PRODUCT INFO",
          title: "구매 전 필요한 상품 정보",
          body: "채널 등록에 재사용할 수 있도록 구성과 보관 정보를 표준 항목으로 정리했습니다.",
          points: input.specs,
        },
        {
          type: "caution",
          eyebrow: "PLEASE NOTE",
          title: "판매 전 마지막 검수",
          body: "현재 페이지는 샘플 데이터로 제작한 디자인 시연본입니다. 실제 판매 정보는 공급사 자료를 기준으로 교체하세요.",
          points: ["효능을 단정하는 표현 제외", "원재료·알레르기 정보 확인", "국가별 표시사항과 채널 정책 확인"],
        },
      ],
    },
    thumbnail: input.thumbnail,
    warnings: ["샘플 데이터로 자동 제작한 디자인 시연본입니다. 실제 상품 데이터 연결 시 동일 구조로 교체됩니다."],
  };

  return {
    slug: input.slug,
    sku: input.sku,
    name: input.name,
    category: input.category,
    image: input.image,
    photoCredit: input.photoCredit,
    sourceUrl: input.sourceUrl,
    result,
  };
}

export const showcaseProducts: ShowcaseProduct[] = [
  createShowcaseProduct({
    slug: "white-tomato-glutathione",
    sku: "IB-WTG-30",
    name: "화이트토마토 글루타치온 30정",
    category: "건강식품 · 이너뷰티",
    image: "/demo/setting-shots/premium-studio.png",
    photoCredit: "사용자 제공 실제 촬영 이미지",
    oneLine: "매일 한 정으로 시작하는 맑고 간편한 이너뷰티 루틴",
    targetCustomer: "간편한 데일리 이너뷰티 루틴을 찾는 20–40대 고객",
    features: ["화이트토마토와 글루타치온 배합", "하루 한 정의 간편한 섭취", "30일 루틴에 맞춘 패키지"],
    themeName: "Clean Botanical",
    palette: { primary: "#25352d", accent: "#d9eeae", surface: "#f4f1e9", text: "#17211c" },
    heroCopy: "오늘의 맑음을 채우는 한 정",
    heroSubcopy: "WHITE TOMATO · GLUTATHIONE · 30 DAY ROUTINE",
    thumbnail: { headline: "하루 한 정\n맑은 루틴", subline: "30 DAY DAILY ROUTINE", badge: "BEST · AI PICK" },
    usage: ["제품 라벨의 1일 권장량 확인", "충분한 물과 함께 섭취", "서늘하고 건조한 곳에 보관"],
    specs: ["구성: 30정 · 1개월분", "제조국: 대한민국", "보관: 직사광선을 피해 서늘한 곳"],
  }),
  createShowcaseProduct({
    slug: "osh-mens-fertility-support",
    sku: "OSH-MFS-60",
    name: "OSH Men's Fertility Support 60 Capsules",
    category: "건강보조식품 · 남성 웰니스",
    image: "/products/real-supplement-green.jpg",
    photoCredit: "Shruti Mishra · Unsplash",
    sourceUrl: "https://unsplash.com/photos/a-close-up-of-a-bottle-of-vitamin-supplement-8vmlqjhzBIs",
    oneLine: "자연 속에서 선명하게 보이는 60캡슐 웰니스 패키지",
    targetCustomer: "제품 라벨과 캡슐 구성을 빠르게 확인하려는 웰니스 관심 고객",
    features: ["라벨에 표시된 60 캡슐 구성", "Dietary Supplement 패키지", "식물 원료를 연상시키는 자연 배경"],
    themeName: "Forest Wellness",
    palette: { primary: "#142d25", accent: "#84aa70", surface: "#f2f1e7", text: "#122019" },
    heroCopy: "자연에서 시작되는 데일리 웰니스",
    heroSubcopy: "AYURVEDIC MEN'S FERTILITY SUPPORT · 60 CAPSULES",
    thumbnail: { headline: "자연을 담은\n60 캡슐 루틴", subline: "OSH WELLNESS · 60 CAPSULES", badge: "REAL · PRODUCT" },
    usage: ["공식 제품 라벨의 권장량 확인", "라벨에 표시된 주의사항 확인", "개봉 후 제품 용기를 밀봉"],
    specs: ["구성: 라벨 표기 60 캡슐", "형태: 보틀 패키지", "상품 정보: 공식 제조사 자료로 최종 확인"],
  }),
  createShowcaseProduct({
    slug: "kal-b12-5000",
    sku: "KAL-B12-5000",
    name: "KAL B-12 Methylcobalamin 5000 mcg",
    category: "비타민 · B-12",
    image: "/products/real-vitamin-hand.jpg",
    photoCredit: "Cosmin Ursea · Unsplash",
    sourceUrl: "https://unsplash.com/photos/a-person-holding-a-bottle-of-vitamins-in-their-hand-6Efl4omA9ZI",
    oneLine: "손안에서 바로 확인되는 B-12 5000 mcg 보틀",
    targetCustomer: "성분명과 용량을 먼저 비교하는 비타민 구매 고객",
    features: ["라벨 표기 5000 mcg", "60 로젠지 구성", "손에 잡히는 휴대형 보틀"],
    themeName: "Daily B12 Blue",
    palette: { primary: "#243944", accent: "#9fd3df", surface: "#f3eee7", text: "#18262d" },
    heroCopy: "한눈에 확인하는 B-12 데일리 보틀",
    heroSubcopy: "METHYLCOBALAMIN · 5000 MCG · 60 LOZENGES",
    thumbnail: { headline: "한눈에 보는\nB-12 5000", subline: "60 LOZENGES · DAILY", badge: "REAL · LABEL" },
    usage: ["공식 라벨의 섭취 방법 확인", "표기된 1일 섭취량 준수", "어린이 손이 닿지 않는 곳에 보관"],
    specs: ["표기량: 5000 mcg", "구성: 60 로젠지", "상품 정보: 공식 제조사 자료로 최종 확인"],
  }),
  createShowcaseProduct({
    slug: "everyday-humans-spf50",
    sku: "EH-OMB-SPF50",
    name: "Everyday Humans Oh My Bod! SPF50",
    category: "바디케어 · 선스크린",
    image: "/products/real-skincare-tube.jpg",
    photoCredit: "Lina Verovaya · Unsplash",
    sourceUrl: "https://unsplash.com/photos/pink-and-white-plastic-tube-bottle-BibJjO4sYrI",
    oneLine: "네온 컬러 위에서 선명하게 드러나는 SPF50 바디 선스크린",
    targetCustomer: "용량과 자외선 차단 지수를 빠르게 비교하는 바디케어 고객",
    features: ["패키지 전면 SPF50 표기", "100 ml 튜브 패키지", "박스와 본품을 함께 보여주는 구성"],
    themeName: "Neon Sun Care",
    palette: { primary: "#463019", accent: "#d9f44b", surface: "#fff2eb", text: "#2a2118" },
    heroCopy: "햇빛 아래 더 선명한 바디케어",
    heroSubcopy: "OH MY BOD! · SPF50 BODY SUNSCREEN · 100 ML",
    thumbnail: { headline: "선명하게 지키는\nSPF50 바디", subline: "100 ML · BODY SUNSCREEN", badge: "REAL · SPF50" },
    usage: ["외출 전 노출 부위에 고르게 사용", "제품 라벨에 따라 덧바르기", "사용 전 주의사항과 피부 적합성 확인"],
    specs: ["표기 용량: 100 ml", "유형: 바디 선스크린", "표기 지수: SPF50"],
  }),
  createShowcaseProduct({
    slug: "nuance-day-cream",
    sku: "NUANCE-DAY-CREAM",
    name: "Nuance Anti Ageing Complex Day Cream",
    category: "스킨케어 · 데이 크림",
    image: "/products/real-cream-jar.jpg",
    photoCredit: "Isaac Wolff · Unsplash",
    sourceUrl: "https://unsplash.com/photos/a-close-up-of-a-jar-of-cream-vbt81PHaOh0",
    oneLine: "레드와 골드 패키지로 완성한 프리미엄 데이 크림 무드",
    targetCustomer: "패키지와 크림 유형을 중심으로 비교하는 스킨케어 고객",
    features: ["Day Cream 라벨이 선명한 패키지", "레드·골드 프리미엄 컬러", "단단한 크림 자 타입"],
    themeName: "Red Gold Luxury",
    palette: { primary: "#541d1d", accent: "#d8b36a", surface: "#fff4e8", text: "#2b1814" },
    heroCopy: "레드와 골드로 완성한 데이 케어",
    heroSubcopy: "ANTI AGEING COMPLEX · DAY CREAM · NUANCE",
    thumbnail: { headline: "프리미엄 무드의\n데이 크림", subline: "NUANCE · DAY CREAM", badge: "REAL · SKINCARE" },
    usage: ["세안 후 스킨케어 단계에 사용", "제품 라벨의 사용법 확인", "사용 전 피부 이상 여부 확인"],
    specs: ["유형: 데이 크림", "용기: 크림 자 패키지", "상품 정보: 공식 제조사 자료로 최종 확인"],
  }),
];

export function getShowcaseProduct(slug: string) {
  return showcaseProducts.find((product) => product.slug === slug);
}
