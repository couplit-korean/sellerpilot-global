export type DevelopmentStatus = "done" | "partial" | "not_started" | "excluded";
export type VerificationStatus = "passed" | "pending" | "external" | "excluded";

export type AcceptanceItem = {
  id: string;
  title: string;
  priority: "필수" | "조건" | "결정" | "후속";
  development: DevelopmentStatus;
  verification: VerificationStatus;
};

export type AcceptanceSection = {
  code: string;
  title: string;
  intent: string;
  pptSlides: string;
  items: AcceptanceItem[];
};

type RawItem = [title: string, priority?: AcceptanceItem["priority"]];

const rawSections: Array<Omit<AcceptanceSection, "items"> & { items: RawItem[] }> = [
  { code: "A", title: "착수 전 범위와 준비", intent: "채널·국가·카테고리·계정·데이터·계약 범위를 확정합니다.", pptSlides: "1, 2, 5, 29, 31", items: [
    ["1차 판매채널을 Qoo10·Lazada로 고정", "결정"], ["1차 판매국가 확정", "결정"], ["무인 운영의 뜻 확정", "결정"], ["자동 등록 허용 카테고리 확정", "결정"], ["규제상품 자동 제외 범위 확정", "결정"], ["실계정과 테스트상품 준비"], ["개발자 앱 권한 확보"], ["카카오 알림톡 준비", "조건"], ["공급사 상품자료 준비"], ["소유권과 유지보수 범위 확정", "결정"],
  ] },
  { code: "B", title: "공통 데이터와 시스템 기반", intent: "채널이 달라도 하나의 상품·재고·주문으로 관리합니다.", pptSlides: "6, 14, 18, 25", items: [
    ["통합 SKU 만들기"], ["상품 사실정보 한곳에 저장"], ["옵션과 세트상품 구조 만들기"], ["채널 상품번호 연결"], ["판매계정 설정화면 만들기"], ["사용자 권한 나누기"], ["모든 변경이력 저장"], ["원본과 결과 이미지 분리 보관"], ["채널 추가용 공통 연결규격 만들기"],
  ] },
  { code: "C", title: "촬영과 이미지 업로드", intent: "현장에서 사진을 찍는 것만으로 등록을 시작합니다.", pptSlides: "3, 4, 7, 15", items: [
    ["휴대폰 촬영·앨범 업로드"], ["정면사진 촬영 안내"], ["라벨사진 촬영 안내"], ["바코드 확대촬영 안내"], ["여러 장 업로드와 순서변경"], ["흐림 자동 감지"], ["반사·노출·잘림 감지"], ["중복사진 감지"], ["오프라인 촬영대기열"], ["처리상태와 재시도 표시"],
  ] },
  { code: "D", title: "상품 찾기와 시장정보", intent: "바코드·OCR·공급사·이미지를 교차 비교합니다.", pptSlides: "11, 15", items: [
    ["바코드 우선 검색"], ["라벨 글자 자동 추출"], ["공급사·기존상품 우선 검색"], ["공식·허용 상품자료 연결", "조건"], ["이미지 유사검색"], ["키워드 보조검색"], ["후보 순위 만들기"], ["판단 근거 저장"], ["신뢰도 기준 적용"], ["애매하면 자동 재촬영"], ["찾지 못하면 자동 제외"], ["시장가격 출처와 시각 저장", "조건"],
  ] },
  { code: "E", title: "판매 가능 여부와 규제 확인", intent: "필수정보와 규제자료가 없으면 게시하지 않습니다.", pptSlides: "12, 24", items: [
    ["국가×카테고리 판매규칙표"], ["금지품목·금지표현 검사"], ["성분·주의문구 대조", "조건"], ["인증서 필요 여부 확인", "조건"], ["원산지·제조사 확인"], ["HS코드 후보 제안", "조건"], ["위험등급 자동 계산"], ["저위험 화이트리스트 자동 통과"], ["중·고위험 자동 차단"], ["규정 시행일과 판정이력 저장"],
  ] },
  { code: "F", title: "썸네일·상세페이지·번역", intent: "사실정보를 잠그고 채널·국가에 맞는 콘텐츠를 생성합니다.", pptSlides: "16, 24", items: [
    ["배경 자동 제거"], ["배경제거 실패 폴백"], ["채널별 이미지 규격 변환"], ["썸네일 템플릿 적용"], ["제품 라벨 변조 검사"], ["워터마크·저작권 검사"], ["사실정보 잠금"], ["상품명 자동 생성"], ["상품설명·불릿 자동 생성"], ["해외형 상세페이지 생성"], ["국가별 번역과 용어집"], ["SEO·금칙어·글자수 최종검사"],
  ] },
  { code: "G", title: "Qoo10·Shopee·Lazada 상품등록 연결", intent: "공식 API로 등록·수정·가격·재고를 처리하고 부분 실패를 복구합니다.", pptSlides: "5, 9, 10, 24", items: [
    ["채널 계정 안전 연결"], ["토큰 자동 갱신"], ["카테고리 자동 동기화"], ["필수속성 사전검사"], ["채널 이미지 업로드"], ["신규 상품 자동 등록"], ["기존 상품 자동 수정"], ["판매중지·품절 처리"], ["가격 자동 변경"], ["재고 자동 변경"], ["옵션·세트상품 등록"], ["호출제한·재시도·중복방지"], ["부분 성공 처리"], ["Qoo10 단계형 QAPI 처리"], ["Shopee 메인계정·8개 숍 OAuth와 국가별 실행", "후속"], ["Lazada 이미지·창고·웹훅 처리"],
  ] },
  { code: "H", title: "가격·마진·정산", intent: "전체 비용과 환율을 반영해 역마진을 차단합니다.", pptSlides: "17, 23, 27", items: [
    ["매입원가와 원가방식", "결정"], ["국내·해외 물류비"], ["포장·부자재·3PL 비용"], ["플랫폼·결제 수수료"], ["세금·관세·원천징수"], ["환율 자동 반영"], ["목표 마진율 조절"], ["채널별 반올림·최소가격"], ["경쟁가와 마진하한 동시 적용"], ["쿠폰·할인 사전 시뮬레이션"], ["번들·자동 리프라이싱"], ["정산 예정액과 실제 입금 대조"],
  ] },
  { code: "I", title: "주문과 공통 재고", intent: "중앙 재고원장을 기준으로 모든 채널을 수렴시킵니다.", pptSlides: "18, 22", items: [
    ["통합 주문함"], ["Lazada 주문 웹훅"], ["Qoo10 주문 주기조회"], ["웹훅 누락 보정조회"], ["주문형식 통일"], ["중복 주문 제거"], ["주문상태 이력"], ["주문상품과 내부 SKU 연결"], ["중앙 재고원장"], ["주문 즉시 재고 예약"], ["한 번에 차감하고 전파예약"], ["전 채널 재고 갱신"], ["안전재고·임계치·자동품절"], ["세트 구성품 연동차감"], ["재고 대조와 동시주문 검증"],
  ] },
  { code: "J", title: "카카오톡과 운영 알림", intent: "주문·재고·장애 이벤트만 승인된 알림톡으로 전달합니다.", pptSlides: "9, 18", items: [
    ["신규 주문 알림"], ["시간별 주문 요약"], ["재고부족·품절 알림"], ["등록·가격·재고 실패 알림"], ["출고지연 알림"], ["토큰·API·마진 위험 알림"], ["알림톡 템플릿과 대체수단", "조건"],
  ] },
  { code: "K", title: "매입·포장·배송", intent: "사람이 하는 물리 작업의 누락과 지연을 시스템이 막습니다.", pptSlides: "4, 20", items: [
    ["주문별 매입목록"], ["모바일 포장 체크리스트"], ["송장 일괄조회·PDF 출력"], ["채널별 발송방법 관리"], ["발송처리 채널 반영"], ["배송상태 통합조회"], ["발송기한·배송지연 경고"], ["3PL 연결규격 선설계", "후속"],
  ] },
  { code: "L", title: "고객문의와 CS", intent: "문의 범위를 구분하고 안전한 질문만 다국어 자동 응답합니다.", pptSlides: "19", items: [
    ["채널별 문의 수집범위 표시", "조건"], ["통합 문의함", "조건"], ["FAQ·과거답변 검색"], ["다국어 답변 생성"], ["답변 신뢰도 판정"], ["안전한 FAQ 자동발송"], ["환불·분쟁·보상 보호"], ["답변 학습과 음성상담 분리", "후속"],
  ] },
  { code: "M", title: "앱을 꺼도 돌아가는 자동작업", intent: "서버가 24시간 주문·재고·환율·정책을 감시합니다.", pptSlides: "21", items: [
    ["주문 웹훅 상시수신"], ["주문 폴링 스케줄러"], ["재고 불일치 자동점검"], ["배송·CS 마감점검"], ["환율·마진 일일 재계산"], ["경쟁가격 주기 갱신", "조건"], ["개발자 공지 전용메일 수집"], ["수수료·API·규제 변경 감지"], ["워치독과 중복실행 방지"], ["실패대기열·작업현황·일일보고"],
  ] },
  { code: "N", title: "웹·모바일 운영화면", intent: "비개발자가 진행상태와 채널 운영상태를 이해하고 처리합니다.", pptSlides: "3, 7, 14", items: [
    ["새 상품 촬영·업로드 화면"], ["상품 후보 확인화면"], ["썸네일·상세·번역 미리보기"], ["가격·마진 화면"], ["채널연결·등록현황 화면"], ["주문·재고 화면"], ["알림·CS·매출·정산 화면"], ["모바일 PWA 우선·윈도우앱 후순위", "결정"],
  ] },
  { code: "O", title: "보안·서버·운영 안정성", intent: "인증정보와 주문 개인정보를 보호하고 장애를 복구합니다.", pptSlides: "6, 21, 25, 30", items: [
    ["고정 공인 IP 작업서버"], ["PostgreSQL 중앙DB와 접근차단"], ["API 키·토큰 암호화"], ["웹훅 서명·재전송 방지"], ["개인정보 분리·마스킹·보존기간"], ["로그인·역할권한·MFA"], ["백업과 실제 복구시험"], ["로그·메트릭·추적·장애알림"], ["오픈소스·모델 라이선스 관리"], ["개발·검수·운영환경 분리"],
  ] },
  { code: "P", title: "테스트·검수·인수인계", intent: "실계정·실상품·장애 상황까지 증거로 검수합니다.", pptSlides: "2, 25, 28, 30, 31", items: [
    ["정식 Excel과 항목 연결"], ["기존 코드·인증정보 선점검"], ["Qoo10·Shopee·Lazada API PoC 선검증"], ["실제 E2E 상품흐름 검수"], ["오류·중복·호출제한 검수"], ["10,000건 동시주문 시뮬레이션"], ["24시간 채널장애 복구시험"], ["이미지·OCR 품질검수"], ["상품매칭 정답 500건 검수"], ["가격·마진 자동시험"], ["30~100개 SKU 제한운영"], ["문서·소스·계정·교육 인수"],
  ] },
  { code: "Q", title: "추후 확장 항목", intent: "코어 안정화 뒤 동일 연결규격으로 국내외 채널을 확장합니다.", pptSlides: "5, 20, 27, 28", items: [
    ["네이버 스마트스토어 연결", "후속"], ["쿠팡 연결", "후속"], ["11번가 연결", "후속"], ["국내형 콘텐츠·별도 앱", "후속"], ["3PL·AI 음성상담", "후속"], ["eBay 등 확장·광고 고도화", "후속"],
  ] },
];

// 화면·계산·AI 초안 등 현재 코드에서 확인되는 항목입니다. 실제 채널 데이터가
// 연결되지 않았으므로 완료(done)가 아니라 부분 구현(partial)로만 분류합니다.
const partialDevelopmentIds = new Set([
  "B-01", "B-02", "B-04", "B-05", "B-06", "B-08", "B-09",
  "C-01", "C-02", "C-03", "C-04", "C-05", "C-10",
  "D-02", "D-05", "D-06", "D-08",
  "E-02", "E-03", "E-05",
  "F-01", "F-03", "F-04", "F-07", "F-08", "F-09", "F-10", "F-12",
  "G-03", "G-04", "G-05", "G-06", "G-07", "G-08", "G-09", "G-10", "G-11", "G-12", "G-13", "G-14", "G-15", "G-16",
  "H-01", "H-02", "H-03", "H-04", "H-05", "H-06", "H-07", "H-08", "H-09", "H-10", "H-12",
  "I-01", "I-05", "I-07", "I-08", "I-09", "I-13",
  "J-01", "J-02", "J-03", "J-04", "J-05", "J-06",
  "K-01", "K-04", "K-06", "K-07",
  "L-01", "L-02", "L-03", "L-04", "L-05", "L-06", "L-07",
  "N-01", "N-02", "N-03", "N-04", "N-05", "N-06", "N-07", "N-08",
  "O-09", "O-10", "P-01", "P-02", "Q-01", "Q-02", "Q-03", "Q-06",
]);

const doneDevelopmentIds = new Set([
  "A-01",
  "B-01", "B-02", "B-04", "B-05", "B-07", "B-08", "B-09",
  "C-01", "C-02", "C-03", "C-04", "C-10",
  "F-03", "F-04", "F-07", "F-08", "F-09", "F-10",
  "G-01", "G-02",
  "H-02", "H-03", "H-04", "H-06", "H-07", "H-08", "H-09", "H-10",
  "I-01", "I-05", "I-06", "I-07", "I-08", "I-09", "I-13",
  "L-02", "L-04",
  "M-09", "M-10",
  "N-01", "N-02", "N-03", "N-04", "N-05", "N-06", "N-07",
  "O-02", "O-03", "P-01", "P-02", "P-05", "P-10",
]);

const excludedIds = new Set<string>();

// 사용자 결정, 판매자 계정, 공식 API 권한, 법무·규제 데이터 또는 외부 서비스
// 승인이 없으면 실검수를 시작할 수 없는 항목입니다.
const externalVerificationIds = new Set([
  "A-01", "A-02", "A-03", "A-04", "A-05", "A-08", "A-09", "A-10",
  "D-04", "D-12", "E-03", "E-04", "E-06",
  ...Array.from({ length: 16 }, (_, index) => `G-${String(index + 1).padStart(2, "0")}`),
  "H-01", "H-04", "H-05", "H-06", "H-12",
  "I-02", "I-03", "I-04", "I-12", "J-07", "K-03", "K-04", "K-05", "K-06",
  "L-01", "L-02", "M-01", "M-02", "M-06", "M-07", "M-08",
  "O-01", "O-02", "O-06", "O-07", "P-03", "P-04", "P-07", "P-09", "P-11",
  "Q-01", "Q-02", "Q-03", "Q-05", "Q-06",
]);

export const acceptanceSections: AcceptanceSection[] = rawSections.map((section) => ({
  ...section,
  items: section.items.map(([title, priority = "필수"], index) => {
    const id = `${section.code}-${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      title,
      priority,
      development: excludedIds.has(id) ? "excluded" : doneDevelopmentIds.has(id) ? "done" : partialDevelopmentIds.has(id) ? "partial" : "not_started",
      verification: excludedIds.has(id) ? "excluded" : externalVerificationIds.has(id) ? "external" : "pending",
    };
  }),
}));

export const acceptanceItems = acceptanceSections.flatMap((section) => section.items);

export const acceptanceSummary = {
  total: acceptanceItems.length,
  development: {
    done: acceptanceItems.filter((item) => item.development === "done").length,
    partial: acceptanceItems.filter((item) => item.development === "partial").length,
    notStarted: acceptanceItems.filter((item) => item.development === "not_started").length,
    excluded: acceptanceItems.filter((item) => item.development === "excluded").length,
  },
  verification: {
    passed: acceptanceItems.filter((item) => item.verification === "passed").length,
    pending: acceptanceItems.filter((item) => item.verification === "pending").length,
    external: acceptanceItems.filter((item) => item.verification === "external").length,
    excluded: acceptanceItems.filter((item) => item.verification === "excluded").length,
  },
};
