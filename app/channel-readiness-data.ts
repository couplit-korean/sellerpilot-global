import { channelIntegrationStatus } from "../lib/channels/integration-status";

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
export const temuHistoricComplianceRejectedOn = "2026-09-08";

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
// Static console snapshot. It is only a fallback: whenever live channel metrics
// exist the UI must use them and label this data as a dated snapshot.

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
    summary: "QSM 판매자센터에서 상품·주문·문의 현황을 대조한 뒤 Seller Authorization Key를 재발급해 Vault에 교체했습니다. 일반 문의와 공식 GetClaimInfo_V3 기반 취소·반품·교환·미수취 클레임의 현재·과거 읽기 경로를 로컬에 분리 구현했습니다. 클레임은 주문번호·사유·처리상태·배송 정보만 보관하고 주소·연락처·구매자 ID는 버리며 답변·환불 mutation을 열지 않습니다. QSM의 별도 리뷰조회/댓글관리 화면은 공식 QAPI에 리뷰 API가 없어 통합 원장 완료 범위에서 분리합니다.",
    checks: [
      { label: "판매자 콘솔 접근", state: "verified", evidence: "실계정 QSM 로그인과 대시보드 조회 완료" },
      { label: "상품 현황", state: "verified", evidence: "전체 48개 · 판매중 42개 · 재고 10개 이하 37개 · 판매종료 1개" },
      { label: "주문·문의 현황", state: "verified", evidence: "신규주문 0 · 미답변 고객문의 0 · 판매자 메시지 미답변 0" },
      { label: "등록 필드 매핑", state: "verified", evidence: "필수 12개 그룹과 이미지·옵션·배송·부가정보 구조 확인" },
      { label: "QAPI 프로토콜", state: "verified", evidence: "ItemsLookup.GetItemDetailInfo v1.2 진단과 현재 엔드포인트 구현" },
      { label: "Vault 자격증명", state: "verified", evidence: "운영 키 v6 · 만료일 2027-08-20 · 새 Seller Authorization Key 암호화 보관" },
      { label: "현재 읽기 진단", state: "verified", evidence: "2026-08-20 실제 상품 1건 ItemsLookup.GetItemDetailInfo 정상 응답" },
      { label: "주문·일반 문의 동기화", state: "verified", evidence: "새 키 기준 주문·미답변 문의 주기수집 정상 완료 · 판매자센터 0건과 원장 일치" },
      { label: "취소·반품·교환 클레임", state: "partial", evidence: "공식 ShippingBasic.GetClaimInfo_V3 요청일 기준 현재 6일·매일 30일 읽기와 개인정보 제외 로컬 계약 구현 · 운영 원격 ID 전량 대조 필요" },
      { label: "리뷰·댓글", state: "blocked", evidence: "QSM 별도 리뷰조회/댓글관리 화면 확인 · 공식 QAPI 전체 Method 목록에는 GetInquiryMessage·SetInquiryMessage만 있고 리뷰 조회·댓글 API 없음" },
    ],
    blockers: ["GetClaimInfo_V3 운영 credential 원격 readback과 QSM 클레임 건수·주문번호 전량 대조", "실주문·문의 발생 시 통합 원장 누락 검수", "공식 API가 없는 리뷰의 export 또는 판매자센터 수동 대조 절차"],
    nextAction: "로컬 검증 후 배포·DB 적용 → GetClaimInfo_V3 읽기 canary → QSM 클레임 건수·주문번호 대조 → 리뷰는 export 제공 여부 확인과 수동 대조 유지",
    officialDocs: [
      { label: "Qoo10 QAPI 전체 Method 목록", url: "https://developer.qoo10.jp/GMKT.INC.Gsm.Web/APIDev/APIDevelopPage.aspx" },
    ],
  },
  {
    key: "shopee",
    code: "S",
    name: "Shopee Open Platform",
    market: "Global",
    console: "Shopee Open Platform",
    appState: "운영 OAuth 연결 · 공식 상품 후기·Returns 계약 로컬 구현 · Returns 운영 readback 대기",
    overall: "partial",
    consoleVerified: true,
    apiReadPassed: true,
    summary: "상품 후기 수신·답변과 8개 OAuth 숍 순회에 더해 공식 Returns 목록·상세 조회를 15일 이하 기간과 10건 상세 continuation으로 로컬 구현했습니다. 반품/환불은 답변 mutation 없이 증거·첨부·상태·기한만 저장합니다. Buyer Chat은 2026-09-08 공식 API 목차에서 공개 계약을 찾지 못해 Seller Centre 수동 확인 대상으로 남습니다.",
    checks: [
      { label: "개발자 앱 상태", state: "verified", evidence: "Couplit · Online · Seller In House System" },
      { label: "민감정보 권한", state: "verified", evidence: "Access to Sensitive Data · Can access" },
      { label: "운영 판매자 연결", state: "verified", evidence: "메인 계정 8개 숍 선택 · 365일 재승인 완료" },
      { label: "판매자센터 대조", state: "verified", evidence: "실주문 0 · 채팅 문의 0" },
      { label: "운영 Redirect Domain", state: "verified", evidence: "Test·Live 모두 https://sellerpilot-global.vercel.app 반영" },
      { label: "OAuth 승인 코드", state: "verified", evidence: "메인 계정 콜백과 state 일치 확인" },
      { label: "OAuth 서버 토큰", state: "verified", evidence: "운영 Vault v30 · 판매점 정보 읽기 정상" },
      { label: "토큰 자동 갱신", state: "verified", evidence: "Access 4시간 · Refresh 30일 갱신 로직 적용" },
      { label: "상품 후기 CS", state: "verified", evidence: "8개 OAuth 숍별 get_comment·reply_comment와 전 페이지 continuation 로컬 회귀 통과" },
      { label: "반품·환불 CS", state: "partial", evidence: "공식 get_return_list·get_return_detail, 15일 창, 사유·협상·기한·첨부 정규화 구현 · 운영 shop readback 대기" },
      { label: "Buyer Chat", state: "blocked", evidence: "2026-09-08 공식 API reference 목차에 전용 공개 module·history·reply 계약 미확보" },
      { label: "글로벌 카테고리", state: "verified", evidence: "GlobalProduct 101240 · 필수 Type=Mugs(3933) 실조회" },
      { label: "실상품 등록·읽기", state: "verified", evidence: "Global item 1건→SG local item 1건 · 이미지 5장 · 물류 3개 · UNLIST 안전 검수" },
      { label: "8개 숍 현지화", state: "verified", evidence: "SG·MY·PH·VN·TH·TW·BR·MX 현지어·통화·물류·재고·UNLIST 실발행·재조회 완료" },
      { label: "Push Mechanism", state: "not_configured", evidence: "운영 Push 콜백과 이벤트 구독 실검증 필요" },
    ],
    blockers: ["Returns API의 8개 운영 shop 실제 응답·원장 대조", "Buyer Chat 공개 계약 또는 별도 승인", "운영 Push 콜백·이벤트 구독", "실판매 전 국가별 세금·관세·마진 승인"],
    nextAction: "로컬 release 적용 전 검증 → Returns 읽기 전용 canary → 8개 shop 원격 ID·원장 대조 → Push 구독 검수",
    officialDocs: [
      { label: "반품 목록", url: "https://open.shopee.com/documents/v2/v2.returns.get_return_list?module=102&type=1" },
      { label: "반품 상세", url: "https://open.shopee.com/documents/v2/v2.returns.get_return_detail?module=102&type=1" },
    ],
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
    summary: "2026-08-24 WING 화면에서는 실제 주문 1건과 당시 표시된 문의 0건을 대조했습니다. 이 수치는 당시 스냅샷이며 현재 live 연결·문의 건수를 뜻하지 않습니다. 상품·고객센터 문의와 취소·반품·교환을 분리한 최근 30일 읽기 전용 백필 경로를 구현했으며, 실제 최신 수집 결과는 위 LIVE 문의 동기화 원장으로 판정합니다.",
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
      { label: "취소·반품 이력", state: "partial", evidence: "공식 returnRequests timeFrame을 RETURN·CANCEL로 분리하고 31일 이하 조회·주문 결속·개인정보 제외 구현 · 운영 권한·원격 ID 대조 필요" },
      { label: "교환 이력", state: "partial", evidence: "공식 exchangeRequests를 7일 미만 창과 nextToken으로 전 페이지 수집하도록 구현 · 연락처·주소 제외, 교환 mutation 차단 · 운영 readback 필요" },
    ],
    blockers: ["최근 30일 문의·취소·반품·교환 백필의 운영 완료와 WING 원격 ID 대조", "외부 상태 변경 전 승인된 테스트상품 범위 확정"],
    nextAction: "최근 30일 문의·취소·반품·교환 읽기 전용 백필 → WING 원격 ID와 원장 대조 → 승인된 제한 쓰기 검수",
    officialDocs: [
      { label: "쿠팡 Open API 목록", url: "https://developers.coupang.com/ko/api" },
      { label: "반품·취소 목록", url: "https://developers.coupang.com/ko/api/returns/return-cancellation-request-list-query" },
      { label: "교환 요청 목록", url: "https://developers.coupang.com/ko/api/exchanges/query-a-list-of-exchange-requests" },
      { label: "반품 API Workflow", url: "https://developers.coupang.com/ko/workflows/return-api-workflow" },
    ],
  },
  {
    key: "elevenst",
    code: "11",
    name: "11번가",
    market: "한국",
    console: "11번가 Seller Office · OPEN API",
    appState: "couplit Seller Office 로그인 확인 · 상품 Q&A 목록·답변 공식 계약 확보 · 로컬 수집·답변·30일 이력 구현 · 운영 Key 원격 readback 대기",
    overall: "partial",
    consoleVerified: true,
    apiReadPassed: true,
    summary: "운영 OPEN API Key와 등록 IP로 상품 읽기·등록이 정상이며, 2026-09-08 CHANGHEE 프로필에서 올바른 couplit Seller Office 로그인을 확인했습니다. 인증된 categoryNo=41 가이드에서 상품 Q&A 목록은 최대 7일 GET, 답변은 게시글 번호와 상품 번호에 결속된 PUT임을 확인해 로컬 수집·답변·30일 분할 이력을 구현했습니다. API 관리 화면의 직접 IP 등록 상태와 Key 2차 인증 보호도 확인했지만, 이 로컬 변경으로 운영 Key를 사용한 Q&A 원격 읽기와 원장 대조는 아직 실행하지 않았습니다.",
    checks: [
      { label: "판매자센터 화면 대조", state: "verified", evidence: "2026-09-08 CHANGHEE 프로필에서 couplit 로그인과 커플릿 판매자명을 확인 · 최근 미답변 Q&A 0건 표시는 최근 화면 범위이며 전체 이력 증거는 아님" },
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
      { label: "문의 동기화", state: "blocked", evidence: "인증된 categoryNo=41의 상품 Q&A 최대 7일 목록·답변 계약을 로컬 구현 · 운영 Key 원격 읽기·DB 적재·화면 대조 전이라 외부 연동 완료로 판정하지 않음" },
    ],
    blockers: ["로컬 변경 미배포로 운영 Q&A readback·과거 원장 적재·웹 화면 대조 미실행", "셀러톡·긴급알리미는 상품 Q&A와 다른 표면이며 공식 수집·답변 계약 미확보", "인증된 공식 Q&A 가이드에서 구매후기 조회·댓글 계약 미확인", "실주문 부재로 발주·송장 쓰기 미검증"],
    nextAction: "로컬 전체 검증 → 별도 승인 뒤 DB 마이그레이션·애플리케이션 배포 → couplit 운영 Key로 7일 읽기와 30일 백필 → 원격 Q&A 수·ID와 SellerPilot 원장을 대조 → 답변이 필요한 실문의에서 별도 승인 후 1건 전송·재조회",
    officialDocs: [
      { label: "OPEN API 센터", url: "https://openapi.11st.co.kr/openapi/OpenApiFrontMain.tmall" },
      { label: "상품 Q&A 서비스 소개", url: "https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=PRODUCT#info5" },
      { label: "상품 Q&A 상세 API", url: "https://openapi.11st.co.kr/openapi/OpenApiGuide.tmall?categoryNo=41&apiSpecType=1" },
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
    summary: `2026-09-08 Partner 화면에서 SellerPilot 앱 Inactive와 Compliance Rejected를 다시 확인했습니다. 공식 after-sales 목록은 초 단위 변경시각과 최대 200건 페이지를 사용하고, 상세 API는 구매자 코멘트·사유·환불 내역을 제공하는 계약으로 확인해 로컬 구현했습니다. 상세는 10건씩 재개하고 임의 연락처 필드를 제외하며 답변·환불 승인 mutation은 차단합니다. 앱 활성·심사 승인·운영 credential·원격 readback 전에는 실연동 완료가 아닙니다.`,
    checks: [
      { label: "판매자 계정", state: "verified", evidence: "2026-08-24 콘솔에서 COUPLIT 한국 스토어 활성 상태 확인" },
      { label: "Partner App", state: "blocked", evidence: `${temuHistoricComplianceRejectedOn} 이력: SellerPilot · Self-developed · Inactive · 현재 live 승인 증거 없음 · 외부 확인 필요` },
      { label: "보안 설문", state: "verified", evidence: "2026-08-24 콘솔에서 Security Questionnaire 승인 확인" },
      { label: "컴플라이언스 설문", state: "blocked", evidence: `${temuHistoricComplianceRejectedOn} 이력: Compliance and security assessment Rejected · 현재 live 승인 필드 없음 · 외부 차단이며 행동 루프가 아님` },
      { label: "V3 상품 발행 구현", state: "verified", evidence: "temu.local.goods.v3.add 공식 필드·서명·응답 규격 코드 구현 · 실계정 발행 성공·생성 불능 단정과 분리" },
      { label: "이미지·카테고리", state: "verified", evidence: "공개 HTTPS 이미지 자동 저장·카테고리 자동 추천 규격 코드 반영 · live 발행과 분리" },
      { label: "프로그램 재조회", state: "verified", evidence: "외부 상품코드로 temu.local.goods.list.retrieve 재검증 코드 구현 · live 재조회 성공과 분리" },
      { label: "반품·환불 CS", state: "partial", evidence: "공식 parent after-sales 목록·상세, 초 단위 기간, 10건 continuation, 구매자 사유·환불 증거의 읽기 전용 로컬 회귀 통과" },
      { label: "Buyer Chat", state: "blocked", evidence: "공식 API reference 목차에 Return and Refund는 있으나 Buyer Chat 전용 history·reply 계약 미확보" },
      { label: "실계정 E2E", state: "not_configured", evidence: "운영 live credentialStatus 기준 실계정 읽기·발행·CS는 아직 증명되지 않음" },
    ],
    blockers: [TEMU_EXTERNAL_APPROVAL_UNKNOWN, "Partner App Inactive·Compliance Rejected", "운영 credential·고정 egress·after-sales 원격 readback", "Buyer Chat 공개 계약 또는 별도 승인"],
    nextAction: "외부 심사 승인과 앱 활성 확인 → 운영 credential 결속 → after-sales 읽기 전용 canary와 원격 ID 대조",
    officialDocs: [
      { label: "After-sales 목록", url: "https://partner.temu.com/documentation?menu_code=fb16b05f7a904765aac4af3a24b87d4a&sub_menu_code=36d2f55993344cf2991815f675493560" },
      { label: "After-sales 상세", url: "https://partner.temu.com/documentation?menu_code=fb16b05f7a904765aac4af3a24b87d4a&sub_menu_code=96269b0c4bf145e5b8c89c3f00511a80" },
    ],
  },
  {
    key: "smartstore",
    code: "N",
    name: "네이버 스마트스토어",
    market: "한국",
    console: "Naver Commerce API",
    appState: "문의·주문 판매자 권한 연결 · 2026-09-07 상품·고객 문의 단독30일 읽기 정상",
    overall: "partial",
    consoleVerified: true,
    apiReadPassed: true,
    summary: "2026-09-07 상품 Q&A·고객문의 단독30일 수집 두 작업이 HTTP 200으로 완료됐고 조회 결과는 모두 0건입니다. 고객문의 API의 공식 분류에는 상품·배송·반품·교환·환불·기타가 포함되므로 이 범위의 클레임은 이미 고객문의 계보로 수집합니다. 상품 리뷰와 톡톡은 현재 Commerce API 문의 범위와 별도이며 공개 조회·답변 API가 없어 완료 범위에 넣지 않습니다. 실제 문의·답변 왕복과 전체 과거 답변 복구 완료는 별도로 검증합니다.",
    checks: [
      { label: "판매자 세션", state: "verified", evidence: "Couplet Seoul 통합매니저 스마트스토어센터 로그인 확인" },
      { label: "API센터 세션", state: "verified", evidence: "개발업체 커플릿 계정으로 Commerce API센터 로그인" },
      { label: "API 권한 그룹", state: "verified", evidence: "문의 · 주문 판매자 · 상품/N배송 · 판매자정보 저장 확인" },
      { label: "인증 서명", state: "verified", evidence: "client_id_timestamp bcrypt → Base64" },
      { label: "토큰 정책", state: "verified", evidence: "내 스토어 앱 SELF / 솔루션 SELLER + account_id · 10,800초 토큰 · GW.AUTHN 1회 재발급" },
      { label: "주문 체크포인트", state: "verified", evidence: "moreFrom/moreSequence · 1~3분 폴링" },
      { label: "판매자센터 대조", state: "partial", evidence: "2026-09-07 고객문의 전체 상태·유형 06/07~09/07 조회 0건 · 상품문의 화면 기간은 미확정" },
      { label: "현재 읽기 진단", state: "verified", evidence: "Commerce API 판매자 계정 읽기 정상" },
      { label: "주문 API 권한", state: "verified", evidence: "2026-08-20 orders.list 최근 변경 주문 조회 HTTP 200" },
      { label: "상품 Q&A API", state: "verified", evidence: "필수 기간 인자를 적용한 /v1/contents/qnas 운영 호출 정상 완료" },
      { label: "구매자 고객문의 API", state: "verified", evidence: "2026-09-07 04:13 KST 단독30일 백필 고객·상품문의 각각 HTTP 200 · totalElements 0 · 2작업 완료" },
      { label: "고객문의 클레임 분류", state: "verified", evidence: "공식 고객문의 구조체의 상품·배송·반품·교환·환불·기타 분류를 같은 inquiryNo 계보로 보존" },
      { label: "상품 리뷰·톡톡", state: "blocked", evidence: "현재 Commerce API 문의 목차에는 상품 문의·고객 문의만 있고 리뷰·톡톡 전용 조회·답변 계약 없음" },
    ],
    blockers: ["실제 고객 문의·답변 왕복 및 재문의 검증", "공급자 제공 범위 내 과거 답변·첨부 이력 대조", "상품 리뷰·톡톡은 공개 공식 API 부재"],
    nextAction: "단독30일 수집 2/2 성공 유지 → 실제 문의 생성 시 원문·답변 반영 대조 → 주기수집 관측",
    officialDocs: [
      { label: "상품 문의 목록", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current/get-comments-contents" },
      { label: "상품 문의 답변", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current/create-or-update-answer-contents" },
      { label: "고객 문의 목록", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current/get-customer-inquiry-pay-user" },
      { label: "고객 문의 답변", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current/insert-inquiry-answer-pay-merchant" },
      { label: "고객 문의 구조체", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/%EA%B3%A0%EA%B0%9D-%EB%AC%B8%EC%9D%98-%EB%82%B4%EC%9A%A9-%EA%B5%AC%EC%A1%B0%EC%B2%B4" },
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
    summary: "eBay Seller Hub에서 주문 0건과 활성 리스팅 18개를 대조했고, SellerPilot의 판매자 권한·판매한도 읽기 진단도 정상 통과했습니다. Trading ASQ·Inbox와 Commerce 일반 대화의 수신·1년 복구·대화 답변 계보를 구현했지만, 운영 토큰의 commerce.message 재동의와 원격 전량·실답변 대조가 남아 있어 원격 CS 연결 완료로 표시하지 않습니다.",
    checks: [
      { label: "판매자센터 대조", state: "verified", evidence: "실주문 0 · 활성 리스팅 18 · 메시지 17(대부분 시스템 알림)" },
      { label: "OAuth 동의", state: "verified", evidence: "Production User OAuth 운영 Vault 연결" },
      { label: "토큰 갱신", state: "verified", evidence: "Refresh Token 기반 실행 전 갱신 + Vercel maintenance 보정" },
      { label: "판매자 진단", state: "verified", evidence: "GET /sell/account/v1/privilege/" },
      { label: "상품 워크플로", state: "verified", evidence: "Location → Inventory Item → Offer → Publish" },
      { label: "현재 읽기 진단", state: "verified", evidence: "2026-08-20 Seller 계정 권한과 판매한도 읽기 정상" },
      { label: "상품 문의 ASQ", state: "partial", evidence: "Trading API GetMemberMessages·AddMemberMessageRTQ 및 계보 검증 구현 · 실제 문의·답변 왕복 대기" },
      { label: "Trading Inbox", state: "partial", evidence: "25개 header 페이지와 10개 ID별 본문 조회·1년 기간 분할·첨부 보존 구현 · 원격 ID 전량 대조 대기" },
      { label: "Commerce 대화 구현", state: "partial", evidence: "대화 10개·메시지 25개 continuation, 회원/시스템 역할 결속, 최신 고객 세대 답변 구현 · 로컬 계약 검증 완료" },
      { label: "일반 메시지 권한", state: "blocked", evidence: "2026-09-07 04:29 KST Commerce Message API 최소 읽기 HTTP 403 · 현재 운영 토큰에 commerce.message scope 미기록" },
    ],
    blockers: ["Commerce Message API 일반 대화 권한 HTTP 403 해소", "Trading·Commerce 원격 ID 전체 페이지와 내부 원장 대조", "실제 ASQ·일반 대화 수신과 사용자 승인 답변 E2E"],
    nextAction: "commerce.message 권한 재동의 → 현재·1년 복구 작업 실행 → 원격 ID 전량 대조 → 사용자 승인 답변 E2E",
    officialDocs: [{ label: "Commerce Message API", url: "https://developer.ebay.com/develop/api/sell/message_api" }],
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
  const integration = channelIntegrationStatus({
    credentialStatus: metric.credentialStatus,
    credentialLastCheckStatus: metric.credentialLastCheckStatus,
    credentialLastCheckedAt: metric.credentialLastCheckedAt,
  });
  const passed = metric.credentialStatus === "active" && metric.credentialLastCheckStatus === "passed";
  if (passed) {
    const freshness = integration.tone === "stale" ? " · 재확인 필요" : "";
    return {
      state: "verified" as const,
      apiReadPassed: true,
      appState: `운영 DB 실시간 · Vault 키 등록 · API 읽기 진단 통과${freshness} · ${checkedAt}`,
      evidence: `현재 운영 Vault 자격증명의 읽기 진단 통과${freshness} · ${checkedAt}`,
      summary: `현재 운영 DB에서 유효한 자격증명과 API 읽기 진단 통과를 확인했습니다. 읽기 진단 통과는 상품 발행이나 CS 전체 연결과 같지 않습니다.${integration.tone === "stale" ? ` 마지막 검사가 ${integration.ageText}이므로 지금 상태를 다시 확인해야 합니다.` : ""} 마지막 콘솔 스냅샷과 별개인 실시간 운영 근거입니다.`,
      blocker: null,
      nextAction: integration.tone === "stale" ? "읽기 진단 재확인" : "현재 읽기 진단 유지",
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
  credentialLastCheckStatus?: string | null;
  credentialLastCheckedAt?: string | null;
}): string {
  const failed = metric.failedAttemptCount ?? 0;
  if (failed > 0) return `오류 ${failed}`;
  // A stored pass is not a live connection; the freshness helper keeps this
  // label honest when the last real read is days or weeks old.
  return channelIntegrationStatus(metric).short;
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
