import type { ProductStudioResult } from "./product-studio-types";

export function createDemoStudioResult(description = ""): ProductStudioResult {
  const isBeauty = /뷰티|글루타치온|콜라겐|토마토|이너뷰티|건강/i.test(description);
  return {
    mode: "demo",
    product: {
      name: isBeauty ? "화이트토마토 글루타치온 30정" : "셀러파일럿 추천 신상품",
      category: isBeauty ? "건강식품 · 이너뷰티" : "라이프스타일",
      oneLine: isBeauty ? "매일 한 정으로 시작하는 맑고 간편한 이너뷰티 루틴" : "사진 한 장에서 시작되는 설득력 있는 상품 이야기",
      targetCustomer: isBeauty ? "간편한 데일리 이너뷰티 루틴을 찾는 20–40대 고객" : "제품의 핵심 가치를 빠르게 비교하려는 온라인 고객",
      features: isBeauty
        ? ["화이트토마토와 글루타치온 배합", "하루 한 정의 간편한 섭취", "30일 루틴에 맞춘 패키지"]
        : ["핵심 장점을 빠르게 전달", "모바일 우선 상세 구성", "채널별 재가공이 쉬운 콘텐츠"],
      cautions: ["실제 원재료·함량은 제품 라벨과 대조가 필요합니다.", "과장 표현과 의학적 효능 표현은 채널 정책 검수가 필요합니다."],
    },
    design: {
      themeName: "Clean Botanical",
      palette: { primary: "#25352d", accent: "#d9eeae", surface: "#f4f1e9", text: "#17211c" },
      heroCopy: isBeauty ? "오늘의 맑음을 채우는 한 정" : "좋은 제품은 첫 화면에서 이해됩니다",
      heroSubcopy: isBeauty ? "WHITE TOMATO · GLUTATHIONE · 30 DAY ROUTINE" : "핵심 장점부터 사용 장면까지 한 번에 설계합니다.",
      cta: "지금 상품 확인하기",
      sections: [
        { type: "benefit", eyebrow: "WHY YOU'LL LOVE IT", title: "선택해야 할 이유가 선명해집니다", body: "복잡한 정보는 덜어내고 구매 결정에 필요한 핵심 세 가지를 먼저 보여줍니다.", points: ["핵심 원료와 특징", "간편한 사용 방식", "한눈에 보이는 구성"] },
        { type: "story", eyebrow: "PRODUCT STORY", title: "매일 이어지는 작은 루틴", body: "부담 없이 반복할 수 있는 경험을 중심으로 제품의 쓰임과 분위기를 연결했습니다.", points: ["데일리 루틴", "깔끔한 패키지", "선물하기 좋은 구성"] },
        { type: "howto", eyebrow: "HOW TO USE", title: "사용법은 짧고 정확하게", body: "구매 후 바로 이해할 수 있도록 사용 순서와 권장 상황을 간결하게 안내합니다.", points: ["제품 라벨의 권장량 확인", "일정한 시간에 꾸준히 사용", "보관 방법과 주의사항 확인"] },
        { type: "proof", eyebrow: "TRUST CHECK", title: "확인 가능한 정보만 담았습니다", body: "이미지 OCR, 입력 설명, 참고 링크를 교차 검토하고 불확실한 항목은 별도로 표시합니다.", points: ["라벨 OCR 검토", "설명·이미지 교차 확인", "채널 정책 표현 점검"] },
        { type: "spec", eyebrow: "PRODUCT INFO", title: "구매 전 필요한 상품 정보", body: "구성, 사용 대상, 보관과 유통 정보를 표준 항목으로 정리해 채널별 등록에 재사용합니다.", points: ["구성: 30정 · 1개월분", "제조국: 대한민국", "보관: 직사광선을 피해 서늘한 곳"] },
        { type: "caution", eyebrow: "PLEASE NOTE", title: "마지막 검수 항목", body: "실제 판매 전에는 제품 라벨과 공식 공급사 자료를 기준으로 표현과 수치를 최종 확정하세요.", points: ["질병 예방·치료 표현 제외", "원재료 및 알레르기 정보 확인", "국가·채널별 금칙어 확인"] },
      ],
    },
    thumbnail: { headline: isBeauty ? "하루 한 정\n맑은 루틴" : "한눈에 이해되는\n신상품", subline: "30 DAY DAILY ROUTINE", badge: "NEW · AI PICK" },
    warnings: ["현재 임의 데이터 미리보기입니다. OPENAI_API_KEY를 연결하면 업로드 이미지 기반 분석 결과로 자동 교체됩니다."],
  };
}
