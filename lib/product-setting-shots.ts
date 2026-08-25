import type { AiGeneratedAssetId } from "./ai-generated-assets";

export const settingShotAssetIds = ["portrait", "wide", "detail-overview", "detail-use"] as const satisfies readonly AiGeneratedAssetId[];
export const settingShotDimensions = ["location", "moment", "surface", "supportingObjects", "staging", "camera"] as const;

export type SettingShotAssetId = (typeof settingShotAssetIds)[number];
export type SettingShotDimension = (typeof settingShotDimensions)[number];
export type SettingShotSeparation = Record<SettingShotDimension, string>;

export type ProductSettingShot = {
  label: string;
  location: string;
  moment: string;
  surface: string;
  supportingObjects: string;
  staging: string;
  camera: string;
  separation: SettingShotSeparation;
};

export type ProductSettingShotPlan = Record<SettingShotAssetId, ProductSettingShot>;

type SceneDescriptions = [location: string, moment: string, surface: string, supportingObjects: string, staging: string];
type SceneSeparation = [location: string, moment: string, surface: string, supportingObjects: string, staging: string];
type CameraContract = [key: string, description: string];
type SceneParts = { descriptions: SceneDescriptions; separation: SceneSeparation; camera: CameraContract };

const cameras = {
  portrait: ["low-right-vertical-35mm", "상품보다 약간 낮은 오른쪽 35mm 세로 3/4 시점으로 공간의 앞뒤 층을 함께 보여준다"],
  wide: ["high-left-lateral-28mm", "왼쪽 위에서 내려보는 28mm 가로 시점으로 상품과 활동 영역 사이의 긴 동선을 만든다"],
  overview: ["high-rear-overview-50mm", "상품 뒤쪽 위 50mm 사선 시점으로 전체 형태와 보관·준비 공간의 관계를 읽게 한다"],
  use: ["table-level-opposite-65mm", "표면 높이의 반대편 65mm 시점으로 기능 결과를 전경에 두고 상품을 다른 깊이에 분리한다"],
} as const satisfies Record<"portrait" | "wide" | "overview" | "use", CameraContract>;

function scene(separation: SceneSeparation, descriptions: SceneDescriptions, camera: CameraContract): SceneParts {
  return { separation, descriptions, camera };
}

function shot(label: string, parts: SceneParts): ProductSettingShot {
  const [location, moment, surface, supportingObjects, staging] = parts.descriptions;
  const [locationKey, momentKey, surfaceKey, supportingObjectsKey, stagingKey] = parts.separation;
  return {
    label,
    location,
    moment,
    surface,
    supportingObjects,
    staging,
    camera: parts.camera[1],
    separation: {
      location: locationKey,
      moment: momentKey,
      surface: surfaceKey,
      supportingObjects: supportingObjectsKey,
      staging: stagingKey,
      camera: parts.camera[0],
    },
  };
}

export function assertDistinctSettingShotPlan(plan: ProductSettingShotPlan, planLabel = "product") {
  const shots = Object.values(plan);
  for (const dimension of settingShotDimensions) {
    const values = shots.map((item) => item.separation[dimension].trim());
    if (values.some((value) => !value) || new Set(values).size !== settingShotAssetIds.length) {
      throw new Error(`${planLabel} 설정샷의 ${dimension} 의미 분리 계약이 중복되었습니다.`);
    }
    const descriptions = shots.map((item) => item[dimension].trim());
    if (descriptions.some((value) => !value) || new Set(descriptions).size !== settingShotAssetIds.length) {
      throw new Error(`${planLabel} 설정샷의 ${dimension} 촬영 지시가 중복되었습니다.`);
    }
  }
  return plan;
}

function plan(planLabel: string, parts: Record<SettingShotAssetId, SceneParts>): ProductSettingShotPlan {
  return assertDistinctSettingShotPlan({
    portrait: shot("설정샷 1", parts.portrait),
    wide: shot("설정샷 2", parts.wide),
    "detail-overview": shot("설정샷 3", parts["detail-overview"]),
    "detail-use": shot("설정샷 4", parts["detail-use"]),
  }, planLabel);
}

function cerealPlan() {
  return plan("cereal", {
    portrait: scene(
      ["breakfast-nook", "dawn-breakfast", "light-oak", "cereal-bowl-linen", "package-right-bowl-low-left"],
      ["주방과 분리된 창가의 작은 원목 아침 식탁", "등교·출근 전 첫 식사를 막 차리는 이른 아침", "결이 선명한 밝은 참나무 식탁", "실제 섭취를 설명하는 투명 시리얼 볼과 접힌 흰 리넨만 사용", "패키지는 오른쪽 뒤에 세우고 볼은 왼쪽 낮은 전경에 두어 비대칭 세로 깊이를 만든다"],
      cameras.portrait,
    ),
    wide: scene(
      ["modern-kitchen-island", "late-morning-portioning", "brushed-stainless", "portion-cup-serving-tray", "package-left-prep-right"],
      ["정돈된 현대식 주방의 넓은 독립 조리대", "늦은 오전에 1회분을 덜어 이동 간식을 준비하는 순간", "빛을 차갑게 반사하는 브러시드 스테인리스 상판", "빈 1회분 컵과 낮은 서빙 트레이만 사용하며 아침 식탁 소품은 반복하지 않는다", "패키지는 왼쪽 가장자리, 준비 영역은 오른쪽에 길게 두어 가로 동선을 만든다"],
      cameras.wide,
    ),
    "detail-overview": scene(
      ["walk-in-pantry", "midday-restock", "matte-cream-shelf", "single-storage-basket", "package-rear-center-shelf-edge"],
      ["문이 열린 독립 팬트리의 상온 식품 선반", "낮에 장을 본 뒤 보관 위치를 정리하는 순간", "빛 반사가 없는 크림색 도장 선반", "다른 브랜드나 추가 제품 없이 낮은 수납 바구니 하나만 배경에 둔다", "패키지를 선반 뒤 중앙에 두고 앞 가장자리를 비워 실제 크기와 수납 깊이를 보여준다"],
      cameras.overview,
    ),
    "detail-use": scene(
      ["living-room-sofa-side", "evening-snack", "dark-walnut-table", "snack-cup-closed-book", "snack-front-package-back-left"],
      ["창문·주방·다이닝 가구가 보이지 않는 거실 소파 옆", "따뜻한 스탠드 조명 아래 저녁 간식을 먹기 직전", "낮고 짙은 월넛 사이드 테이블", "완성된 시리얼 스낵컵과 닫힌 무지 책 한 권만 사용하며 앞 장면의 볼·리넨·트레이는 쓰지 않는다", "스낵컵을 중앙 전경의 주인공으로, 패키지를 왼쪽 후경에 낮춰 아침 장면과 반대 배치로 만든다"],
      cameras.use,
    ),
  });
}

function coffeeTeaPlan() {
  return plan("coffee-tea", {
    portrait: scene(["bedroom-balcony-ledge", "sunrise-first-cup", "warm-terracotta", "cup-single-brewer", "package-upper-right-cup-lower-left"], ["침실과 연결된 작은 발코니의 음료 선반", "해가 막 오른 뒤 첫 잔을 준비하는 아침", "따뜻한 무광 테라코타 선반", "깨끗한 컵과 상품에 맞는 추출 도구 하나만 사용", "제품은 오른쪽 위, 컵은 왼쪽 아래에 두어 세로 대각선을 만든다"], cameras.portrait),
    wide: scene(["office-breakroom", "midmorning-refill", "brushed-steel-counter", "travel-tumbler-filter", "package-far-left-tools-right"], ["업무 공간과 분리된 오피스 브레이크룸", "오전 업무 중 텀블러를 채우기 직전", "긴 브러시드 스틸 음료 조리대", "텀블러와 확인된 필터·티 인퓨저 중 맞는 도구만 사용", "제품은 먼 왼쪽, 준비 도구는 오른쪽에 두어 긴 가로 이동을 만든다"], cameras.wide),
    "detail-overview": scene(["dry-goods-cabinet", "afternoon-restock", "powder-coated-wire-shelf", "single-airtight-jar", "package-back-right-door-frame"], ["주방 밖 건식 식품 수납장의 안쪽 선반", "오후에 보관 상태와 잔량을 확인하는 순간", "흰색 분체도장 철망 선반", "다른 브랜드 없이 비어 있는 밀폐 용기 하나만 배경에 둔다", "패키지를 뒤 오른쪽에 두고 열린 문틀과 선반 깊이가 함께 보이게 한다"], cameras.overview),
    "detail-use": scene(["living-room-reading-corner", "late-evening-drink", "black-leather-top", "finished-drink-reading-glasses", "drink-front-product-rear-right"], ["거실의 독립된 독서 코너", "늦은 저녁 완성 음료를 마시기 직전", "검은 가죽 상판의 작은 독서 테이블", "완성 음료 한 잔과 접힌 독서 안경만 사용", "음료를 왼쪽 전경, 제품을 오른쪽 후경에 두어 다른 세 장면과 반대 깊이를 만든다"], cameras.use),
  });
}

function generalFoodPlan() {
  return plan("general-food", {
    portrait: scene(["grocery-unpacking-island", "morning-unpack", "butcher-block-maple", "single-prep-bowl", "package-right-contents-low-center"], ["현관과 가까운 식료품 정리용 키친 아일랜드", "아침 장바구니에서 상품을 꺼낸 직후", "두꺼운 메이플 부처블록 상판", "상품 사실에 맞는 빈 준비 볼 하나만 사용", "제품은 오른쪽에 세우고 확인된 내용물은 낮은 중앙에만 둔다"], cameras.portrait),
    wide: scene(["covered-patio-prep-cart", "noon-cooking-prep", "galvanized-metal-cart", "single-cooking-tool", "package-left-work-zone-right"], ["비를 피할 수 있는 야외 테라스의 이동식 준비 카트", "한낮 조리를 시작하기 직전", "아연도금 금속 카트 상판", "실제 조리에 필요한 도구 하나와 확인된 내용물만 사용", "패키지는 왼쪽 끝, 조리 준비 영역은 오른쪽에 넓게 분리한다"], cameras.wide),
    "detail-overview": scene(["deep-pantry-alcove", "afternoon-storage-check", "matte-laminate-shelf", "single-wire-basket", "package-back-center-empty-front"], ["주방과 떨어진 깊은 팬트리 벽감", "오후에 보관 조건을 확인하는 순간", "회백색 무광 라미네이트 선반", "다른 식품 없이 철제 수납 바구니 하나만 둔다", "패키지를 뒤 중앙에 두고 앞쪽 선반을 비워 전체와 보관 맥락을 보여준다"], cameras.overview),
    "detail-use": scene(["formal-dining-table", "evening-serving", "woven-mat-dark-wood", "finished-dish-cutlery", "dish-front-package-far-back"], ["주방이 보이지 않는 독립 다이닝 공간", "저녁 식사를 내기 직전", "직조 매트가 놓인 짙은 체리우드 테이블", "상품 정보로 뒷받침되는 완성 음식과 식기만 사용", "완성 음식은 크게 전경, 제품은 먼 후경에 두어 결과와 원재료 역할을 분리한다"], cameras.use),
  });
}

function foodPlan(productText: string) {
  if (/시리얼|cereal|오트밀|oatmeal|granola|그래놀라/i.test(productText)) return cerealPlan();
  if (/커피|coffee|원두|tea|티백|차\b/i.test(productText)) return coffeeTeaPlan();
  return generalFoodPlan();
}

const categoryPlans: Record<string, ProductSettingShotPlan> = {
  "beauty-skincare": plan("beauty-skincare", {
    portrait: scene(["bathroom-vanity", "morning-post-cleanse", "pale-limestone", "single-folded-towel", "product-right-mirror-left-depth"], ["아침 자연광이 드는 욕실 세면대", "세안 직후 첫 스킨케어 단계를 준비하는 아침", "미세한 결의 밝은 석회석 세면대", "깨끗하게 접은 수건 하나만 사용", "용기를 오른쪽에 세우고 왼쪽 거울 반사는 빈 공간 깊이로만 쓴다"], cameras.portrait),
    wide: scene(["bedroom-nightstand", "bedtime-final-step", "smoked-walnut", "ceramic-tray-sleep-mask", "product-left-routine-space-right"], ["욕실과 분리된 침실의 낮은 나이트스탠드", "취침 전 마지막 관리 단계를 준비하는 밤", "연기색 짙은 월넛 상판", "작은 세라믹 트레이와 접힌 무지 수면안대만 사용", "제품은 왼쪽 끝에 두고 오른쪽 루틴 공간을 길게 비운다"], cameras.wide),
    "detail-overview": scene(["hallway-linen-cabinet", "midday-storage", "frosted-glass-shelf", "single-cotton-basket", "product-rear-center-cap-visible"], ["복도의 리넨 수납장 안쪽", "낮 시간에 보관 상태를 확인하는 순간", "반투명 서리 유리 선반", "다른 화장품 없이 낮은 면 수납 바구니 하나만 둔다", "용기를 뒤 중앙에 놓고 캡·펌프와 선반 깊이가 함께 보이게 한다"], cameras.overview),
    "detail-use": scene(["gym-locker-vanity", "after-workout-refresh", "brushed-stainless-vanity", "plain-toiletry-pouch", "product-front-left-pouch-back-right"], ["사람이 없는 체육관 탈의실의 세면 코너", "운동 후 간단한 관리를 시작하기 직전", "물기 없는 브러시드 스테인리스 세면 상판", "닫힌 무지 세면 파우치만 사용하고 다른 제품은 두지 않는다", "제품은 왼쪽 전경, 파우치는 오른쪽 후경에 두어 욕실 장면과 반대 구도를 만든다"], cameras.use),
  }),
  "beauty-tools": plan("beauty-tools", {
    portrait: scene(["bedroom-dressing-table", "morning-makeup", "whitewashed-oak", "standing-mirror", "tools-vertical-right-heads-high"], ["침실 창가의 개인 화장대", "아침 메이크업을 시작하기 전", "백색 워시드 오크 화장대", "단순한 스탠드 거울 하나만 사용", "도구를 오른쪽 세로축에 펼쳐 모든 헤드가 위쪽에서 겹치지 않게 한다"], cameras.portrait),
    wide: scene(["home-office-craft-desk", "afternoon-sorting", "blue-grey-linoleum", "single-section-tray", "tools-left-to-right-workflow"], ["생활 공간과 분리된 홈오피스 취미 책상", "오후에 도구 용도를 나눠 정리하는 순간", "청회색 리놀륨 작업 상판", "칸이 하나인 무광 분류 트레이만 사용", "도구를 왼쪽에서 오른쪽 사용 순서로 길게 배열한다"], cameras.wide),
    "detail-overview": scene(["entry-luggage-bench", "pre-travel-packing", "woven-canvas-bench", "verified-case-only", "tools-center-case-rear"], ["현관 옆 여행 짐 전용 벤치", "외출용 파우치에 넣기 직전", "촘촘한 캔버스 직물 벤치", "포함이 확인된 케이스가 있을 때만 사용", "실제 구성은 중앙에 완전히 펼치고 케이스는 뒤쪽에만 둔다"], cameras.overview),
    "detail-use": scene(["laundry-utility-sink", "post-use-cleaning", "ribbed-silicone-mat", "verified-cleaning-piece", "heads-front-handles-back-diagonal"], ["욕실과 떨어진 세탁실의 유틸리티 싱크", "사용 후 세척·건조를 시작하는 단계", "골이 있는 단색 실리콘 건조 매트", "물방울과 포함이 확인된 세척 부품만 사용", "도구 헤드는 전경, 손잡이는 후경으로 향하는 긴 사선에 둔다"], cameras.use),
  }),
  "men-tops": plan("men-tops", {
    portrait: scene(["bedroom-wardrobe", "morning-outfit-choice", "matte-ash-wood", "single-hanger", "garment-full-height-center-right"], ["자연광이 드는 침실 옷장 앞", "외출복을 고르는 아침", "무광 애시우드 옷장 문", "옷걸이 하나만 사용하고 다른 의류는 두지 않는다", "의류 전체 실루엣을 중앙보다 오른쪽 세로축에 완전히 보이게 건다"], cameras.portrait),
    wide: scene(["entryway-foyer", "pre-departure-styling", "dark-slate-bench", "single-clothes-brush", "garment-left-bench-empty-right"], ["침실과 분리된 현관 포이어", "문을 나서기 직전 최종 상태를 보는 순간", "짙은 슬레이트 상판 벤치", "단순한 옷솔 하나만 환경 소품으로 사용", "의류는 왼쪽에 길게 놓고 오른쪽 벤치는 비워 가로 실루엣을 만든다"], cameras.wide),
    "detail-overview": scene(["laundry-folding-station", "afternoon-folding", "white-quartz-counter", "single-folding-board", "garment-center-folded-label-up"], ["세탁실의 독립 접이 작업대", "오후에 세탁·건조 후 접어 보관하기 직전", "밝은 흰색 쿼츠 상판", "무지 접이 보드 하나만 사용", "한 벌을 중앙에 접되 확인 가능한 라벨·두께와 전체 폭이 읽히게 한다"], cameras.overview),
    "detail-use": scene(["guest-room-luggage-area", "evening-trip-pack", "neutral-wool-cover", "empty-open-suitcase", "garment-front-suitcase-back-left"], ["손님방의 여행 가방 정리 공간", "저녁에 다음 날 여행 짐을 꾸리기 직전", "중립색 울 침대 커버", "완전히 빈 열린 캐리어만 사용", "의류는 전경에 완전히 펼치고 캐리어는 왼쪽 후경으로 밀어 길이와 형태를 유지한다"], cameras.use),
  }),
  "toys-games": plan("toys-games", {
    portrait: scene(["child-bedroom-reading-nook", "morning-play-start", "light-cork-platform", "single-book-bin", "product-upper-right-parts-low-left"], ["햇빛이 드는 어린이 방의 독서 벽감", "아침 놀이를 시작하기 직전", "밝은 코르크 단차 플랫폼", "인물 없이 낮은 책 수납함 하나만 둔다", "완성 제품은 오른쪽 위, 확인된 부품은 왼쪽 낮은 전경에 분리한다"], cameras.portrait),
    wide: scene(["living-room-floor", "afternoon-rule-layout", "solid-wool-rug", "included-parts-only", "parts-left-result-right"], ["가구를 치운 넓은 거실 바닥", "오후에 놀이 규칙과 구성품을 펼쳐 보는 순간", "단색 짙은 울 러그", "상품에 실제 포함된 구성품만 사용", "남은 구성품은 왼쪽, 놀이 결과는 오른쪽으로 나눠 긴 흐름을 만든다"], cameras.wide),
    "detail-overview": scene(["hall-storage-closet", "evening-cleanup", "matte-birch-shelf", "verified-storage-box", "product-rear-box-front-open"], ["놀이방 밖 복도의 수납장", "저녁 놀이 후 정리하기 직전", "무광 자작나무 선반", "포함이 확인된 수납함이 있을 때만 사용", "제품 전체를 뒤쪽에 두고 앞쪽 수납 관계와 실제 수량을 위에서 읽게 한다"], cameras.overview),
    "detail-use": scene(["covered-balcony-activity-table", "weekend-active-play", "mint-powder-coated-table", "included-active-pieces", "result-front-pieces-back-right"], ["비를 피할 수 있는 발코니의 낮은 활동 테이블", "주말 낮 대표 놀이가 진행되는 중간 상태", "민트색 분체도장 금속 테이블", "사람·손 없이 포함된 작동 부품만 사용", "놀이 결과는 왼쪽 전경, 남은 부품은 오른쪽 후경에 분리한다"], cameras.use),
  }),
  "food-supplement": plan("food-supplement", {
    portrait: scene(["kitchen-breakfast-shelf", "sunrise-daily-portion", "pale-bamboo", "single-water-glass", "package-upper-left-water-lower-right"], ["아침 햇빛이 드는 주방의 작은 식사 선반", "하루 섭취분을 준비하기 전", "밝은 대나무 집성 선반", "맑은 물 한 잔만 사용", "패키지는 왼쪽 위에 세우고 물잔은 오른쪽 낮은 전경에 둔다"], cameras.portrait),
    wide: scene(["office-focus-desk", "midday-work-break", "charcoal-felt-desk", "water-bottle-blank-note", "product-left-water-right"], ["주방과 떨어진 조용한 업무용 책상", "낮 업무 중 섭취 시간을 확인하는 순간", "차콜색 펠트 데스크 매트", "물병과 아무 글자 없는 메모 카드만 사용", "제품은 왼쪽, 물은 오른쪽 끝에 두어 넓게 분리한다"], cameras.wide),
    "detail-overview": scene(["gym-locker-shelf", "late-afternoon-storage", "perforated-steel-shelf", "single-zip-pouch", "package-back-center-lid-visible"], ["사람이 없는 체육관 개인 사물함", "늦은 오후 보관 상태를 확인하는 순간", "구멍이 난 회색 철제 선반", "닫힌 단색 지퍼 파우치 하나만 배경에 둔다", "패키지를 뒤 중앙에 두고 뚜껑·라벨과 선반 깊이를 함께 보여준다"], cameras.overview),
    "detail-use": scene(["dining-sideboard", "evening-post-meal", "dark-green-marble", "verified-serving-water", "serving-front-package-rear-right"], ["식탁 옆 독립 다이닝 사이드보드", "저녁 식사 후 확인된 섭취법에 따라 먹기 직전", "짙은 녹색 대리석 상판", "물 한 잔과 확인된 1회 섭취분만 사용", "1회분은 왼쪽 전경, 제품은 오른쪽 후경에 두어 추가 수량으로 오해되지 않게 한다"], cameras.use),
  }),
};

const generalPlan = plan("general-commerce", {
  portrait: scene(["entryway-console", "morning-ready-to-use", "natural-rattan", "single-function-cue", "product-upper-right-cue-lower-left"], ["상품 크기와 용도에 맞춘 현관 콘솔 주변", "아침에 처음 사용하려는 직전", "상품과 대비되는 천연 라탄 표면", "기능을 설명하는 검증 가능한 환경 소품 하나만 사용", "상품은 오른쪽 위, 기능 단서는 왼쪽 낮은 전경에 둔다"], cameras.portrait),
  wide: scene(["home-office-workbench", "midday-task-setup", "blue-rubber-worktop", "different-function-cue", "product-left-task-zone-right"], ["첫 장면과 분리된 홈오피스 작업대", "한낮 실제 작업을 준비하는 순간", "파란 무광 고무 작업 상판", "첫 장면과 겹치지 않는 기능성 소품 하나만 사용", "상품은 왼쪽 끝, 실제 작업 영역은 오른쪽에 길게 둔다"], cameras.wide),
  "detail-overview": scene(["utility-closet", "afternoon-storage", "white-wire-shelf", "single-storage-divider", "product-rear-center-empty-front"], ["상품이 실제로 보관되는 독립 유틸리티 수납장", "오후에 보관 위치에서 꺼내기 직전", "흰색 철망 선반", "다른 판매 상품 없이 수납 칸막이 하나만 둔다", "상품은 뒤 중앙에 두고 앞 선반을 비워 전체 크기와 보관 관계를 보여준다"], cameras.overview),
  "detail-use": scene(["covered-balcony-table", "evening-core-use", "dark-composite-slab", "verified-use-target", "result-front-product-back-right"], ["앞 세 장소와 겹치지 않는 지붕 있는 발코니 작업 테이블", "저녁에 핵심 기능이 가장 분명하게 수행되는 순간", "짙은 복합소재 슬래브 표면", "상품 사실로 뒷받침되는 사용 대상만 두고 장식 소품은 배제", "기능 결과는 왼쪽 전경, 상품은 오른쪽 후경에 두어 사용법을 설명한다"], cameras.use),
});

export function buildProductSettingShotPlan(categoryId: string, productText: string): ProductSettingShotPlan {
  if (categoryId === "food-staples") return foodPlan(productText);
  return categoryPlans[categoryId] ?? generalPlan;
}

export function formatProductSettingShot(setting: ProductSettingShot) {
  const separation = settingShotDimensions.map((dimension) => setting.separation[dimension]).join("/");
  return `${setting.label} · 장소=${setting.location} · 시간대·순간=${setting.moment} · 표면=${setting.surface} · 허용 소품=${setting.supportingObjects} · 상품 위치=${setting.staging} · 카메라=${setting.camera} · 장면 분리키=${separation}`;
}
