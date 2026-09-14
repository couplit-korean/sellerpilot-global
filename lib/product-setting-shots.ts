import type { AiGeneratedAssetId } from "./ai-generated-assets";

export const settingShotAssetIds = ["portrait", "wide", "detail-overview", "detail-use"] as const satisfies readonly AiGeneratedAssetId[];

export type SettingShotAssetId = (typeof settingShotAssetIds)[number];

export type ProductSettingShot = {
  label: string;
  location: string;
  moment: string;
  surface: string;
  supportingObjects: string;
  staging: string;
};

export type ProductSettingShotPlan = Record<SettingShotAssetId, ProductSettingShot>;

type SceneParts = [location: string, moment: string, surface: string, supportingObjects: string, staging: string];

function shot(label: string, parts: SceneParts): ProductSettingShot {
  const [location, moment, surface, supportingObjects, staging] = parts;
  return { label, location, moment, surface, supportingObjects, staging };
}

function plan(parts: Record<SettingShotAssetId, SceneParts>): ProductSettingShotPlan {
  return {
    portrait: shot("설정샷 1", parts.portrait),
    wide: shot("설정샷 2", parts.wide),
    "detail-overview": shot("설정샷 3", parts["detail-overview"]),
    "detail-use": shot("설정샷 4", parts["detail-use"]),
  };
}

function cerealPlan() {
  return plan({
    portrait: [
      "아침 햇빛이 옆창으로 들어오는 작은 원목 아침 식탁",
      "등교·출근 전 식사를 막 준비한 이른 아침",
      "밝은 참나무 테이블과 세로로 보이는 창가 벽",
      "실제 섭취를 설명하는 시리얼 한 그릇과 단정한 흰 냅킨만 사용",
      "패키지는 세워 두고 그릇은 앞쪽 아래에 배치해 세로 장면의 깊이를 만든다",
    ],
    wide: [
      "정돈된 현대식 주방의 넓은 조리대",
      "시리얼을 그릇에 담기 직전의 준비 순간",
      "차가운 회색 석재 조리대와 수평으로 이어지는 주방 배경",
      "빈 그릇과 스푼만 기능성 소품으로 사용하고 아침 식탁 소품은 반복하지 않는다",
      "패키지는 화면 한쪽, 그릇은 반대쪽에 두어 가로 방향 동선을 만든다",
    ],
    "detail-overview": [
      "열린 팬트리 선반 앞의 식품 보관 공간",
      "보관 위치에서 꺼내 식사를 준비하기 직전",
      "무광 크림색 선반과 깊이감 있는 수납 배경",
      "같은 식품군의 다른 브랜드나 추가 제품 없이 보관 용기 하나만 배경에 둔다",
      "패키지 전체와 실제 크기가 읽히도록 선반 가장자리에서 30도 각도로 보여준다",
    ],
    "detail-use": [
      "창문·주방·다이닝 가구가 보이지 않는 따뜻한 조명의 거실 소파 옆",
      "저녁에 시리얼을 간식으로 바로 먹기 직전",
      "낮은 짙은 월넛 커피 테이블과 배경의 중립색 패브릭 소파",
      "완성된 시리얼 한 그릇과 스푼, 소파 위의 접힌 무지 담요만 사용하며 과일·토핑은 넣지 않는다",
      "그릇을 낮은 전경의 주인공으로, 패키지를 옆쪽 후경에 두고 따뜻한 스탠드 조명으로 아침 장면과 분리한다",
    ],
  });
}

function foodPlan(productText: string) {
  if (/시리얼|cereal|오트밀|oatmeal|granola|그래놀라/i.test(productText)) return cerealPlan();
  if (/커피|coffee|원두|tea|티백|차\b/i.test(productText)) {
    return plan({
      portrait: ["창가의 아침 커피 코너", "첫 잔을 준비하는 아침", "따뜻한 원목 선반", "깨끗한 컵과 제품에 맞는 추출 도구만 사용", "제품을 세우고 컵은 낮은 전경에 둔다"],
      wide: ["넓은 홈카페 조리대", "추출 도구를 정돈한 준비 순간", "밝은 석재 상판", "컵과 실제 사용에 필요한 도구만 사용", "제품과 도구를 좌우로 분리해 가로 동선을 만든다"],
      "detail-overview": ["주방의 원두·차 보관 선반", "보관 상태를 보여주는 낮 시간", "무광 금속 선반", "다른 브랜드 제품 없이 밀폐 용기 하나만 배경에 둔다", "패키지 전체가 보이도록 30도 위에서 촬영한다"],
      "detail-use": ["조용한 오후 독서 테이블", "완성된 음료를 마시기 직전", "짙은 나무 테이블", "완성 음료 한 잔과 접힌 책 한 권만 사용", "음료와 제품을 서로 다른 깊이에 배치한다"],
    });
  }
  return plan({
    portrait: ["자연광이 드는 주방 식재료 코너", "조리를 시작하기 전", "밝은 원목 작업대", "해당 상품의 실제 조리에 필요한 그릇 하나만 사용", "제품을 세우고 재료 상태는 낮은 전경에 둔다"],
    wide: ["넓고 정돈된 주방 조리대", "조리 과정의 준비 단계", "회색 석재 상판", "조리 도구 하나와 제품 사실에 맞는 내용물만 사용", "제품과 조리 영역을 좌우로 나눠 보여준다"],
    "detail-overview": ["팬트리 또는 상온 식품 보관 선반", "보관 위치에서 꺼낸 순간", "무광 크림색 선반", "다른 브랜드·추가 식품 없이 보관 용기 하나만 배경에 둔다", "패키지 전체와 보관 맥락을 30도 위에서 보여준다"],
    "detail-use": ["완성 음식을 차린 다이닝 테이블", "섭취 직전", "직물 매트가 있는 짙은 나무 테이블", "상품 정보로 뒷받침되는 완성 음식과 식기만 사용", "완성 음식은 전경, 제품은 후경에 두어 사용 결과를 설명한다"],
  });
}

const categoryPlans: Record<string, ProductSettingShotPlan> = {
  "beauty-skincare": plan({
    portrait: ["아침 자연광의 욕실 세면대 옆", "세안 후 루틴을 준비하는 아침", "밝은 석재 세면대", "깨끗한 접힌 수건 하나만 사용", "용기를 거울 옆에 세워 세로 깊이를 만든다"],
    wide: ["침실 화장대의 저녁 루틴 공간", "취침 전 관리 준비", "짙은 목재 화장대", "작은 무광 트레이만 사용", "제품을 한쪽에 두고 비어 있는 루틴 공간을 가로로 보여준다"],
    "detail-overview": ["창이 있는 욕실 수납 선반", "낮 시간의 보관 상태", "반투명 유리 선반", "다른 화장품 없이 수건과 물컵만 배경에 둔다", "용기 전체와 펌프·캡 관계가 보이게 30도 각도로 배치한다"],
    "detail-use": ["거울 앞의 실제 사용 준비 공간", "한 번의 사용 직전", "무광 아이보리 세면대", "제품에 포함되지 않은 도구 없이 캡·펌프 상태만 사실대로 보여준다", "제품을 전경에 두고 거울 반사는 배경 깊이로만 쓴다"],
  }),
  "beauty-tools": plan({
    portrait: ["창가의 개인 화장대", "아침 메이크업 준비", "밝은 원목 화장대", "거울과 실제 용도를 설명하는 빈 팔레트 공간만 사용", "도구를 세로 방향으로 펼쳐 헤드가 겹치지 않게 한다"],
    wide: ["정돈된 메이크업 작업 테이블", "여러 도구를 순서대로 고르는 순간", "차가운 회색 작업대", "무광 트레이 하나만 사용", "도구를 좌우 작업 흐름으로 배열한다"],
    "detail-overview": ["여행 가방을 준비하는 침실 벤치", "파우치에 넣기 직전", "직물 벤치", "포함이 확인된 케이스만 사용하고 다른 화장품은 넣지 않는다", "실제 구성 전체와 수납 관계를 위쪽 30도에서 보여준다"],
    "detail-use": ["욕실 세면대의 세척·건조 공간", "사용 후 관리 단계", "흰 세라믹 세면대 옆 건조 매트", "물방울과 포함이 확인된 세척 도구만 사용", "도구 헤드와 손잡이가 모두 보이도록 사선으로 배치한다"],
  }),
  "men-tops": plan({
    portrait: ["자연광이 드는 침실 옷장 앞", "외출복을 고르는 아침", "무광 목재 옷장과 행거", "옷걸이 하나만 사용하고 다른 의류는 흐릿한 배경으로 제한", "의류 전체 실루엣이 세로로 보이게 건다"],
    wide: ["현관의 낮은 벤치와 코트 훅", "외출 직전 스타일링", "짙은 목재 벤치", "확인되지 않은 액세서리 없이 제품만 펼친다", "의류를 벤치와 훅 사이 가로 동선으로 배치한다"],
    "detail-overview": ["정돈된 드레스룸 선반", "접어 보관한 상태", "밝은 리넨 선반", "포장이나 추가 의류 없이 제품 한 벌만 사용", "전체 형태와 접힘·두께를 30도 위에서 보여준다"],
    "detail-use": ["여행 짐을 준비하는 침실", "캐리어에 넣기 직전", "중립색 침대 커버", "열린 빈 캐리어만 환경 소품으로 사용", "제품을 완전히 펼쳐 실제 길이와 형태를 유지한다"],
  }),
  "toys-games": plan({
    portrait: ["햇빛이 드는 놀이방 책장 옆", "놀이를 시작하기 전", "밝은 코르크 놀이 매트", "연령을 특정하는 인물 없이 낮은 수납 바구니만 사용", "완성 상태를 세로로 높이감 있게 배치한다"],
    wide: ["넓은 거실 바닥 놀이 공간", "구성품을 펼쳐 놀이 규칙을 확인하는 순간", "단색 패브릭 러그", "상품에 포함된 구성품만 사용", "구성품을 좌우 놀이 흐름으로 분리한다"],
    "detail-overview": ["놀이방 수납 큐브 앞", "놀이 후 정리하기 직전", "무광 목재 선반", "포함된 수납함이 있을 때만 사용", "제품 전체와 실제 구성 수량을 30도 위에서 보여준다"],
    "detail-use": ["낮은 어린이 활동 테이블", "제품의 대표 놀이를 진행하는 중간 상태", "밝은 단색 테이블", "사람·손 없이 포함된 부품만 사용", "놀이 결과와 남은 구성품을 서로 다른 깊이에 배치한다"],
  }),
  "food-supplement": plan({
    portrait: ["아침 햇빛의 주방 선반", "하루 섭취 준비 전", "밝은 원목 선반", "맑은 물 한 잔만 사용", "패키지를 세우고 물잔은 낮은 전경에 둔다"],
    wide: ["정돈된 업무용 책상", "외출 또는 업무 중 섭취를 준비하는 낮", "무광 회색 책상", "물병과 빈 메모장만 환경 소품으로 사용", "제품과 물을 좌우로 분리한다"],
    "detail-overview": ["주방의 건조 식품 보관장", "라벨과 보관 상태를 확인하는 순간", "크림색 수납 선반", "다른 의약품·보충제 없이 보관함 하나만 배경에 둔다", "패키지 전체와 뚜껑·라벨을 30도 위에서 보여준다"],
    "detail-use": ["식사 후의 다이닝 테이블", "확인된 섭취법에 따른 섭취 직전", "짙은 나무 테이블", "물 한 잔과 확인된 1회 섭취분만 사용", "제품과 1회분이 중복 수량으로 오해되지 않게 분리한다"],
  }),
};

const generalPlan = plan({
  portrait: ["상품 용도에 맞는 실제 생활 공간의 창가", "사용을 준비하는 낮 시간", "상품과 대비되는 자연 소재 표면", "상품 기능을 설명하는 최소한의 환경 소품 하나만 사용", "상품 전체를 세로 방향의 공간 깊이 속에 배치한다"],
  wide: ["첫 장면과 다른 방 또는 야외의 실제 사용 장소", "사용 과정의 직전 또는 중간 순간", "첫 장면과 재질이 다른 넓은 작업 표면", "첫 장면과 겹치지 않는 기능성 소품 하나만 사용", "상품과 사용 영역을 좌우로 분리해 가로 동선을 만든다"],
  "detail-overview": ["상품이 실제로 보관되는 수납 공간", "보관 위치에서 꺼낸 순간", "앞 장면들과 다른 무광 선반", "다른 판매 상품 없이 보관 맥락만 설명하는 소품 하나를 둔다", "상품 전체와 수납 관계를 30도 위에서 보여준다"],
  "detail-use": ["상품의 핵심 기능이 실제로 수행되는 장소", "사용 중 가장 이해하기 쉬운 순간", "앞 세 장면과 색·재질이 겹치지 않는 표면", "상품 사실로 뒷받침되는 사용 대상만 두고 장식 소품은 배제", "기능 결과는 전경, 상품은 다른 깊이에 두어 사용법을 설명한다"],
});

export function buildProductSettingShotPlan(categoryId: string, productText: string): ProductSettingShotPlan {
  if (categoryId === "food-staples") return foodPlan(productText);
  return categoryPlans[categoryId] ?? generalPlan;
}

export function formatProductSettingShot(setting: ProductSettingShot) {
  return `${setting.label} · 장소=${setting.location} · 순간=${setting.moment} · 표면=${setting.surface} · 허용 소품=${setting.supportingObjects} · 배치=${setting.staging}`;
}
