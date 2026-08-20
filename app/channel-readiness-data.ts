export type ReadinessState = "verified" | "partial" | "blocked" | "not_configured";

export type ReadinessCheck = {
  label: string;
  state: ReadinessState;
  evidence: string;
};

export type ChannelReadiness = {
  key: "qoo10" | "shopee" | "lazada" | "coupang" | "elevenst" | "smartstore" | "ebay" | "temu";
  code: string;
  name: string;
  market: string;
  console: string;
  appState: string;
  overall: ReadinessState;
  consoleVerified: boolean;
  apiReadPassed: boolean;
  summary: string;
  checks: ReadinessCheck[];
  blockers: string[];
  nextAction: string;
  officialDocs?: { label: string; url: string }[];
};

/**
 * 실제 콘솔에서 확인된 사실과 공식 개발자 문서로 확인한 구현 준비 상태를
 * 분리합니다. 앱 키, 시크릿, 판매자 식별자와 일회성 코드는 포함하지 않습니다.
 */
export const channelReadinessObservedAt = "2026.08.20";

export const channelReadiness: ChannelReadiness[] = [
  {
    key: "qoo10",
    code: "Q",
    name: "Qoo10 Japan",
    market: "일본",
    console: "QSM 판매자 센터",
    appState: "QSM 로그인 정상 · Vault v6 · 2026-08-20 QAPI 상품 읽기 정상",
    overall: "partial",
    consoleVerified: true,
    apiReadPassed: true,
    summary: "QSM 판매자센터에서 상품·주문·문의 현황을 대조한 뒤 Seller Authorization Key를 재발급해 Vault에 교체했습니다. 현재 상품 상세 읽기 진단은 정상이며 주문·문의 주기수집은 새 키 기준 재대조 단계입니다.",
    checks: [
      { label: "판매자 콘솔 접근", state: "verified", evidence: "실계정 QSM 로그인과 대시보드 조회 완료" },
      { label: "상품 현황", state: "verified", evidence: "전체 48개 · 판매중 42개 · 재고 10개 이하 37개 · 판매종료 1개" },
      { label: "주문·문의 현황", state: "verified", evidence: "신규주문 0 · 미답변 고객문의 0 · 판매자 메시지 미답변 0" },
      { label: "등록 필드 매핑", state: "verified", evidence: "필수 12개 그룹과 이미지·옵션·배송·부가정보 구조 확인" },
      { label: "QAPI 프로토콜", state: "verified", evidence: "ItemsLookup.GetItemDetailInfo v1.2 진단과 현재 엔드포인트 구현" },
      { label: "Vault 자격증명", state: "verified", evidence: "운영 키 v6 · 만료일 2027-08-20 · 새 Seller Authorization Key 암호화 보관" },
      { label: "현재 읽기 진단", state: "verified", evidence: "2026-08-20 실제 상품 1건 ItemsLookup.GetItemDetailInfo 정상 응답" },
      { label: "주문 동기화", state: "partial", evidence: "QSM 신규주문 0건 대조 완료 · 새 키 기준 주문·문의 폴링 재검사 필요" },
    ],
    blockers: ["새 키 기준 주문·문의 주기수집 결과 재대조", "실주문·문의 발생 시 통합 원장 누락 검수"],
    nextAction: "주문·문의 폴링 재검사 → 0건 원장 대조 → 실데이터 발생 시 누락 검수",
  },
  {
    key: "shopee",
    code: "S",
    name: "Shopee Open Platform",
    market: "Global",
    console: "Shopee Open Platform",
    appState: "운영 OAuth 연결 · 2026-08-20 판매점 정보 읽기 정상",
    overall: "partial",
    consoleVerified: true,
    apiReadPassed: true,
    summary: "Shopee 판매자센터에서 실주문과 채팅 문의가 모두 0건임을 대조했고, SellerPilot의 get_shop_info 운영 읽기 진단도 오늘 정상 통과했습니다. 기존 UNLIST 등록 이력과 현재 연결 상태를 분리해 표시합니다.",
    checks: [
      { label: "개발자 앱 상태", state: "verified", evidence: "Couplit · Online · Seller In House System" },
      { label: "민감정보 권한", state: "verified", evidence: "Access to Sensitive Data · Can access" },
      { label: "운영 판매자 연결", state: "verified", evidence: "메인 계정 8개 숍 선택 · 365일 재승인 완료" },
      { label: "판매자센터 대조", state: "verified", evidence: "실주문 0 · 채팅 문의 0" },
      { label: "운영 Redirect Domain", state: "verified", evidence: "Test·Live 모두 https://sellerpilot-global.vercel.app 반영" },
      { label: "OAuth 승인 코드", state: "verified", evidence: "메인 계정 콜백과 state 일치 확인" },
      { label: "OAuth 서버 토큰", state: "verified", evidence: "운영 Vault v30 · 판매점 정보 읽기 정상" },
      { label: "토큰 자동 갱신", state: "verified", evidence: "Access 4시간 · Refresh 30일 갱신 로직 적용" },
      { label: "글로벌 카테고리", state: "verified", evidence: "GlobalProduct 101240 · 필수 Type=Mugs(3933) 실조회" },
      { label: "실상품 등록·읽기", state: "verified", evidence: "Global item 1건→SG local item 1건 · 이미지 5장 · 물류 3개 · UNLIST 안전 검수" },
      { label: "8개 숍 현지화", state: "verified", evidence: "SG·MY·PH·VN·TH·TW·BR·MX 현지어·통화·물류·재고·UNLIST 실발행·재조회 완료" },
      { label: "Push Mechanism", state: "not_configured", evidence: "운영 Push 콜백과 이벤트 구독 실검증 필요" },
    ],
    blockers: ["운영 Push 콜백·이벤트 구독", "실판매 전 국가별 세금·관세·마진 승인"],
    nextAction: "주문 주기수집 결과 대조 → Push 구독 검수 → 승인된 UNLIST 상품 1건 재검수",
  },
  {
    key: "lazada",
    code: "L",
    name: "Lazada Open Platform",
    market: "MY · PH · SG · TH · VN · ID",
    console: "Lazada Service Provider Center",
    appState: "Couplit Commerce Online · 2026-08-20 MY 판매자 읽기 정상",
    overall: "partial",
    consoleVerified: true,
    apiReadPassed: true,
    summary: "Lazada 판매자센터에서 실주문과 채팅 문의가 모두 0건임을 대조했고, SellerPilot의 MY seller/get 운영 읽기 진단도 오늘 정상 통과했습니다. 국가별 주문·문의 범위와 쓰기 검수는 별도 단계입니다.",
    checks: [
      { label: "개발자 앱 상태", state: "verified", evidence: "Couplit Commerce · Seller In-house APP · Online" },
      { label: "API 권한 그룹", state: "verified", evidence: "상품·가격재고·주문·물류·카탈로그·재무 등 Active" },
      { label: "판매자 허용 범위", state: "partial", evidence: "MY·PH·SG·TH·VN 5개 허용목록 확인 · ID 실스토어 미확보" },
      { label: "OAuth 콜백", state: "verified", evidence: "https://sellerpilot-global.vercel.app/ 로 운영 콜백 변경" },
      { label: "판매자센터 대조", state: "verified", evidence: "실주문 0 · 채팅 문의 0" },
      { label: "운영 앱 키", state: "verified", evidence: "App Key·Secret과 콜백 URL을 실제 콘솔에서 확인" },
      { label: "현재 읽기 진단", state: "verified", evidence: "2026-08-20 Lazada MY 판매자 읽기 API 정상" },
      { label: "토큰 교환", state: "verified", evidence: "운영 Vault v2 토큰으로 seller/get 성공" },
      { label: "Push Mechanism", state: "not_configured", evidence: "콜백 URL 비어 있음 · 6개 이벤트 그룹 미선택" },
      { label: "토큰 정책", state: "verified", evidence: "Access 30일 · Refresh 180일 정책 확인" },
    ],
    blockers: ["ID 실셀러 스토어 확보", "Push Mechanism 이벤트 구독", "6개 국가 주문·문의 수집 범위 실검증"],
    nextAction: "MY 주문 폴링 대조 → 국가별 카테고리·필수속성 조회 → Push 이벤트 검수",
  },
  {
    key: "coupang",
    code: "C",
    name: "쿠팡 WING",
    market: "한국",
    console: "Coupang Open API",
    appState: "WING 로그인·Open API 읽기 정상 · 실제 쿠팡 주문 1건 통합 원장 반영",
    overall: "partial",
    consoleVerified: true,
    apiReadPassed: true,
    summary: "쿠팡 WING에서 실제 주문 1건과 문의 0건을 대조했고, SellerPilot 상품 목록 읽기 진단과 주문 수집을 정상 통과했습니다. 기존에 누락됐던 주문은 운영 통합 원장에 표시됩니다.",
    checks: [
      { label: "판매자센터 대조", state: "verified", evidence: "실주문 1 · 고객문의 0" },
      { label: "HMAC 서명", state: "verified", evidence: "signedDate + method + path + query 규칙 구현" },
      { label: "안전한 연결 검사", state: "verified", evidence: "상품 목록 maxPerPage=1 읽기" },
      { label: "상품·재고", state: "verified", evidence: "sellerProductId/vendorItemId 2단계 매핑 반영" },
      { label: "주문·배송", state: "verified", evidence: "ordersheets nextToken와 발주 후 주소 재조회 규칙 반영" },
      { label: "키 수명", state: "verified", evidence: "OpenAPI Key 180일 · 만료 14일 전 재발급 활성화" },
      { label: "현재 읽기 진단", state: "verified", evidence: "등록상품 목록 읽기 정상 · 운영 키 연결" },
      { label: "주문 동기화", state: "verified", evidence: "쿠팡 실제 주문 1건을 SellerPilot 통합 원장에 적재·표시" },
    ],
    blockers: ["고객문의 주기수집의 실데이터 발생 시 대조", "외부 상태 변경 전 승인된 테스트상품 범위 확정"],
    nextAction: "주문 체크포인트 재실행 → 문의 발생 시 누락 대조 → 승인된 제한 쓰기 검수",
  },
  {
    key: "elevenst",
    code: "11",
    name: "11번가",
    market: "한국",
    console: "11번가 Seller Office · OPEN API",
    appState: "OPEN API 서비스 등록·개발자 이메일·고정 IP 저장 완료 · 32자리 Key 확인 대기",
    overall: "blocked",
    consoleVerified: true,
    apiReadPassed: false,
    summary: "11번가 판매자센터와 OPEN API 센터 로그인, 서비스 등록, 개발자 이메일과 고정 실행 IP 저장을 완료했습니다. 2차 인증 콜백 뒤 32자리 Key를 확인·검사해야 하며, SellerPilot은 현재 공개 ProductSearch 읽기 진단만 지원하고 판매자 주문·문의는 별도 공식 명세 승인이 필요합니다.",
    checks: [
      { label: "판매자센터 접근", state: "verified", evidence: "Seller Office 실계정 로그인과 주문·문의 읽기 화면 확인" },
      { label: "OPEN API 계정", state: "verified", evidence: "동일 판매자 계정으로 API 관리 최초 등록 화면 진입" },
      { label: "상품 API 범위", state: "verified", evidence: "상품 등록·수정·재고·판매중지·상품 Q&A 공식 제공 확인" },
      { label: "주문 API 범위", state: "verified", evidence: "주문 목록·내역·발주·발송·입고 업무 공식 제공 확인" },
      { label: "서비스 등록", state: "verified", evidence: "이용 동의 · 개발자 이메일 · 개발·PC·상용 고정 IP 저장 완료" },
      { label: "운영 API Key", state: "not_configured", evidence: "2차 인증 콜백 완료 후 32자리 Key 확인·Vault 저장 필요" },
      { label: "SellerPilot 읽기 진단", state: "partial", evidence: "32자리 Key + 등록 IP 기반 공개 ProductSearch 진단 구현 · Key 대기" },
      { label: "주문·문의 동기화", state: "blocked", evidence: "공개 Key 외 판매자 전용 주문·문의 서비스 명세와 권한 확인 필요" },
    ],
    blockers: ["2차 인증 콜백 확인 후 32자리 API Key 조회", "Key Vault 저장 및 등록 IP ProductSearch 검사", "판매자 주문·문의 공식 서비스 명세 승인"],
    nextAction: "API Key 확인 → Vault 저장 → 공개 ProductSearch 읽기 → 판매자 주문·문의 서비스 명세 확보",
    officialDocs: [
      { label: "OPEN API 센터", url: "https://openapi.11st.co.kr/openapi/OpenApiFrontMain.tmall" },
      { label: "상품 API", url: "https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=PRODUCT" },
      { label: "주문 API", url: "https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=ORDER" },
    ],
  },
  {
    key: "temu",
    code: "T",
    name: "Temu Korea",
    market: "한국",
    console: "Temu Partner Platform",
    appState: "SellerPilot Partner App 생성됨 · 보안 설문 승인 · 컴플라이언스 2개 항목 보완 대기",
    overall: "blocked",
    consoleVerified: true,
    apiReadPassed: false,
    summary: "Temu Partner Platform에 SellerPilot 자체개발 앱이 이미 생성돼 있고 보안 설문은 승인됐습니다. 개인정보 처리 서버 국가와 클라우드 사업자 항목이 불완전으로 반려돼 앱이 비활성 상태이며, 정확한 인프라 정보로 재제출·승인된 뒤 판매자 토큰을 발급할 수 있습니다.",
    checks: [
      { label: "판매자 계정", state: "verified", evidence: "COUPLIT 한국 스토어 활성 상태 확인" },
      { label: "Partner App", state: "verified", evidence: "SellerPilot · Self-developed application · COUPLIT 스토어 연결" },
      { label: "보안 설문", state: "verified", evidence: "Security Questionnaire · Approved" },
      { label: "컴플라이언스 설문", state: "blocked", evidence: "서버 국가와 클라우드 사업자 항목 불완전으로 Rejected" },
      { label: "V3 상품 발행", state: "verified", evidence: "temu.local.goods.v3.add 공식 필드·서명·응답 규격 구현" },
      { label: "이미지·카테고리", state: "verified", evidence: "공개 HTTPS 이미지 자동 저장·카테고리 자동 추천 규격 반영" },
      { label: "프로그램 재조회", state: "verified", evidence: "외부 상품코드로 temu.local.goods.list.retrieve 재검증 구현" },
      { label: "실계정 E2E", state: "not_configured", evidence: "Partner App Key·Secret·판매자 Access Token 미연결" },
    ],
    blockers: ["실제 처리지 한국·싱가포르·미국과 공급사 정보를 컴플라이언스 설문에 정확히 반영", "재심사 승인 후 앱 발행", "한국 판매자 승인 Access Token 발급", "기본 배송 템플릿 설정"],
    nextAction: "컴플라이언스 2개 항목 보완·재제출 → 승인·발행 → 판매자 승인 → Vault 연결 → 상품 목록 읽기",
  },
  {
    key: "smartstore",
    code: "N",
    name: "네이버 스마트스토어",
    market: "한국",
    console: "Naver Commerce API",
    appState: "문의·주문 판매자 권한 추가 · 판매자 계정 및 주문 목록 읽기 정상",
    overall: "partial",
    consoleVerified: true,
    apiReadPassed: true,
    summary: "스마트스토어센터에서 주문과 문의가 모두 0건임을 대조했고 Commerce API 앱에 문의·주문 판매자 권한을 추가했습니다. SellerPilot 판매자 계정 진단과 최근 변경 주문 목록 운영 호출이 모두 정상 통과했으며 문의 목록 직접 검수만 남았습니다.",
    checks: [
      { label: "판매자 세션", state: "verified", evidence: "Couplet Seoul 통합매니저 스마트스토어센터 로그인 확인" },
      { label: "API센터 세션", state: "verified", evidence: "개발업체 커플릿 계정으로 Commerce API센터 로그인" },
      { label: "API 권한 그룹", state: "verified", evidence: "문의 · 주문 판매자 · 상품/N배송 · 판매자정보 저장 확인" },
      { label: "인증 서명", state: "verified", evidence: "client_id_timestamp bcrypt → Base64" },
      { label: "토큰 정책", state: "verified", evidence: "내 스토어 앱 SELF / 솔루션 SELLER + account_id · 10,800초 토큰 · GW.AUTHN 1회 재발급" },
      { label: "주문 체크포인트", state: "verified", evidence: "moreFrom/moreSequence · 1~3분 폴링" },
      { label: "판매자센터 대조", state: "verified", evidence: "실주문 0 · 고객문의 0" },
      { label: "현재 읽기 진단", state: "verified", evidence: "Commerce API 판매자 계정 읽기 정상" },
      { label: "주문 API 권한", state: "verified", evidence: "2026-08-20 orders.list 최근 변경 주문 조회 HTTP 200" },
      { label: "문의 API 권한", state: "partial", evidence: "문의 권한 그룹 저장 완료 · inquiries.list 직접 운영 검수 대기" },
    ],
    blockers: ["문의 목록 직접 운영 호출과 통합 원장 0건 대조", "실주문·문의 발생 시 체크포인트 누락 검수"],
    nextAction: "문의 목록 읽기 검수 → 주문·문의 통합 원장 0건 대조 → 실데이터 발생 시 누락 검수",
  },
  {
    key: "ebay",
    code: "E",
    name: "eBay Global",
    market: "Global",
    console: "eBay Developers Program",
    appState: "User OAuth 운영 키 연결 · 2026-08-20 판매자 권한 읽기 정상",
    overall: "partial",
    consoleVerified: true,
    apiReadPassed: true,
    summary: "eBay Seller Hub에서 주문 0건과 활성 리스팅 18개를 대조했고, SellerPilot의 판매자 권한·판매한도 읽기 진단도 오늘 정상 통과했습니다. 메시지는 대부분 시스템 알림으로 확인됐으며 Sell API 공통 문의함 미지원은 별도 표시합니다.",
    checks: [
      { label: "판매자센터 대조", state: "verified", evidence: "실주문 0 · 활성 리스팅 18 · 메시지 17(대부분 시스템 알림)" },
      { label: "OAuth 동의", state: "verified", evidence: "Production User OAuth 운영 Vault 연결" },
      { label: "토큰 갱신", state: "verified", evidence: "Refresh Token 기반 실행 전 갱신 + Vercel maintenance 보정" },
      { label: "판매자 진단", state: "verified", evidence: "GET /sell/account/v1/privilege/" },
      { label: "상품 워크플로", state: "verified", evidence: "Location → Inventory Item → Offer → Publish" },
      { label: "현재 읽기 진단", state: "verified", evidence: "2026-08-20 Seller 계정 권한과 판매한도 읽기 정상" },
      { label: "통합 문의", state: "not_configured", evidence: "Sell REST API 공통 문의함 미지원 · Seller Hub 보조" },
    ],
    blockers: ["Seller Hub 메시지와 통합 CS의 대체 조회 범위 확정", "마켓플레이스·Business Policy 기본값 확정"],
    nextAction: "Fulfillment 주문 폴링 재대조 → Seller Hub 메시지 보조 동선 유지 → 승인된 Inventory/Offer 테스트",
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
