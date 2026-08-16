export type ReadinessState = "verified" | "partial" | "blocked" | "not_configured";

export type ReadinessCheck = {
  label: string;
  state: ReadinessState;
  evidence: string;
};

export type ChannelReadiness = {
  key: "qoo10" | "shopee" | "lazada" | "coupang" | "elevenst" | "smartstore" | "ebay";
  code: string;
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
 * 실제 콘솔에서 확인된 사실과 공식 개발자 문서로 확인한 구현 준비 상태를
 * 분리합니다. 앱 키, 시크릿, 판매자 식별자와 일회성 코드는 포함하지 않습니다.
 */
export const channelReadinessObservedAt = "2026.08.16";

export const channelReadiness: ChannelReadiness[] = [
  {
    key: "qoo10",
    code: "Q",
    name: "Qoo10 Japan",
    market: "일본",
    console: "QSM 판매자 센터",
    appState: "최신 QAPI 프로토콜 반영 · 키 대기",
    overall: "partial",
    summary: "구 OpenApiService 호출을 제거하고 현재 QAPI ebayjapan.qapi 규격과 59개 공개 메서드 기능표를 반영했습니다.",
    checks: [
      { label: "판매자 콘솔 접근", state: "verified", evidence: "실계정 QSM 로그인과 상품 목록 확인" },
      { label: "실상품 존재", state: "verified", evidence: "상품 8개 · 판매중 7개 · 재고주의 1개 · 판매종료 1개" },
      { label: "등록 필드 매핑", state: "verified", evidence: "필수 12개 그룹과 이미지·옵션·배송·부가정보 구조 확인" },
      { label: "QAPI 프로토콜", state: "verified", evidence: "ItemsLookup.GetItemDetailInfo v1.2 진단과 현재 엔드포인트 구현" },
      { label: "QAPI 자격증명", state: "blocked", evidence: "SellerPilot 서버에 안전한 키 참조 미연결" },
      { label: "등록 API PoC", state: "not_configured", evidence: "테스트상품 생성·조회·수정·중지 증거 없음" },
      { label: "주문 동기화", state: "not_configured", evidence: "주기조회 체크포인트와 중복방지 미검증" },
    ],
    blockers: ["Seller Authorization Key를 Vault에 연결", "검사 상품번호 지정", "쓰기 테스트상품 범위 승인"],
    nextAction: "QAPI 연결 확인 → 카테고리 조회 → 이미지 업로드 → 테스트상품 1건 등록·조회·중지",
  },
  {
    key: "shopee",
    code: "S",
    name: "Shopee Open Platform",
    market: "Global",
    console: "Shopee Open Platform",
    appState: "Couplit 앱 Online · Redirect Domain 반영 · Main account 8개 숍 승인",
    overall: "partial",
    summary: "Seller In House System 운영 앱, 민감정보 접근 권한과 판매자 연결 상태를 확인했습니다. 4시간 Access Token·30일 Refresh Token 자동 갱신과 Open Platform v2 실행 경로를 구현합니다.",
    checks: [
      { label: "개발자 앱 상태", state: "verified", evidence: "Couplit · Online · Seller In House System" },
      { label: "민감정보 권한", state: "verified", evidence: "Access to Sensitive Data · Can access" },
      { label: "운영 판매자 승인", state: "verified", evidence: "Main account 본인확인 · SG/MY/PH/VN/TH/TW/BR/MX 8개 숍 Authorized" },
      { label: "Partner Key 만료", state: "verified", evidence: "콘솔 표시 2026-09-15 · 30일 이내 교체 경고" },
      { label: "운영 Redirect Domain", state: "verified", evidence: "Test·Live 모두 https://sellerpilot-global.vercel.app 반영" },
      { label: "OAuth 서버 토큰", state: "not_configured", evidence: "SellerPilot Vault에 Partner Key·Shop Token 미저장" },
      { label: "토큰 자동 갱신", state: "verified", evidence: "Access 4시간 · Refresh 30일 · 실행 전/정기 갱신 구현" },
      { label: "Push Mechanism", state: "not_configured", evidence: "운영 Push 콜백과 이벤트 구독 실검증 필요" },
    ],
    blockers: ["Live Partner Key를 Vault에 1회 입력", "SellerPilot 보안 콜백에서 Main account OAuth code·숍별 토큰 저장", "Supabase Couplit 프로젝트 연결"],
    nextAction: "Vault 키 입력 → SellerPilot 승인 링크 재실행 → 8개 숍 토큰 교환 → get_shop_info 읽기 → 상품·주문 제한 검수",
  },
  {
    key: "lazada",
    code: "L",
    name: "Lazada Open Platform",
    market: "MY · PH · SG · TH · VN",
    console: "Lazada Service Provider Center",
    appState: "앱 Online · OAuth 고정 IP 차단",
    overall: "partial",
    summary: "운영 콜백과 MY 판매자 허용목록을 확인하고 OAuth 승인 코드까지 받았지만, Vercel Hobby에 고정 송신 IP가 없어 토큰 교환이 AppWhiteIpLimit로 차단됐습니다.",
    checks: [
      { label: "개발자 앱 상태", state: "verified", evidence: "Couplit Commerce · Seller In-house APP · Online" },
      { label: "API 권한 그룹", state: "verified", evidence: "상품·가격재고·주문·물류·카탈로그·재무 등 Active" },
      { label: "판매자 허용 범위", state: "verified", evidence: "MY 판매자 Short Code와 개발자 콘솔 허용목록 일치" },
      { label: "OAuth 콜백", state: "verified", evidence: "https://sellerpilot-global.vercel.app/ 로 운영 콜백 변경" },
      { label: "OAuth 판매자 승인", state: "verified", evidence: "MY 실판매자 승인 후 일회성 Authorization Code 수신" },
      { label: "토큰 교환", state: "blocked", evidence: "Lazada 응답 AppWhiteIpLimit · 토큰과 자격증명은 저장하지 않음" },
      { label: "IP 허용목록", state: "blocked", evidence: "Lazada 정책상 단일 고정 공인 IP 필요 · Vercel Hobby 송신 IP는 유동" },
      { label: "Push Mechanism", state: "not_configured", evidence: "콜백 URL 비어 있음 · 6개 이벤트 그룹 미선택" },
      { label: "토큰 정책", state: "verified", evidence: "Access 30일 · Refresh 180일 정책 확인" },
    ],
    blockers: ["단일 고정 공인 IP를 제공하는 서버/프록시 확정", "해당 IP를 Lazada White IP에 등록", "동일 출구 IP에서 OAuth 토큰 교환 재실행"],
    nextAction: "고정 송신 IP 확정 → White IP 등록 → OAuth 재승인·토큰 교환 → /seller/get 읽기 실검수",
  },
  {
    key: "coupang",
    code: "C",
    name: "쿠팡 WING",
    market: "한국",
    console: "Coupang Open API",
    appState: "HMAC 클라이언트 완료 · 키 대기",
    overall: "partial",
    summary: "CEA HmacSHA256 서명, 상품 목록 진단, 상품·가격·재고·주문·배송·클레임·문의 경로를 공식 문서 기준으로 분리했습니다.",
    checks: [
      { label: "HMAC 서명", state: "verified", evidence: "signedDate + method + path + query 규칙 구현" },
      { label: "안전한 연결 검사", state: "verified", evidence: "상품 목록 maxPerPage=1 읽기" },
      { label: "상품·재고", state: "verified", evidence: "sellerProductId/vendorItemId 2단계 매핑 반영" },
      { label: "주문·배송", state: "verified", evidence: "ordersheets nextToken와 발주 후 주소 재조회 규칙 반영" },
      { label: "실계정 E2E", state: "not_configured", evidence: "Vendor ID·Access Key·Secret Key 미연결" },
    ],
    blockers: ["WING Vendor ID와 API 키를 Vault에 연결", "읽기 API 통과", "승인된 테스트상품 1건 범위 확정"],
    nextAction: "키 등록 → 등록상품 1건 읽기 → 카테고리 메타 검증 → 제한 쓰기 검수",
  },
  {
    key: "elevenst",
    code: "11",
    name: "11번가",
    market: "한국",
    console: "11st Open API Center",
    appState: "공개 기능표 반영 · 판매자 상세 명세 필요",
    overall: "blocked",
    summary: "상품·재고·주문·배송·취소/교환/반품 지원 범위는 확인했지만 판매자 상세 XML 서비스 코드와 운영 URL은 로그인 뒤 문서에서만 확정할 수 있습니다.",
    checks: [
      { label: "키 정책", state: "verified", evidence: "2026-06-30부터 Open API Key 유효기간 180일" },
      { label: "기능 범위", state: "verified", evidence: "상품·주문·클레임 공식 소개 페이지 확인" },
      { label: "XML 전송기", state: "verified", evidence: "OpenApiKey 헤더·XML 응답·타임아웃 골격 구현" },
      { label: "판매자 상세 규격", state: "blocked", evidence: "로그인 전용 문서의 서비스 코드·상태표 필요" },
      { label: "실계정 E2E", state: "not_configured", evidence: "판매자 키 미연결" },
    ],
    blockers: ["11번가 개발자센터 판매자 문서 접근", "운영 Base URL·서비스 코드·상태 코드표 캡처", "180일 키 연결"],
    nextAction: "판매자 문서 접근 → 버전 고정 → 계약 테스트 추가 → 읽기 API 검수",
  },
  {
    key: "smartstore",
    code: "N",
    name: "네이버 스마트스토어",
    market: "한국",
    console: "Naver Commerce API",
    appState: "OAuth 서명·토큰 처리 완료 · 키 대기",
    overall: "partial",
    summary: "bcrypt client_secret_sign, 3시간 토큰 발급, 판매자 계정 진단과 상품 v2·재고·주문 변경분·CS·정산 흐름을 반영했습니다.",
    checks: [
      { label: "인증 서명", state: "verified", evidence: "client_id_timestamp bcrypt → Base64" },
      { label: "토큰 정책", state: "verified", evidence: "SELF/SELLER 분기와 10,800초 토큰" },
      { label: "주문 체크포인트", state: "verified", evidence: "moreFrom/moreSequence · 1~3분 폴링" },
      { label: "실계정 E2E", state: "not_configured", evidence: "Application ID·Secret 미연결" },
    ],
    blockers: ["Commerce API Application ID·Secret 연결", "SELF 또는 SELLER 유형 확정", "상품 카테고리/속성 실응답 보관"],
    nextAction: "키 등록 → /v1/seller/account → 카테고리 동기화 → 테스트상품 검수",
  },
  {
    key: "ebay",
    code: "E",
    name: "eBay Global",
    market: "Global",
    console: "eBay Developers Program",
    appState: "User OAuth·자동 갱신 완료 · 앱 키 대기",
    overall: "partial",
    summary: "RuName 기반 사용자 동의, Authorization Code 교환, 2시간 Access Token 자동 갱신과 Inventory·Offer·Fulfillment 흐름을 구현했습니다.",
    checks: [
      { label: "OAuth 동의", state: "verified", evidence: "Sandbox/Production 분리 · state CSRF 검증" },
      { label: "토큰 갱신", state: "verified", evidence: "Refresh Token 기반 실행 전 갱신 + Vercel maintenance 보정" },
      { label: "판매자 진단", state: "verified", evidence: "GET /sell/account/v1/privilege/" },
      { label: "상품 워크플로", state: "verified", evidence: "Location → Inventory Item → Offer → Publish" },
      { label: "실계정 E2E", state: "not_configured", evidence: "Client ID·Cert ID·RuName·판매자 동의 미연결" },
    ],
    blockers: ["Production App ID·Cert ID·RuName 연결", "판매자 1회 OAuth 동의", "마켓플레이스·Business Policy 기본값 확정"],
    nextAction: "앱 키 등록 → OAuth 승인 → privileges 읽기 → Inventory/Offer 테스트",
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
  { gate: "01", title: "자격증명 연결", description: "서버 비밀 참조만 저장하고 브라우저·소스·로그에 원문 키를 남기지 않음", state: "채널별 대기" },
  { gate: "02", title: "읽기 API PoC", description: "판매자 정보·카테고리·상품 1건을 조회하고 요청 ID와 원문 응답을 보관", state: "대기" },
  { gate: "03", title: "쓰기 API PoC", description: "승인된 테스트상품 1건을 생성·조회·수정·판매중지하고 원격 ID를 연결", state: "대기" },
  { gate: "04", title: "주문·웹훅", description: "서명검증, 중복 이벤트 제거, 누락 보정조회, 체크포인트 재시작을 증명", state: "대기" },
  { gate: "05", title: "제한 운영", description: "30~100 SKU에서 부분실패·호출제한·토큰만료 복구 후 운영 승인", state: "대기" },
];
