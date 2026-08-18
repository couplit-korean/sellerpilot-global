export type ReadinessState = "verified" | "partial" | "blocked" | "not_configured";

export type ReadinessCheck = {
  label: string;
  state: ReadinessState;
  evidence: string;
};

export type ChannelReadiness = {
  key: "qoo10" | "shopee" | "lazada" | "coupang" | "smartstore" | "ebay" | "temu";
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
export const channelReadinessObservedAt = "2026.08.17";

export const channelReadiness: ChannelReadiness[] = [
  {
    key: "qoo10",
    code: "Q",
    name: "Qoo10 Japan",
    market: "일본",
    console: "QSM 판매자 센터",
    appState: "QAPI 운영 키 Vault 연결 · 실상품 읽기·전체 카테고리·테스트상품 생성/재조회 성공",
    overall: "partial",
    summary: "QSM 실계정의 유효한 QAPI 키를 Couplit Supabase Vault에 저장하고 실상품 읽기, 전체 카테고리 조회, 판매금지 표시 테스트상품 생성과 재조회를 직접 검증했습니다. 키 원문은 화면·소스·로그에 남기지 않습니다.",
    checks: [
      { label: "판매자 콘솔 접근", state: "verified", evidence: "실계정 QSM 로그인과 상품 목록 확인" },
      { label: "실상품 존재", state: "verified", evidence: "상품 8개 · 판매중 7개 · 재고주의 1개 · 판매종료 1개" },
      { label: "등록 필드 매핑", state: "verified", evidence: "필수 12개 그룹과 이미지·옵션·배송·부가정보 구조 확인" },
      { label: "QAPI 프로토콜", state: "verified", evidence: "ItemsLookup.GetItemDetailInfo v1.2 진단과 현재 엔드포인트 구현" },
      { label: "QAPI 운영 키", state: "verified", evidence: "QSM Developer 페이지에서 유효기간 2027-01-25까지인 키 확인" },
      { label: "카테고리 실조회", state: "verified", evidence: "CommonInfoLookup.GetCatagoryListAll · HTTP 200 · 3,264건" },
      { label: "Vault 자격증명", state: "verified", evidence: "Couplit Supabase Vault 운영 활성 키 · 연결 검사 passed" },
      { label: "실상품 읽기", state: "verified", evidence: "ItemsLookup.GetItemDetailInfo · HTTP 200 · ResultCode 0" },
      { label: "등록 API PoC", state: "partial", evidence: "SetNewGoods 생성·ItemCode 1216188354 재조회 성공 · 수정·판매중지 검수 남음" },
      { label: "주문 동기화", state: "not_configured", evidence: "주기조회 체크포인트와 중복방지 미검증" },
    ],
    blockers: ["테스트상품 수정·판매중지 실검증", "주문 폴링 체크포인트 실검증"],
    nextAction: "기존 API 테스트상품 수정·판매중지 → 주문 폴링 체크포인트 검수 → 소량 제한운영",
  },
  {
    key: "shopee",
    code: "S",
    name: "Shopee Open Platform",
    market: "Global",
    console: "Shopee Open Platform",
    appState: "과거 Merchant·8개 숍 UNLIST E2E 완료 · 현재 OAuth 토큰 갱신 HTTP 422로 재승인 필요",
    overall: "partial",
    summary: "운영 Merchant와 8개 숍의 글로벌→로컬 UNLIST 등록·재조회 이력은 있으나, 2026-08-17 현재 연결 검사에서 토큰 갱신이 HTTP 422로 실패했습니다. 재승인 전에는 새 등록을 정상 상태로 표시하지 않습니다.",
    checks: [
      { label: "개발자 앱 상태", state: "verified", evidence: "Couplit · Online · Seller In House System" },
      { label: "민감정보 권한", state: "verified", evidence: "Access to Sensitive Data · Can access" },
      { label: "운영 판매자 연결", state: "verified", evidence: "메인 계정 8개 숍 선택 · 365일 재승인 완료" },
      { label: "Partner Key 만료", state: "verified", evidence: "콘솔 표시 2026-09-15 · 30일 이내 교체 경고" },
      { label: "운영 Redirect Domain", state: "verified", evidence: "Test·Live 모두 https://sellerpilot-global.vercel.app 반영" },
      { label: "OAuth 승인 코드", state: "verified", evidence: "메인 계정 콜백과 state 일치 확인" },
      { label: "OAuth 서버 토큰", state: "blocked", evidence: "과거 Merchant·8개 숍 Vault 저장 이력은 있으나 현재 연결 검사 HTTP 422" },
      { label: "토큰 자동 갱신", state: "partial", evidence: "Access 4시간 · Refresh 30일 갱신 로직 구현 · 현재 Refresh Token 재승인 필요" },
      { label: "글로벌 카테고리", state: "verified", evidence: "GlobalProduct 101240 · 필수 Type=Mugs(3933) 실조회" },
      { label: "실상품 등록·읽기", state: "verified", evidence: "Global item 1건→SG local item 1건 · 이미지 5장 · 물류 3개 · UNLIST 안전 검수" },
      { label: "8개 숍 현지화", state: "verified", evidence: "SG·MY·PH·VN·TH·TW·BR·MX 현지어·통화·물류·재고·UNLIST 실발행·재조회 완료" },
      { label: "Push Mechanism", state: "not_configured", evidence: "운영 Push 콜백과 이벤트 구독 실검증 필요" },
    ],
    blockers: ["Merchant·8개 숍 OAuth 재승인", "만료 전 Partner Key 교체", "운영 Push 콜백·이벤트 구독", "실판매 전 국가별 세금·관세·마진 승인"],
    nextAction: "OAuth 재승인 → 8개 숍 get_shop_info 현재시점 재검사 → UNLIST 상품 1건 재검수 → Push 구독",
  },
  {
    key: "lazada",
    code: "L",
    name: "Lazada Open Platform",
    market: "MY · PH · SG · TH · VN · ID",
    console: "Lazada Service Provider Center",
    appState: "Couplit Commerce Online · 권한·콜백·MY 실셀러 확인 · 현재 OAuth 토큰 누락/만료",
    overall: "partial",
    summary: "Couplit Commerce 앱의 운영 상태, 상품·카탈로그·크로스보더 권한, 운영 콜백과 MY 실셀러 코드는 확인했습니다. 2026-08-17 현재 연결 검사는 OAuth 값 누락 또는 만료로 실패하며, 신규 등록 전에 셀러 재승인과 토큰 교환이 필요합니다.",
    checks: [
      { label: "개발자 앱 상태", state: "verified", evidence: "Couplit Commerce · Seller In-house APP · Online" },
      { label: "API 권한 그룹", state: "verified", evidence: "상품·가격재고·주문·물류·카탈로그·재무 등 Active" },
      { label: "판매자 허용 범위", state: "partial", evidence: "MY·PH·SG·TH·VN 5개 허용목록 확인 · ID 실스토어 미확보" },
      { label: "OAuth 콜백", state: "verified", evidence: "https://sellerpilot-global.vercel.app/ 로 운영 콜백 변경" },
      { label: "OAuth 판매자 승인", state: "blocked", evidence: "Authorize 후 'seller short code is invalid' 공급사 응답 재현" },
      { label: "운영 앱 키", state: "verified", evidence: "App Key·Secret과 콜백 URL을 실제 콘솔에서 확인" },
      { label: "토큰 교환", state: "blocked", evidence: "현재 연결 검사: 필수 인증값 또는 OAuth 토큰 누락/만료" },
      { label: "IP 허용목록", state: "verified", evidence: "현재 반환 오류는 AppWhiteIpLimit가 아니며 셀러 코드 인덱싱 오류로 분리" },
      { label: "Push Mechanism", state: "not_configured", evidence: "콜백 URL 비어 있음 · 6개 이벤트 그룹 미선택" },
      { label: "토큰 정책", state: "verified", evidence: "Access 30일 · Refresh 180일 정책 확인" },
    ],
    blockers: ["새 판매자 OAuth 승인과 토큰 교환", "MY 셀러 화이트리스트/계정 분류 재확인", "ID 실셀러 스토어 확보", "Push Mechanism 이벤트 구독"],
    nextAction: "MY 셀러 OAuth 재승인 → Vault 저장 → seller/get → 6개 국가 카테고리·필수속성·Inactive 상품 순차 검수",
  },
  {
    key: "coupang",
    code: "C",
    name: "쿠팡 WING",
    market: "한국",
    console: "Coupang Open API",
    appState: "WING 로그인 확인 · 비밀번호 재확인 대기",
    overall: "partial",
    summary: "실판매자 WING 로그인과 업체코드 노출을 확인했습니다. CEA HmacSHA256 서명, 상품 목록 진단, 상품·가격·재고·주문·배송 경로는 최신 공식 문서 기준으로 대조했고 OpenAPI 키 화면의 비밀번호 재확인이 남았습니다.",
    checks: [
      { label: "판매자 세션", state: "verified", evidence: "Couplit WING 실판매자 로그인과 업체코드 표시 확인" },
      { label: "HMAC 서명", state: "verified", evidence: "signedDate + method + path + query 규칙 구현" },
      { label: "안전한 연결 검사", state: "verified", evidence: "상품 목록 maxPerPage=1 읽기" },
      { label: "상품·재고", state: "verified", evidence: "sellerProductId/vendorItemId 2단계 매핑 반영" },
      { label: "주문·배송", state: "verified", evidence: "ordersheets nextToken와 발주 후 주소 재조회 규칙 반영" },
      { label: "키 수명", state: "verified", evidence: "OpenAPI Key 180일 · 만료 14일 전 재발급 활성화" },
      { label: "실계정 E2E", state: "not_configured", evidence: "비밀번호 재확인 후 Access Key·Secret Key 확인 및 Vault 저장 필요" },
    ],
    blockers: ["WING 추가판매정보 화면에서 비밀번호 재확인", "Access Key·Secret Key를 Couplit Supabase Vault에 연결", "승인된 테스트상품 1건 범위 확정"],
    nextAction: "비밀번호 재확인 → 키 확인/발급 → Vault 등록 → 등록상품 1건 읽기 → 제한 쓰기 검수",
  },
  {
    key: "temu",
    code: "T",
    name: "Temu Korea",
    market: "한국",
    console: "Temu Partner Platform",
    appState: "판매자 계정 활성 · Partner App 및 판매자 Access Token 연결 대기",
    overall: "blocked",
    summary: "Temu 한국 판매자 계정과 V3 상품 발행·자동 이미지 저장·자동 카테고리 매칭 규격을 확인했습니다. 프로그램 전송 전 Partner App 발행과 판매자 승인 토큰이 필요합니다.",
    checks: [
      { label: "판매자 계정", state: "verified", evidence: "COUPLIT 한국 스토어 활성 상태 확인" },
      { label: "V3 상품 발행", state: "verified", evidence: "temu.local.goods.v3.add 공식 필드·서명·응답 규격 구현" },
      { label: "이미지·카테고리", state: "verified", evidence: "공개 HTTPS 이미지 자동 저장·카테고리 자동 추천 규격 반영" },
      { label: "프로그램 재조회", state: "verified", evidence: "외부 상품코드로 temu.local.goods.list.retrieve 재검증 구현" },
      { label: "실계정 E2E", state: "not_configured", evidence: "Partner App Key·Secret·판매자 Access Token 미연결" },
    ],
    blockers: ["Partner App 생성·발행", "한국 판매자 승인 Access Token 발급", "기본 배송 템플릿 설정"],
    nextAction: "Partner App 발행 → 판매자 승인 → Vault 연결 → 상품 목록 읽기 → V3 테스트상품 등록·재조회",
  },
  {
    key: "smartstore",
    code: "N",
    name: "네이버 스마트스토어",
    market: "한국",
    console: "Naver Commerce API",
    appState: "SellerPilot Couplet 애플리케이션 생성 완료 · Secret 확인 CAPTCHA 대기",
    overall: "partial",
    summary: "올바른 Couplet Seoul 판매자 세션에서 SellerPilot Couplet 애플리케이션을 생성하고 상품·N배송·판매자정보 권한과 고정 IP를 등록했습니다. Secret 표시 단계의 네이버 CAPTCHA를 사용자가 통과한 뒤 Vault 연결과 SELLER 토큰 검증을 진행합니다.",
    checks: [
      { label: "판매자 세션", state: "verified", evidence: "Couplet Seoul 통합매니저 스마트스토어센터 로그인 확인" },
      { label: "API센터 세션", state: "verified", evidence: "개발업체 커플릿 계정으로 Commerce API센터 로그인" },
      { label: "인증 서명", state: "verified", evidence: "client_id_timestamp bcrypt → Base64" },
      { label: "토큰 정책", state: "verified", evidence: "내 스토어 앱 SELF / 솔루션 SELLER + account_id · 10,800초 토큰 · GW.AUTHN 1회 재발급" },
      { label: "주문 체크포인트", state: "verified", evidence: "moreFrom/moreSequence · 1~3분 폴링" },
      { label: "개발업체 계정", state: "verified", evidence: "내 스토어 애플리케이션 화면 접근 완료" },
      { label: "등록 애플리케이션", state: "verified", evidence: "SellerPilot Couplet 생성 · 상품·N배송·판매자정보 권한 · 고정 IP 등록" },
      { label: "실계정 E2E", state: "not_configured", evidence: "Secret 표시 CAPTCHA 통과 후 Application ID·Secret·판매자 UID 연결 필요" },
    ],
    blockers: ["Secret 표시 CAPTCHA 사용자 통과", "Application ID·Secret·판매자 UID의 Couplit Vault 저장", "SELLER 토큰 발급"],
    nextAction: "CAPTCHA 통과 → SELLER 키 등록 → /v1/seller/account → 카테고리·필수속성 실검수",
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
