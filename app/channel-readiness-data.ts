export type ReadinessState = "verified" | "partial" | "blocked" | "not_configured";

export type ReadinessCheck = {
  label: string;
  state: ReadinessState;
  evidence: string;
};

export type ChannelReadiness = {
  key: "qoo10" | "shopee" | "lazada";
  code: "Q" | "S" | "L";
  name: string;
  market: string;
  console: string;
  appState: string;
  overall: ReadinessState;
  summary: string;
  checks: ReadinessCheck[];
  blockers: string[];
  nextAction: string;
};

/**
 * 2026-08-16에 사용자가 열어 준 실제 판매자/개발자 콘솔을 읽기 전용으로
 * 확인한 결과입니다. 앱 키, 시크릿, 파트너 ID, 허용 IP, 판매자 식별자는
 * 소스와 화면에 저장하지 않습니다.
 */
export const channelReadinessObservedAt = "2026.08.16";

export const channelReadiness: ChannelReadiness[] = [
  {
    key: "qoo10",
    code: "Q",
    name: "Qoo10 Japan",
    market: "일본",
    console: "QSM 판매자 센터",
    appState: "판매자 콘솔 확인",
    overall: "partial",
    summary: "실제 상품 목록과 개별 상품등록 화면을 확인했으며 QAPI 자격증명과 호출 검증은 남아 있습니다.",
    checks: [
      { label: "판매자 콘솔 접근", state: "verified", evidence: "실계정 QSM 로그인과 상품 목록 확인" },
      { label: "실상품 존재", state: "verified", evidence: "상품 8개 · 판매중 7개 · 재고주의 1개 · 판매종료 1개" },
      { label: "등록 필드 매핑", state: "verified", evidence: "필수 12개 그룹과 이미지·옵션·배송·부가정보 구조 확인" },
      { label: "QAPI 자격증명", state: "blocked", evidence: "SellerPilot 서버에 안전한 키 참조 미연결" },
      { label: "등록 API PoC", state: "not_configured", evidence: "테스트상품 생성·조회·수정·중지 증거 없음" },
      { label: "주문 동기화", state: "not_configured", evidence: "주기조회 체크포인트와 중복방지 미검증" },
    ],
    blockers: ["QAPI 키를 서버 비밀 저장소에 연결", "테스트상품과 테스트 주문 범위 확정", "카테고리·필수속성 QAPI 응답 보관"],
    nextAction: "QAPI 연결 확인 → 카테고리 조회 → 이미지 업로드 → 테스트상품 1건 등록·조회·중지",
  },
  {
    key: "shopee",
    code: "S",
    name: "Shopee Open Platform",
    market: "글로벌 / SG 우선",
    console: "Shopee 개발자 콘솔",
    appState: "앱 Online · 푸시 OFF",
    overall: "partial",
    summary: "라이브 앱과 민감정보 접근 권한은 있으나 리다이렉트와 콜백이 운영 주소가 아니며 라이브 푸시가 꺼져 있습니다.",
    checks: [
      { label: "개발자 앱 상태", state: "verified", evidence: "Seller In House System 앱 Online" },
      { label: "민감정보 접근", state: "verified", evidence: "콘솔에서 접근 가능 상태 확인" },
      { label: "Sandbox v2", state: "verified", evidence: "계정 유형·Shop Area 기반 테스트계정 생성 도구 확인" },
      { label: "운영 리다이렉트", state: "blocked", evidence: "현재 임시 도메인으로 설정되어 SellerPilot OAuth 완료 불가" },
      { label: "라이브 푸시", state: "not_configured", evidence: "Get Live Push OFF · 최근 6시간 수신 증거 없음" },
      { label: "테스트 콜백", state: "not_configured", evidence: "Test Call Back URL 비어 있음" },
      { label: "파트너 키 수명", state: "blocked", evidence: "2026-09-15 만료 예정 · 교체 절차 필요" },
    ],
    blockers: ["SellerPilot OAuth 리다이렉트 URL 확정", "콜백 배포 지역 확인과 HTTPS 엔드포인트 검증", "만료 전 파트너 키 교체·롤백 계획"],
    nextAction: "운영 리다이렉트 등록 → 샌드박스 계정 연결 → 상품/주문 API PoC → 라이브 푸시 검증",
  },
  {
    key: "lazada",
    code: "L",
    name: "Lazada Open Platform",
    market: "MY · PH · SG · TH · VN",
    console: "Lazada Service Provider Center",
    appState: "앱 Online · 웹훅 미구성",
    overall: "partial",
    summary: "Seller In-house 앱과 주요 API 권한은 활성화됐지만 OAuth 콜백이 임시 주소이고 IP 허용목록과 Push Mechanism이 비어 있습니다.",
    checks: [
      { label: "개발자 앱 상태", state: "verified", evidence: "Couplit Commerce · Seller In-house APP · Online" },
      { label: "API 권한 그룹", state: "verified", evidence: "상품·가격재고·주문·물류·카탈로그·재무 등 Active" },
      { label: "판매자 허용 범위", state: "verified", evidence: "5개 국가 판매자 계정이 허용목록에 등록됨" },
      { label: "OAuth 콜백", state: "blocked", evidence: "현재 임시 도메인으로 설정되어 SellerPilot 인증 완료 불가" },
      { label: "IP 허용목록", state: "not_configured", evidence: "호출 서버 IP가 지정되지 않아 기능 비활성" },
      { label: "Push Mechanism", state: "not_configured", evidence: "콜백 URL 비어 있음 · 6개 이벤트 그룹 미선택" },
      { label: "토큰 정책", state: "verified", evidence: "Access 30일 · Refresh 180일 정책 확인" },
    ],
    blockers: ["SellerPilot OAuth 콜백 URL로 교체", "고정 작업서버 IP 확정 후 허용목록 등록", "주문·상품·Fulfillment 웹훅 검증"],
    nextAction: "OAuth 콜백 연결 → 토큰 저장·갱신 → 상품/가격재고 API PoC → Push 서명·재전송 검증",
  },
];

export const qoo10RegistrationMap = [
  { group: "카테고리·브랜드", fields: "대·중·소 카테고리, 카테고리 검색, 브랜드 코드/없음", rule: "카테고리별 필수속성 재조회" },
  { group: "상품 식별", fields: "상품명, 홍보문구, 판매자 상품코드", rule: "상품명 100자 · 홍보문구 20자 · 코드 100자" },
  { group: "판매 정보", fields: "판매기간, 판매가, 참고가, 재고, 구매제한, 할인, Q포인트", rule: "판매가 JPY · 재고/가격 상한 사전검사" },
  { group: "상품 이미지", fields: "대표 1장, 추가 최대 50장, 동영상 최대 1개", rule: "대표 필수 · 최소 600×600 · JPG/PNG/GIF" },
  { group: "옵션", fields: "선택옵션, 추가구성, 텍스트옵션, 옵션/추가 이미지", rule: "내부 Variant·SKU와 외부 옵션 조합 매핑" },
  { group: "상세 설명", fields: "리치텍스트/HTML, 이미지, 머리말, 꼬리말", rule: "상세 1MB · 이미지 합계 40MB · 권장폭 820px" },
  { group: "배송·반품", fields: "배송비 그룹, 운송사, 출하지/반품지, 반품비, 출고 SLA", rule: "일반/당일/예약과 1~3영업일 처리" },
  { group: "검색·부가정보", fields: "키워드, 상태, 원산지, 중량, 재질, 모델, 표준코드, 제조/유통기한, 연령, A/S", rule: "키워드 최대 10개 · 브랜드 키워드 금지" },
];

export const integrationGates = [
  { gate: "01", title: "자격증명 연결", description: "서버 비밀 참조만 저장하고 브라우저·소스·로그에 원문 키를 남기지 않음", state: "진행 전" },
  { gate: "02", title: "읽기 API PoC", description: "판매자 정보·카테고리·상품 1건을 조회하고 요청 ID와 원문 응답을 보관", state: "대기" },
  { gate: "03", title: "쓰기 API PoC", description: "승인된 테스트상품 1건을 생성·조회·수정·판매중지하고 원격 ID를 연결", state: "대기" },
  { gate: "04", title: "주문·웹훅", description: "서명검증, 중복 이벤트 제거, 누락 보정조회, 체크포인트 재시작을 증명", state: "대기" },
  { gate: "05", title: "제한 운영", description: "30~100 SKU에서 부분실패·호출제한·토큰만료 복구 후 운영 승인", state: "대기" },
];
