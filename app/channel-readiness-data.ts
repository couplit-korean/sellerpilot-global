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

export type ChannelReadinessLiveMetric = {
  credentialStatus: string;
  credentialLastCheckStatus: "passed" | "failed" | "manual" | null;
  credentialLastCheckedAt: string | null;
  failedAttemptCount?: number | null;
};

/** Latest dated Partner console facts. Not a live approval field. */
export const temuHistoricComplianceRejectedOn = "2026-09-05";

export const TEMU_EXTERNAL_APPROVAL_UNKNOWN =
  "Partner Platform 현재 승인 증거는 운영 live(credentialStatus·diagnostic)에 없음 · 외부 확인 필요";

export type ChannelGatewaySyncMetric = {
  channel_key: string;
  data_type: "orders" | "inquiries";
  status: string;
  last_error: string | null;
  updated_at?: string | null;
};

export type ChannelGatewayActivity = {
  state: "passed" | "queued" | "running" | "failed" | "reconciliation_required";
  readinessState: ReadinessState;
  evidence: string;
  blocker: string | null;
  nextAction: string;
};

/**
 * 실제 콘솔에서 확인된 사실과 공식 개발자 문서로 확인한 구현 준비 상태를
 * 분리합니다. 앱 키, 시크릿, 판매자 식별자와 일회성 코드는 포함하지 않습니다.
 */
export const channelReadinessObservedAt = "2026.08.24";

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
    summary: "QSM 판매자센터에서 상품·주문·문의 현황을 대조한 뒤 Seller Authorization Key를 재발급해 Vault에 교체했습니다. 상품 상세 읽기와 새 키 기준 주문·문의 주기수집이 모두 정상이며, 판매자센터의 현재 0건 현황과 통합 원장이 일치합니다.",
    checks: [
      { label: "판매자 콘솔 접근", state: "verified", evidence: "실계정 QSM 로그인과 대시보드 조회 완료" },
      { label: "상품 현황", state: "verified", evidence: "전체 48개 · 판매중 42개 · 재고 10개 이하 37개 · 판매종료 1개" },
      { label: "주문·문의 현황", state: "verified", evidence: "신규주문 0 · 미답변 고객문의 0 · 판매자 메시지 미답변 0" },
      { label: "등록 필드 매핑", state: "verified", evidence: "필수 12개 그룹과 이미지·옵션·배송·부가정보 구조 확인" },
      { label: "QAPI 프로토콜", state: "verified", evidence: "ItemsLookup.GetItemDetailInfo v1.2 진단과 현재 엔드포인트 구현" },
      { label: "Vault 자격증명", state: "verified", evidence: "운영 키 v6 · 만료일 2027-08-20 · 새 Seller Authorization Key 암호화 보관" },
      { label: "현재 읽기 진단", state: "verified", evidence: "2026-08-20 실제 상품 1건 ItemsLookup.GetItemDetailInfo 정상 응답" },
      { label: "주문·문의 동기화", state: "verified", evidence: "새 키 기준 주문·미답변 문의 주기수집 정상 완료 · 판매자센터 0건과 원장 일치" },
    ],
    blockers: ["실주문·문의 발생 시 통합 원장 누락 검수"],
    nextAction: "주문·문의 주기수집 유지 → 실데이터 발생 시 원장 누락 검수",
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
    appState: "판매자 읽기 정상 · 배송 구현 계약 검증 · 운영 앱 Buyer IM 권한 거절",
    overall: "partial",
    consoleVerified: false,
    apiReadPassed: true,
    summary: "Lazada MY seller/get과 주문 읽기는 정상입니다. 다만 운영 앱의 IM 세션 호출은 현재 Lazada가 App permission 부족으로 거절하므로 실제 채팅을 가져오지 못합니다. 개발자센터에는 IM API가 존재하지만 앱별 권한 승인이 별도로 필요합니다.",
    checks: [
      { label: "개발자 앱 상태", state: "partial", evidence: "이전 Couplit Commerce Online 확인 이력 있음 · 현재 운영 앱 Buyer IM 권한 상태 재확인 필요" },
      { label: "API 권한 그룹", state: "partial", evidence: "판매자·주문 읽기 정상 · IM 세션 API는 App permission 거절" },
      { label: "판매자 허용 범위", state: "partial", evidence: "MY·PH·SG·TH·VN 5개 허용목록 확인 · ID 실스토어 미확보" },
      { label: "OAuth 콜백", state: "verified", evidence: "https://sellerpilot-global.vercel.app/ 로 운영 콜백 변경" },
      { label: "판매자센터 대조", state: "partial", evidence: "과거 대조 이력 있음 · 현재 채팅 수치는 IM 권한 차단으로 재검증 불가" },
      { label: "운영 앱 키", state: "verified", evidence: "App Key·Secret과 콜백 URL을 실제 콘솔에서 확인" },
      { label: "현재 읽기 진단", state: "verified", evidence: "2026-08-20 Lazada MY 판매자 읽기 API 정상" },
      { label: "토큰 교환", state: "verified", evidence: "운영 Vault v2 토큰으로 seller/get 성공" },
      { label: "배송 구현 계약", state: "verified", evidence: "공식 GetShipmentProvider → Pack → ReadyToShip 요청명·순서 자동 테스트 통과 · 실발송 성공 증거와 구분" },
      { label: "실주문 발송", state: "blocked", evidence: "paid·ready_to_ship 운영 주문 0건 · 외부 상태를 바꾸는 쓰기 미실행" },
      { label: "Push Mechanism", state: "not_configured", evidence: "콜백 URL 비어 있음 · 6개 이벤트 그룹 미선택" },
      { label: "토큰 정책", state: "verified", evidence: "Access 30일 · Refresh 180일 정책 확인" },
    ],
    blockers: ["운영 앱 Buyer IM 권한 승인", "안전하게 검수할 paid·ready_to_ship 실주문", "ID 실셀러 스토어 확보", "Push Mechanism 이벤트 구독", "6개 국가 주문·문의 수집 범위 실검증"],
    nextAction: "개발자센터에서 운영 앱 Buyer IM 권한 승인 확인 → MY 채팅 재동기화 → 안전한 실주문 발생 시 Pack·RTS 검수",
    officialDocs: [
      { label: "API 권한 신청", url: "https://open.lazada.com/apps/doc/doc?docId=108131&nodeId=10535" },
      { label: "IM 세션 목록", url: "https://open.lazada.com/apps/doc/api?path=/im/session/list" },
      { label: "IM 메시지 목록", url: "https://open.lazada.com/apps/doc/api?path=/im/message/list" },
      { label: "IM 답변 전송", url: "https://open.lazada.com/apps/doc/api?path=/im/message/send" },
    ],
  },
  {
    key: "coupang",
    code: "C",
    name: "쿠팡 WING",
    market: "한국",
    console: "Coupang Open API",
    appState: "2026-08-24 콘솔 스냅샷 · 당시 WING 로그인·Open API 읽기 정상 · 현재 연결은 운영 live로만 판정",
    overall: "partial",
    consoleVerified: true,
    apiReadPassed: false,
    summary: "2026-08-24 WING 화면에서는 실제 주문 1건과 당시 표시된 문의 0건을 대조했습니다. 이 수치는 당시 스냅샷이며 현재 live 연결·문의 건수를 뜻하지 않습니다. 상품문의와 고객센터 문의를 상태별로 나눈 최근 30일 읽기 전용 백필 경로를 추가했으며, 실제 최신 수집 결과는 위 LIVE 문의 동기화 원장으로 판정합니다.",
    checks: [
      { label: "판매자센터 대조", state: "verified", evidence: "2026-08-24 시점 실주문 1 · 당시 표시 문의 0 · 전체 이력 판정과 분리" },
      { label: "HMAC 서명", state: "verified", evidence: "signedDate + method + path + query 규칙 구현" },
      { label: "안전한 연결 검사", state: "verified", evidence: "상품 목록 maxPerPage=1 읽기 규격 구현 · 현재 live 통과와 분리" },
      { label: "상품·재고", state: "verified", evidence: "sellerProductId/vendorItemId 2단계 매핑 반영" },
      { label: "주문·배송", state: "verified", evidence: "ordersheets nextToken와 발주 후 주소 재조회 규칙 반영" },
      { label: "키 수명", state: "verified", evidence: "OpenAPI Key 180일 · 만료 14일 전 재발급 활성화" },
      { label: "당시 읽기 진단", state: "verified", evidence: "2026-08-24 등록상품 목록 읽기 정상 이력 · 현재 운영 읽기는 live credentialStatus·diagnostic으로만 판정" },
      { label: "주문 동기화", state: "verified", evidence: "2026-08-24 쿠팡 실제 주문 1건을 SellerPilot 통합 원장에 적재·표시한 이력" },
      { label: "문의 이력 수집", state: "partial", evidence: "상품문의 ALL과 고객센터 NONE·ANSWER·NO_ANSWER·TRANSFER를 공식 7일 이하 구간으로 분리 구현 · 운영 백필 결과 재대조 필요" },
    ],
    blockers: ["최근 30일 문의 백필의 운영 완료와 WING 과거 문의 건수 대조", "외부 상태 변경 전 승인된 테스트상품 범위 확정"],
    nextAction: "최근 30일 문의 읽기 전용 백필 → WING 과거 문의와 원장 대조 → 승인된 제한 쓰기 검수",
    officialDocs: [
      { label: "상품별 고객문의 조회", url: "https://developers.coupangcorp.com/hc/ko/articles/360033400754-%EC%83%81%ED%92%88%EB%B3%84-%EA%B3%A0%EA%B0%9D%EB%AC%B8%EC%9D%98-%EC%A1%B0%ED%9A%8C" },
      { label: "CS API Workflow", url: "https://developers.coupangcorp.com/hc/en-us/articles/360033643314-CS-API-Workflow" },
    ],
  },
  {
    key: "elevenst",
    code: "11",
    name: "11번가",
    market: "한국",
    console: "11번가 Seller Office · OPEN API",
    appState: "OPEN API 운영 키·고정 IP 연결 · 상품 읽기·listing.create 성공 · Seller Office 화면 대조 대기",
    overall: "partial",
    consoleVerified: false,
    apiReadPassed: true,
    summary: "운영 OPEN API Key와 등록 IP로 상품 읽기가 정상이며, 2026-08-24 케이블 정리 상품의 listing.create가 HTTP 200으로 완료되어 원격 상품번호가 작업 원장에 기록됐습니다. 공식 공개 서비스 소개에는 상품 Q&A와 긴급알리미 조회·답변 기능이 존재하지만, 로그인 전 화면에서는 정확한 Seller API 계약과 현재 키의 서비스 등록 범위를 확인할 수 없어 SellerPilot 문의 수집은 추정 구현 없이 차단했습니다.",
    checks: [
      { label: "판매자센터 화면 대조", state: "partial", evidence: "CHANGHEE 프로필에서 기록된 원격 상품번호의 Seller Office 화면 대조 증거 필요" },
      { label: "OPEN API 계정", state: "verified", evidence: "운영 OPEN API Key와 등록 IP로 판매자 상품 읽기·등록 호출 정상" },
      { label: "검증된 상품 API 범위", state: "verified", evidence: "상품 등록·콘텐츠 수정·판매중지 구현 · 정확한 prdNo 사전·사후 재조회" },
      { label: "상품 콘텐츠 수정", state: "verified", evidence: "성공 등록 전체 Product 원본을 보존하고 상품명·설명·필수정보·이미지만 병합 · 가격·재고·배송정책 유지" },
      { label: "미검증 가격·재고 변경", state: "blocked", evidence: "가격·재고 전용 readback과 서비스 권한 확인 전 자동 실행 차단" },
      { label: "검증된 주문 API 범위", state: "verified", evidence: "결제완료 주문 목록 주기조회 구현 · 현재 수집 주문 0건" },
      { label: "미검증 발송 범위", state: "blocked", evidence: "eligible 실주문 0건 · 발주·송장 공식 엔드포인트와 서비스 권한 검증 전 자동 실행 차단" },
      { label: "서비스 등록", state: "verified", evidence: "등록 IP에서 판매자 전용 상품 API 호출 및 listing.create 성공" },
      { label: "운영 API Key", state: "verified", evidence: "Vault 운영 키 연결 · 2026-08-24 연결 검사 통과" },
      { label: "SellerPilot 읽기 진단", state: "verified", evidence: "2026-08-24 OPEN API 상품 검색 읽기 정상" },
      { label: "실상품 등록·재조회", state: "verified", evidence: "2026-08-24 케이블 정리 상품 listing.create HTTP 200 · 원격 상품번호 기록" },
      { label: "주문 동기화", state: "verified", evidence: "2026-08-24 주문 목록 주기수집 정상 · 현재 수집 주문 0건" },
      { label: "문의 동기화", state: "blocked", evidence: "공식 서비스 소개에서 상품 Q&A·긴급알리미 기능 존재 확인 · 인증된 상세 엔드포인트·필드·페이지·기간 제약과 현재 키 서비스 등록 범위 미검증" },
    ],
    blockers: ["CHANGHEE 프로필에서 원격 상품 화면 대조", "인증된 개발 가이드의 상품 Q&A·긴급알리미 상세 계약과 현재 OPEN API Key 서비스 등록 범위 확인", "실주문 부재로 발주·송장 쓰기 미검증"],
    nextAction: "CHANGHEE에서 11번가 개발 가이드와 현재 키의 상품 Q&A·긴급알리미 서비스 등록 범위를 확인 → 공식 읽기 계약만 구현·검증 → 기록된 원격 상품번호를 Seller Office 화면에서 대조",
    officialDocs: [
      { label: "OPEN API 센터", url: "https://openapi.11st.co.kr/openapi/OpenApiFrontMain.tmall" },
      { label: "상품 Q&A 서비스 소개", url: "https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=PRODUCT#info5" },
      { label: "긴급알리미 서비스 소개", url: "https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=NOTIFY" },
      { label: "주문 API", url: "https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=ORDER" },
    ],
  },
  {
    key: "temu",
    code: "T",
    name: "Temu Korea",
    market: "한국",
    console: "Temu Partner Platform",
    appState: `${temuHistoricComplianceRejectedOn} 이력 · Partner Inactive · Compliance Rejected · 현재 승인은 외부 확인 필요`,
    overall: "blocked",
    consoleVerified: true,
    apiReadPassed: false,
    summary: `2026-08-24 콘솔 기록은 재제출 전 마지막 스냅샷이며 현재 심사 결과를 뜻하지 않습니다. ${temuHistoricComplianceRejectedOn} 확인 이력은 Partner App Inactive, Compliance and security assessment Rejected, Vault 운영 키 없음, gateway job 0건입니다. 이 Rejected 이력은 날짜가 붙은 외부 차단 근거이며 현재 live 승인 상태가 아닙니다. 운영 live는 credentialStatus·읽기 진단만 노출하므로 현재 승인은 외부 확인이 필요합니다. V3 상품 발행·재조회 코드 구현은 실계정 발행·CS 연결과 분리합니다.`,
    checks: [
      { label: "판매자 계정", state: "verified", evidence: "2026-08-24 콘솔에서 COUPLIT 한국 스토어 활성 상태 확인" },
      { label: "Partner App", state: "blocked", evidence: `${temuHistoricComplianceRejectedOn} 이력: SellerPilot · Self-developed · Inactive · 현재 live 승인 증거 없음 · 외부 확인 필요` },
      { label: "보안 설문", state: "verified", evidence: "2026-08-24 콘솔에서 Security Questionnaire 승인 확인" },
      { label: "컴플라이언스 설문", state: "blocked", evidence: `${temuHistoricComplianceRejectedOn} 이력: Compliance and security assessment Rejected · 현재 live 승인 필드 없음 · 외부 차단이며 행동 루프가 아님` },
      { label: "V3 상품 발행 구현", state: "verified", evidence: "temu.local.goods.v3.add 공식 필드·서명·응답 규격 코드 구현 · 실계정 발행 성공·생성 불능 단정과 분리" },
      { label: "이미지·카테고리", state: "verified", evidence: "공개 HTTPS 이미지 자동 저장·카테고리 자동 추천 규격 코드 반영 · live 발행과 분리" },
      { label: "프로그램 재조회", state: "verified", evidence: "외부 상품코드로 temu.local.goods.list.retrieve 재검증 코드 구현 · live 재조회 성공과 분리" },
      { label: "실계정 E2E", state: "not_configured", evidence: "운영 live credentialStatus 기준 실계정 읽기·발행·CS는 아직 증명되지 않음" },
    ],
    blockers: [TEMU_EXTERNAL_APPROVAL_UNKNOWN, "기본 배송 템플릿은 실계정 발행 증거와 분리해 미확인으로 둡니다."],
    nextAction: "외부 심사 차단입니다. 내부 행동 루프를 시작하지 않습니다. 현재 승인은 운영 live(credentialStatus/diagnostic)로 증명되지 않으므로 외부 확인이 필요합니다.",
  },
  {
    key: "smartstore",
    code: "N",
    name: "네이버 스마트스토어",
    market: "한국",
    console: "Naver Commerce API",
    appState: "문의·주문 판매자 권한 연결 · 상품 Q&A 읽기 정상 · 고객문의 별도 경로 운영 재검증 중",
    overall: "partial",
    consoleVerified: true,
    apiReadPassed: true,
    summary: "기존 검수는 스마트스토어 상품 Q&A만 조회해 당시 화면의 0건과 대조했으며, 별도 구매자 고객문의 이력까지 증명한 것은 아니었습니다. 현재 상품 Q&A와 고객문의를 분리해 수집·저장하고 최근 30일을 읽기 전용으로 다시 불러오는 경로를 추가했으며, 최신 실제 건수는 위 LIVE 원장으로 판정합니다.",
    checks: [
      { label: "판매자 세션", state: "verified", evidence: "Couplet Seoul 통합매니저 스마트스토어센터 로그인 확인" },
      { label: "API센터 세션", state: "verified", evidence: "개발업체 커플릿 계정으로 Commerce API센터 로그인" },
      { label: "API 권한 그룹", state: "verified", evidence: "문의 · 주문 판매자 · 상품/N배송 · 판매자정보 저장 확인" },
      { label: "인증 서명", state: "verified", evidence: "client_id_timestamp bcrypt → Base64" },
      { label: "토큰 정책", state: "verified", evidence: "내 스토어 앱 SELF / 솔루션 SELLER + account_id · 10,800초 토큰 · GW.AUTHN 1회 재발급" },
      { label: "주문 체크포인트", state: "verified", evidence: "moreFrom/moreSequence · 1~3분 폴링" },
      { label: "판매자센터 대조", state: "partial", evidence: "기존 화면 스냅샷 0건은 상품 Q&A 중심 검수 · 구매자 고객문의 과거 이력 재대조 필요" },
      { label: "현재 읽기 진단", state: "verified", evidence: "Commerce API 판매자 계정 읽기 정상" },
      { label: "주문 API 권한", state: "verified", evidence: "2026-08-20 orders.list 최근 변경 주문 조회 HTTP 200" },
      { label: "상품 Q&A API", state: "verified", evidence: "필수 기간 인자를 적용한 /v1/contents/qnas 운영 호출 정상 완료" },
      { label: "구매자 고객문의 API", state: "partial", evidence: "/v1/pay-user/inquiries 조회와 inquiryNo 기반 답변 계보 구현 · 최근 30일 운영 백필 결과 재대조 필요" },
    ],
    blockers: ["최근 30일 구매자 고객문의 백필의 운영 완료와 스마트스토어센터 이력 대조"],
    nextAction: "상품 Q&A·구매자 고객문의 최근 30일 백필 → 채널별 원장 건수 대조 → 주기수집 유지",
    officialDocs: [
      { label: "상품 문의 목록", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current/get-comments-contents" },
      { label: "상품 문의 답변", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current/create-or-update-answer-contents" },
      { label: "고객 문의 목록", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current/get-customer-inquiry-pay-user" },
      { label: "고객 문의 답변", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current/insert-inquiry-answer-pay-merchant" },
    ],
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
    summary: "eBay Seller Hub에서 주문 0건과 활성 리스팅 18개를 대조했고, SellerPilot의 판매자 권한·판매한도 읽기 진단도 정상 통과했습니다. 상품 문의는 Trading API의 ASQ 조회·답변과 계보 검증까지 구현됐지만, 현재 운영 자격증명 검증·상시 작업자·실문의 E2E가 남아 있어 원격 CS 연결 완료로 표시하지 않습니다.",
    checks: [
      { label: "판매자센터 대조", state: "verified", evidence: "실주문 0 · 활성 리스팅 18 · 메시지 17(대부분 시스템 알림)" },
      { label: "OAuth 동의", state: "verified", evidence: "Production User OAuth 운영 Vault 연결" },
      { label: "토큰 갱신", state: "verified", evidence: "Refresh Token 기반 실행 전 갱신 + Vercel maintenance 보정" },
      { label: "판매자 진단", state: "verified", evidence: "GET /sell/account/v1/privilege/" },
      { label: "상품 워크플로", state: "verified", evidence: "Location → Inventory Item → Offer → Publish" },
      { label: "현재 읽기 진단", state: "verified", evidence: "2026-08-20 Seller 계정 권한과 판매한도 읽기 정상" },
      { label: "상품 문의 ASQ", state: "partial", evidence: "Trading API GetMemberMessages·AddMemberMessageRTQ 및 계보 검증 구현 · 운영 작업자와 실문의 E2E 대기" },
    ],
    blockers: ["상시 gateway/scheduler 작업자 연결과 운영 자격증명 GetUser 검증", "실제 ASQ 문의 수집과 사용자 승인 답변 E2E", "마켓플레이스·Business Policy 기본값 확정"],
    nextAction: "상시 작업자 연결 → GetUser 계정 검증 → ASQ 문의 수집 확인 → 사용자 승인 답변 E2E",
  },
];

function liveCheckTimestamp(value: string | null) {
  if (!value) return "확인 시각 미기록";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "확인 시각 형식 오류";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(timestamp));
}

function liveCredentialProjection(metric: ChannelReadinessLiveMetric) {
  const checkedAt = liveCheckTimestamp(metric.credentialLastCheckedAt);
  const passed = metric.credentialStatus === "active" && metric.credentialLastCheckStatus === "passed";
  if (passed) {
    return {
      state: "verified" as const,
      apiReadPassed: true,
      appState: `운영 DB 실시간 · Vault 키 등록 · API 읽기 진단 통과 · ${checkedAt}`,
      evidence: `현재 운영 Vault 자격증명의 읽기 진단 통과 · ${checkedAt}`,
      summary: `현재 운영 DB에서 유효한 자격증명과 API 읽기 진단 통과를 확인했습니다. 읽기 진단 통과는 상품 발행이나 CS 전체 연결과 같지 않습니다. 마지막 콘솔 스냅샷과 별개인 실시간 운영 근거입니다.`,
      blocker: null,
      nextAction: "현재 읽기 진단 유지",
    };
  }
  if (metric.credentialStatus !== "missing") {
    const failed = metric.credentialLastCheckStatus === "failed";
    const manual = metric.credentialLastCheckStatus === "manual";
    const statusText = failed
      ? "최근 API 읽기 진단 실패"
      : manual
        ? "연결 원장 수동 확인 필요"
        : "API 읽기 진단 필요";
    return {
      state: failed || manual ? "blocked" as const : "partial" as const,
      apiReadPassed: false,
      appState: `운영 DB 실시간 · Vault 키 등록 · ${statusText} · ${checkedAt}`,
      evidence: `현재 운영 Vault 자격증명 등록 · ${manual ? "연결 원장 수동 확인 필요" : failed ? "최근 읽기 진단 실패" : "읽기 진단 미확정"} · ${checkedAt}`,
      summary: `현재 운영 DB에는 자격증명이 등록돼 있지만 ${manual ? "연결 원장을 수동 확인해야 합니다" : `API 읽기 진단은 ${failed ? "실패했습니다" : "아직 통과하지 않았습니다"}`}. 마지막 콘솔 스냅샷만으로 현재 연결 성공을 주장하지 않습니다.`,
      blocker: manual
        ? "현재 운영 연결 원장의 수동 확인 완료"
        : failed
          ? "현재 운영 자격증명의 API 읽기 진단 실패 원인 해소"
          : "현재 운영 자격증명의 API 읽기 진단 통과",
      nextAction: manual
        ? "원격 판매자센터와 연결 원장 대조 → 연결 검사 재실행"
        : failed
          ? "운영 자격증명 오류 확인 → API 읽기 진단 재실행"
          : "API 읽기 진단 실행",
    };
  }
  return {
    state: "not_configured" as const,
    apiReadPassed: false,
    appState: "운영 DB 실시간 · Vault 운영 키 미등록",
    evidence: "현재 운영 DB에 활성 production 자격증명이 없습니다.",
    summary: "현재 운영 DB에는 활성 production 자격증명이 없습니다. 과거 콘솔 스냅샷은 현재 API 연결을 증명하지 않습니다.",
    blocker: "현재 운영 Vault production 자격증명 연결",
    nextAction: "운영 자격증명 연결 → API 읽기 진단 실행",
  };
}

const reconciliationMarker = /reconcil|provider outcome|manual.required|원장 확인|수동 확인|외부 결과 확인/i;

function normalizedGatewayState(metric: ChannelGatewaySyncMetric): ChannelGatewayActivity["state"] | null {
  if (metric.status === "reconciliation_required"
      || (metric.status === "failed" && reconciliationMarker.test(metric.last_error ?? ""))) {
    return "reconciliation_required";
  }
  if (["queued", "running", "failed", "passed"].includes(metric.status)) {
    return metric.status as ChannelGatewayActivity["state"];
  }
  return null;
}

const gatewayStatePriority: Record<ChannelGatewayActivity["state"], number> = {
  reconciliation_required: 5,
  failed: 4,
  running: 3,
  queued: 2,
  passed: 1,
};

export function resolveChannelGatewayActivity(
  channelKey: ChannelReadiness["key"],
  metrics: readonly ChannelGatewaySyncMetric[],
): ChannelGatewayActivity | undefined {
  const rows = metrics.flatMap((metric) => {
    if (metric.channel_key !== channelKey) return [];
    const state = normalizedGatewayState(metric);
    return state ? [{ metric, state }] : [];
  });
  if (rows.length === 0) return undefined;

  const state = rows.reduce<ChannelGatewayActivity["state"]>((current, row) =>
    gatewayStatePriority[row.state] > gatewayStatePriority[current] ? row.state : current, rows[0].state);
  const dataLabels = rows
    .filter((row) => row.state === state)
    .map((row) => row.metric.data_type === "orders" ? "주문" : "문의");
  const targets = [...new Set(dataLabels)].join("·");
  if (state === "reconciliation_required") {
    return {
      state,
      readinessState: "blocked",
      evidence: `${targets} 게이트웨이 결과를 원격 판매자센터와 수동 대조해야 합니다. 자동 재실행하지 않습니다.`,
      blocker: `${targets} 게이트웨이 원장 확인 필요`,
      nextAction: `${targets} 원격 결과 대조 → 원장 조정 완료 후 동기화 재개`,
    };
  }
  if (state === "failed") {
    return {
      state,
      readinessState: "blocked",
      evidence: `${targets} 게이트웨이의 최근 동기화가 실패했습니다.`,
      blocker: `${targets} 게이트웨이 실패 원인 해소`,
      nextAction: `${targets} 게이트웨이 오류 확인 → 안전한 읽기 동기화 재실행`,
    };
  }
  if (state === "running" || state === "queued") {
    const progress = state === "running" ? "실행 중" : "대기 중";
    return {
      state,
      readinessState: "partial",
      evidence: `${targets} 게이트웨이 작업이 ${progress}입니다. 완료 전에는 최신 데이터 연결을 주장하지 않습니다.`,
      blocker: null,
      nextAction: `${targets} 게이트웨이 ${progress} 결과 확인`,
    };
  }
  return {
    state,
    readinessState: "verified",
    evidence: `${targets} 게이트웨이의 최근 동기화가 정상 완료됐습니다.`,
    blocker: null,
    nextAction: `${targets} 게이트웨이 주기 동기화 유지`,
  };
}

function mergeGatewayActivity(
  channel: ChannelReadiness,
  gateway: ChannelGatewayActivity | undefined,
): ChannelReadiness {
  if (!gateway) return channel;
  const gatewayCheck: ReadinessCheck = {
    label: "현재 게이트웨이 작업",
    state: gateway.readinessState,
    evidence: gateway.evidence,
  };
  const pending = gateway.state === "queued" || gateway.state === "running";
  const statusText = gateway.state === "reconciliation_required"
    ? "원장 확인 필요"
    : gateway.state === "failed"
      ? "최근 실패"
      : gateway.state === "running"
        ? "실행 중"
        : gateway.state === "queued"
          ? "대기 중"
          : "최근 완료";
  return {
    ...channel,
    overall: gateway.readinessState === "blocked"
      ? "blocked"
      : pending && channel.overall === "verified"
        ? "partial"
        : channel.overall,
    appState: `게이트웨이 ${statusText} · ${channel.appState}`,
    summary: `${gateway.evidence} ${channel.summary}`,
    checks: [gatewayCheck, ...channel.checks.filter((check) => check.label !== gatewayCheck.label)],
    blockers: gateway.blocker && !channel.blockers.includes(gateway.blocker)
      ? [gateway.blocker, ...channel.blockers]
      : channel.blockers,
    nextAction: pending || gateway.readinessState === "blocked"
      ? `${gateway.nextAction} → ${channel.nextAction}`
      : channel.nextAction,
  };
}

function temuLiveNextAction(
  live: ReturnType<typeof liveCredentialProjection>,
  metric: ChannelReadinessLiveMetric,
) {
  if (live.apiReadPassed) {
    return "현재 API 읽기 진단은 통과했지만 상품 발행·CS 전체 준비와 같지 않습니다. Partner 현재 승인은 live에 없어 외부 확인이 필요합니다.";
  }
  if (metric.credentialStatus === "missing") {
    return "현재 운영 키가 없고 Partner 현재 승인은 live에 없습니다. 외부 확인이 필요하며 내부 행동 루프를 시작하지 않습니다.";
  }
  return `${live.nextAction} · Partner 현재 승인은 live에 없어 외부 확인이 필요합니다.`;
}

function resolveCredentialReadiness(
  channel: ChannelReadiness,
  metric: ChannelReadinessLiveMetric,
): ChannelReadiness {
  const live = liveCredentialProjection(metric);
  const liveCheck: ReadinessCheck = {
    label: "현재 운영 API 읽기",
    state: live.state,
    evidence: live.evidence,
  };
  const historicalSummary = `마지막 콘솔 스냅샷(${channelReadinessObservedAt}): ${channel.summary}`;
  const overall: ReadinessState = live.apiReadPassed
    ? channel.overall === "verified" || channel.overall === "blocked"
      ? "partial"
      : channel.overall
    : live.state;

  if (channel.key !== "temu") {
    return {
      ...channel,
      // A successful credential read proves only that the current key can read
      // one safe provider resource. It must not erase channel-level blockers
      // such as unverified writes, missing fixed egress, or absent seller-console
      // readback evidence. It is also not publication or CS-complete.
      overall,
      apiReadPassed: live.apiReadPassed,
      appState: live.appState,
      summary: `${live.summary} ${historicalSummary}`,
      checks: [liveCheck, ...channel.checks.filter((check) => check.label !== liveCheck.label)],
      blockers: live.blocker && !channel.blockers.includes(live.blocker)
        ? [live.blocker, ...channel.blockers]
        : channel.blockers,
      nextAction: live.apiReadPassed ? channel.nextAction : `${live.nextAction} → ${channel.nextAction}`,
    };
  }

  const temuBlockers = [
    TEMU_EXTERNAL_APPROVAL_UNKNOWN,
    ...(live.blocker && metric.credentialStatus !== "missing" ? [live.blocker] : []),
    "기본 배송 템플릿은 실계정 발행 증거와 분리해 미확인으로 둡니다.",
  ];

  return {
    ...channel,
    overall,
    apiReadPassed: live.apiReadPassed,
    appState: live.appState,
    summary: `${live.summary} ${historicalSummary}`,
    checks: [liveCheck, ...channel.checks.filter((check) => check.label !== "실계정 E2E" && check.label !== liveCheck.label)],
    blockers: [...new Set(temuBlockers)],
    nextAction: temuLiveNextAction(live, metric),
  };
}

export function resolveChannelReadiness(
  channel: ChannelReadiness,
  metric?: ChannelReadinessLiveMetric,
  gateway?: ChannelGatewayActivity,
): ChannelReadiness {
  return mergeGatewayActivity(metric ? resolveCredentialReadiness(channel, metric) : channel, gateway);
}

export function channelOverviewHealthLabel(metric: {
  credentialStatus?: string | null;
  failedAttemptCount?: number | null;
}): string {
  const failed = metric.failedAttemptCount ?? 0;
  if (failed > 0) return `오류 ${failed}`;
  if (metric.credentialStatus === "active") return "읽기 진단 통과";
  if (metric.credentialStatus === "unverified") return "진단 필요";
  return "키 필요";
}

export function channelStepSelectionLabel(selectedCount: number): string {
  return `${selectedCount}개 선택`;
}

export const qoo10RegistrationMap = [
  { group: "카테고리·브랜드", fields: "대·중·소 카테고리, 카테고리 검색, 브랜드 코드/없음", rule: "카테고리별 필수속성 재조회" },
  { group: "상품 식별", fields: "상품명, 홍보문구, 판매자 상품코드", rule: "상품명 100자 · 홍보문구 20자 · 코드 100자" },
  { group: "판매 정보", fields: "판매기간, 판매가, 참고가, 재고, 구매제한, 할인, Q포인트", rule: "판매가 JPY · 재고/가격 상한 사전검사" },
  { group: "상품 이미지", fields: "대표 1장, 추가 최대 50장, 동영상 최대 1개", rule: "Qoo10 규격 참고: JPG/PNG/GIF · SellerPilot 현재 전송: 검증·정규화 JPEG만 · GIF 채널 전송 미지원" },
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
