import type { AiGeneratedAssetId } from "./ai-generated-assets";

export type FoodPresentationMode = "cook-and-serve" | "open-and-serve" | "brew-and-serve" | "pour-and-serve" | "prepared-mix";

export type FoodPresentationSlot = {
  mode: FoodPresentationMode;
  state: "prepared-hero" | "active-serving";
  scene: string;
  requiredVisuals: string;
  forbiddenVisuals: string;
};

type FoodPresentationRule = {
  mode: FoodPresentationMode;
  prepared: string;
  active: string;
  forbidden: string;
};

const foodPresentationRules: Readonly<Record<string, FoodPresentationRule>> = {
  "food-cup-noodles": {
    mode: "cook-and-serve",
    prepared: "뚜껑을 자연스럽게 열어 실제 컵 안에 익은 면과 따뜻한 국물이 보이는 완성 상태. 컵 전면 브랜드 식별부도 함께 보여준다",
    active: "열린 컵에서 젓가락으로 익은 면을 들어 올린 가까운 섭취 직전 장면. 국물과 면에서만 자연스러운 김이 올라온다",
    forbidden: "밀봉 뚜껑에서 나는 김, 빈 배경, 제품 없는 음식, 별도 그릇으로 바꾼 라면, 계란·파·고기 같은 확인되지 않은 추가 토핑, 봉지라면·큰사발·다른 맛 패키지",
  },
  "food-instant-bag-noodles": {
    mode: "cook-and-serve",
    prepared: "실제 봉지 패키지를 식별할 수 있게 남기고 포장 조리법에 맞춘 기본 면과 국물을 한 그릇에 보여준다",
    active: "젓가락으로 기본 조리 면을 한 번 들어 올리되 봉지 패키지와 같은 맛 제품임을 함께 식별시킨다",
    forbidden: "컵라면 용기, 확인되지 않은 계란·파·고기·치즈·소스, 제품 없는 라면, 밀봉 봉지에서 나는 김",
  },
  "food-pasta-dry-noodles": {
    mode: "cook-and-serve",
    prepared: "건면 패키지와 제품 형태에 맞게 삶은 기본 면을 소스 없이 소량 함께 보여준다",
    active: "포크로 삶은 면의 굵기와 형태를 한 번 들어 보여주고 원래 패키지 식별부를 남긴다",
    forbidden: "토마토·크림·오일 소스, 치즈·허브·고기·해산물 고명, 다른 면 형태, 제품 없는 플레이팅",
  },
  "food-noodles": {
    mode: "cook-and-serve",
    prepared: "포장에 맞는 기본 조리법으로 완성된 면 요리를 제품 패키지와 함께 보여주는 준비 완료 장면",
    active: "익은 면의 질감이 보이도록 젓가락 또는 포크로 한 번 들어 올린 섭취 직전 장면",
    forbidden: "확인되지 않은 토핑·소스·그릇, 제품 없이 음식만 보이는 장면, 원재료나 산지를 암시하는 장식",
  },
  "food-ready-meal": {
    mode: "cook-and-serve",
    prepared: "제품 용법에 맞게 데우거나 개봉한 기본 완성 상태를 원래 포장과 함께 보여준다",
    active: "먹기 직전의 따뜻한 완성 질감과 원래 포장 식별부를 한 프레임에 보여준다",
    forbidden: "확인되지 않은 반찬·가니시·식기 구성, 제품 없는 식탁, 과장된 김이나 조리 효과",
  },
  "food-soup-stew": {
    mode: "cook-and-serve",
    prepared: "실제 파우치 또는 용기를 식별할 수 있게 남기고 표시된 제품 종류의 기본 가열 완료 상태를 함께 보여준다",
    active: "국물과 확인 가능한 고형분의 기본 질감이 보이는 가까운 장면에 원래 포장을 남긴다",
    forbidden: "제품 표시나 제공 사진에 없는 고기·채소·파·계란·뚝배기·반찬, 제품 없는 국물",
  },
  "food-kimchi-pickle": {
    mode: "open-and-serve",
    prepared: "원래 용기 또는 파우치를 개봉하고 제품 유형에 맞는 실제 절임 내용물을 소량 함께 보여준다",
    active: "절단 크기와 국물 상태가 보이는 가까운 장면에 원래 포장 식별부를 남긴다",
    forbidden: "밥·고기·반찬 상차림, 제품에 없는 고춧가루·채소 추가, 발효 효과, 제품 없는 접시",
  },
  "food-meal-kit": {
    mode: "cook-and-serve",
    prepared: "실제 외포장과 제공된 구성품 범위만 사용해 조리법에 맞춘 기본 완성 상태를 함께 보여준다",
    active: "완성 음식의 핵심 구성과 원래 외포장 식별부가 함께 보이는 섭취 직전 장면",
    forbidden: "제공되지 않은 구성품·고명·식기·소스·조리기구, 고급 레스토랑 플레이팅, 제품 없는 음식",
  },
  "food-frozen": {
    mode: "cook-and-serve",
    prepared: "제품 종류에 맞게 조리된 기본 완성 상태와 실제 포장을 함께 보여준다",
    active: "완성 음식의 표면과 속성을 구매자가 이해할 수 있는 가까운 섭취 직전 장면",
    forbidden: "포장에서 확인되지 않은 토핑·소스·수량, 미조리 제품과 조리 제품의 혼동, 제품 없는 음식",
  },
  "food-rice": {
    mode: "cook-and-serve",
    prepared: "조리된 기본 밥 상태와 제품 포장을 함께 보여주는 담백한 완성 장면",
    active: "밥알의 기본 질감이 보이는 가까운 섭취 직전 장면",
    forbidden: "반찬·양념·고명 추가, 산지 풍경, 제품 없이 밥만 보이는 장면",
  },
  "food-cereal": {
    mode: "open-and-serve",
    prepared: "개봉한 실제 제품 패키지와 기본 내용물을 깨끗한 그릇에 소량 담아 함께 보여준다",
    active: "기본 내용물의 형태와 식감을 가까이 보여주되 포장 식별부를 프레임에 남긴다",
    forbidden: "확인되지 않은 과일·견과·요거트 토핑, 우유가 허공에서 쏟아지는 장면, 제품 없는 그릇",
  },
  "food-bread": {
    mode: "open-and-serve",
    prepared: "개봉한 실제 포장과 제품 형태에 맞는 빵을 실제 구성 수량을 넘지 않게 함께 보여준다",
    active: "제공된 근거 범위의 표면 또는 단면이 보이는 가까운 장면에 포장 식별부를 남긴다",
    forbidden: "버터·잼·치즈·과일·음료, 확인되지 않은 단면·필링, 갓 구운 김, 제품 없는 빵",
  },
  "food-dessert": {
    mode: "open-and-serve",
    prepared: "원래 냉장·냉동 용기 또는 포장과 제품 유형에 맞는 기본 개봉 상태를 함께 보여준다",
    active: "제공 사진이나 포장 근거 범위의 층·표면·질감이 보이는 가까운 장면에 포장을 남긴다",
    forbidden: "확인되지 않은 크림·과일·초콜릿·민트·접시 장식, 녹는 효과 과장, 제품 없는 디저트",
  },
  "food-snack": {
    mode: "open-and-serve",
    prepared: "개봉한 포장과 실제 형태에 맞는 기본 과자 내용물을 소량 함께 보여준다",
    active: "과자의 표면·두께·형태가 보이는 가까운 장면과 포장 식별부를 함께 보여준다",
    forbidden: "확인되지 않은 단면·크림·맛 원료·접시 장식, 제품 없이 과자만 보이는 장면",
  },
  "food-chocolate": {
    mode: "open-and-serve",
    prepared: "포장과 실제 형태에 맞는 초콜릿 또는 캔디 내용물을 소량 함께 보여준다",
    active: "표면과 실제 형태가 읽히는 가까운 장면에 포장 식별부를 남긴다",
    forbidden: "녹인 초콜릿, 확인되지 않은 단면·필링·선물 구성, 제품 없는 내용물",
  },
  "food-nuts": {
    mode: "open-and-serve",
    prepared: "개봉한 포장과 확인 가능한 기본 견과 또는 건과일 내용물을 함께 보여준다",
    active: "내용물의 크기와 표면을 가까이 보여주되 포장 식별부를 함께 남긴다",
    forbidden: "포장에 없는 견과·과일 종류, 과장된 수량, 제품 없는 원료 더미",
  },
  "food-canned": {
    mode: "open-and-serve",
    prepared: "안전하게 개봉된 용기와 제품 종류에 맞는 기본 내용물을 함께 보여준다",
    active: "내용물의 실제 질감을 확인할 수 있는 가까운 장면에 원래 용기를 남긴다",
    forbidden: "완성 요리·추가 양념·가니시, 날카로운 뚜껑을 위험하게 세운 장면, 제품 없는 음식",
  },
  "food-coffee-beans": {
    mode: "brew-and-serve",
    prepared: "제품 포장과 기본 추출 커피 한 잔을 함께 보여주는 건조한 홈카페 장면",
    active: "추출된 커피의 표면과 포장 식별부가 함께 보이는 가까운 장면",
    forbidden: "확인되지 않은 원두 산지·로스팅 효과·라테아트·디저트, 제품 없는 커피잔",
  },
  "food-coffee-instant": {
    mode: "brew-and-serve",
    prepared: "제품 포장과 안내에 맞게 탄 기본 커피 한 잔을 함께 보여준다",
    active: "따뜻한 커피에서 자연스럽게 김이 오르고 포장 식별부가 남는 섭취 직전 장면",
    forbidden: "확인되지 않은 우유·크림·라테아트·디저트, 밀봉 포장에서 나는 김, 제품 없는 컵",
  },
  "food-tea": {
    mode: "brew-and-serve",
    prepared: "제품 포장과 기본적으로 우린 차 한 잔을 함께 보여준다",
    active: "찻물과 실제 티백 또는 포장 식별부가 함께 보이는 가까운 장면",
    forbidden: "확인되지 않은 꽃·과일·찻잎 더미·효능 암시, 밀봉 포장에서 나는 김, 제품 없는 찻잔",
  },
  "food-beverage": {
    mode: "pour-and-serve",
    prepared: "밀봉을 연 실제 병·캔·팩과 기본 음료를 깨끗한 잔에 따른 상태를 함께 보여준다",
    active: "음료의 색과 질감을 확인할 수 있는 잔과 원래 제품 식별부를 함께 보여준다",
    forbidden: "확인되지 않은 얼음·과일·칵테일 장식, 용량 과장, 제품 없는 음료잔",
  },
  "food-water": {
    mode: "pour-and-serve",
    prepared: "실제 병과 깨끗한 투명 잔에 따른 물을 함께 보여주고 병 라벨과 용량 식별부를 남긴다",
    active: "투명한 물과 실제 병의 입구·캡 구조를 확인할 수 있는 가까운 음용 준비 장면",
    forbidden: "레몬·과일·얼음·거품·색 있는 물, 산지 풍경, 과장된 물방울, 제품 없는 잔",
  },
  "food-juice": {
    mode: "pour-and-serve",
    prepared: "실제 팩 또는 병과 제품에서 확인되는 범위의 음료를 단순한 잔에 따른 상태를 함께 보여준다",
    active: "음료의 기본 색과 질감, 원래 제품 식별부가 함께 보이는 가까운 음용 준비 장면",
    forbidden: "확인되지 않은 과일·얼음·민트·빨대·음료 색, 제품 없는 잔, 과즙 splash",
  },
  "food-soda": {
    mode: "pour-and-serve",
    prepared: "실제 캔 또는 병과 제품에 맞는 탄산음료를 단순한 잔에 따른 상태를 함께 보여준다",
    active: "과하지 않은 실제 탄산 기포와 원래 제품 식별부가 함께 보이는 가까운 장면",
    forbidden: "폭발하는 탄산·얼음·레몬·칵테일 장식·과장된 결로, 제품 없는 잔",
  },
  "food-dairy": {
    mode: "pour-and-serve",
    prepared: "제품이 우유·마시는 발효유이면 실제 용기와 단순한 잔을, 떠먹는 제품이면 원래 열린 용기를 함께 보여준다",
    active: "제품 유형에 맞는 실제 음용 또는 떠먹기 직전 질감과 원래 포장 식별부를 함께 보여준다",
    forbidden: "우유 splash·시리얼·과일·꿀·목장 풍경, 제품 유형 변경, 제품 없는 잔이나 그릇",
  },
  "food-protein": {
    mode: "prepared-mix",
    prepared: "제품 포장과 안내에 맞게 섞은 기본 음료를 함께 보여주되 섭취량을 새로 제안하지 않는다",
    active: "혼합된 음료의 기본 질감과 포장 식별부를 함께 보여준다",
    forbidden: "근육·체형 전후, 운동 효과, 확인되지 않은 스쿱·정량·우유·과일, 제품 없는 셰이크",
  },
  "food-condiment": {
    mode: "open-and-serve",
    prepared: "마개를 연 실제 용기와 소량의 제품 내용물을 단순한 흰 시식 스푼에 함께 보여준다",
    active: "소스·오일·조미료의 기본 색과 질감이 보이도록 용기 식별부와 함께 가까이 보여준다",
    forbidden: "확인되지 않은 완성 요리·원재료·산지·효능, 제품 없는 플레이팅",
  },
  "food-baking": {
    mode: "open-and-serve",
    prepared: "개봉한 실제 포장과 확인 가능한 가루 또는 믹스 내용물을 소량 함께 보여준다",
    active: "내용물의 기본 입자와 포장 식별부를 가까이 보여준다",
    forbidden: "완성 빵·반죽·계란·우유 등 추가 재료, 가루 날림, 제품 없는 베이킹 장면",
  },
};

export function resolveFoodPresentationSlot(profileId: string, assetId: AiGeneratedAssetId): FoodPresentationSlot | null {
  const rule = foodPresentationRules[profileId];
  if (!rule || (assetId !== "detail-use" && assetId !== "detail-context")) return null;
  const active = assetId === "detail-context";
  return {
    mode: rule.mode,
    state: active ? "active-serving" : "prepared-hero",
    scene: active ? "완성 음식 클로즈업 또는 섭취 직전 연출" : "개봉·조리 완료 연출",
    requiredVisuals: active ? rule.active : rule.prepared,
    forbiddenVisuals: rule.forbidden,
  };
}
