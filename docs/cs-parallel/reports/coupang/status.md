# 쿠팡 CS 상태

- 갱신 시각: 2026-09-09 KST
- S0 ID: `S0-20260908-decaba426812a3ba`
- 전용 작업폴더: `/Users/kimchangheemac/dev/sellerpilot-cs-coupang`
- 브랜치/포트: `codex/cs-coupang-v1` / `3211`
- 시작 검증: S0 manifest가 이 폴더 1,628파일을 검증한 상태이며 environment file 미복사, scheduler 미기동이다. HEAD는 지정된 `3cb72144e991626fae98a30cf51022d9a1aa6b0b`이다.
- 실제 seller 범위: Chrome `CHANGHEE` 프로필의 `커플릿(Couplit)`, WING 업체코드 마스킹 `A*****472`, 한국 판매자. 앞선 읽기에서 active production credential의 vendor/owner/seller-account 계보와 일치했다.
- 금지 작업 준수: 실고객 답변 0, 운영 provider mutation 0, 운영 DB write 0, commit/push/deploy 0, 상품·재고·주문·배송·환불 mutation 0.

| 게이트 | 상태 | 이번까지의 증거 | 남은 다음 행동 |
|---|---|---|---|
| G1 범위·권한 | 진행 | 운영 production active credential 1개, 미만료, WING과 같은 vendor mask `A*****472`, access/secret/vendor/requested-by 필드와 검증 seller key 존재. 현재 Mac egress hash는 기존 Coupang route와 같지만 그 route들은 모두 만료·release 불일치이고 `inquiries.list` route는 0이다. | exact active credential·worker token·active release·현재 egress에 짧은 수명의 CS read-only route를 별도 승인 후 결속 |
| G2 로컬 | 통과 | 5차 통합본 쿠팡+공통 90/90, skip 0. 008은 실제 PGlite SQL 3/3, patch/preimage 2/2. 007은 stale lineage와 CS projection 비롤백을 보정했고, 009 reader gate는 목록·상세·AI draft·health의 legacy 노출을 차단한다. 007/009+공통 DB 20/20, Lazada+계보 TS 4/4, 쿠팡 전용 MJS 29/29+TS 28/28, ESLint exit 0. | 007/009 공통 order/reader hook은 소유자 검토 전 proposal/PGlite 상태 유지 |
| G3 실제 읽기 | 진행 | WING 최근 30일 상품·콜센터 `전체`, 반품·교환·출고중지, 리뷰가 모두 0. 운영 OpenAPI의 마지막 성공은 동일 active credential/seller 계보에서 2026-08-20~26 상품 `NOANSWER`와 콜센터 `NO_ANSWER`, HTTP 200, 각 0행이다. 상품 `ALL`과 콜센터 네 상태의 8월 28일 마지막 시도는 static egress 차단이었다. | 현재 같은 7일 창의 OpenAPI 8 scope를 각각 fresh GET; 종류별 0/실패 분리 |
| G4 과거·웹 | 진행 | 합성 fixture의 콜센터 ID·주문번호·parent·대화가 격리 PGlite에서 인증 관리자 route JSON까지 일치하고 mismatch는 502. 운영 DB의 Coupang non-demo ticket/message/reply attempt/delivery는 모두 0이나, production verification RPC는 미설치이고 JEONGHUN 운영 웹 세션은 30분 무활동으로 로그아웃돼 인증 웹 대조를 완료하지 못했다. | CS migration·read route 반영 뒤 fresh 원격 결과를 DB에 저장하고 재로그인된 인증 웹과 exact scope/ID 대조 |
| G5 신규 | 진행 | 동일 콜센터 창 재수집은 stable, 배열 역순에서도 동일 inbound key; 새 재문의는 정확히 이벤트 1개만 추가. 상품 늦은 답변도 이벤트 1개만 추가. | 실제 새 문의가 생긴 1회 overlap poll에서 provider→DB→web dedupe 관측 |
| G6 답변 관측 | 진행/외부조건 | 외부 선답변, 재문의, 이관, 늦은 답변을 fixture·격리 DB로 검증. 공통 completion의 원문 acceptance 저장→delivery `provider_accepted`→child enqueue도 합성 DB로 연결했다. NULL kind·seller key, credential/env/owner mismatch는 rollback하며 duplicate ACK/failed readback 후 reply 재전송 0. | 승인된 실티켓·문구가 생기면 상품/콜센터 각각 한 건만 전송하고 동일 대상을 원격 재조회 |
| G7 복구 | 진행 | 30일 5창×8 scope=40 초기 jobs, 7일 이하 경계, 반복 nextToken 중단, same-window replay, continuation 포함 전량 성공 전용 cursor advance를 코드와 격리 DB로 검증. | checkpoint SQL을 통합 migration으로 반영 후 최근 30일을 실제 완주하고 provider 최초 제공일까지 반복 |
| G8 운영 | 외부조건 | 통합 담당은 003 정본과 008 로컬 read migration `20260908145334_cs_coupang_local_read_executor.sql`을 통합했고 통합본 90/90을 보고했다. 운영에는 미적용이며 route=0을 유지한다. 007 order hook과 009 reader gate는 별도 검토를 위한 proposal이다. | 007/009는 공통 owner 검토, 008/CS migration 운영 반영은 별도 승인 필요 |

## 현재 실제 읽기 표

| surface | 기간·상태 | WING 현재 읽기 | 현재 OpenAPI GET | 앞선 운영 근거 | 판정 |
|---|---|---:|---|---|---|
| 상품 문의 | 최근 30일 / 답변여부 전체 | 0 | 현재 미실행 | 2026-08-20~26 `NOANSWER`, HTTP 200, 0행; `ALL` 마지막 시도는 static egress 실패 | 웹 현재 0; API 현재 권한·0건 미확인 |
| 콜센터 문의 | 최근 30일 / 처리상태 전체 | 0 | 현재 미실행 | 2026-08-20~26 `NO_ANSWER`, HTTP 200, 0행; 네 상태 마지막 시도는 static egress 실패 | NONE/ANSWER/NO_ANSWER/TRANSFER 현재 API 미완주 |
| 반품 | 최근 30일 / 반품처리·보상상태 전체 | 0 | 미실행 | 운영 gateway 작업 기록 없음 | WING 전체 0; API 0/실패 미구분 |
| 취소 | 최근 30일 / 출고중지요청 | 요청 0, 최근 2주 완료 0 | 미실행 | 운영 gateway 작업 기록 없음 | WING 현재 0; API 0/실패 미구분 |
| 교환 | 최근 30일 / 교환처리 전체 | 0 | 미실행 | 운영 gateway 작업 기록 없음 | WING 전체 0; API 0/실패 미구분 |
| 리뷰 | 최근 30일 / 전체 별점·판매중 | 0 | 공식 CS API 목록에서 review GET 미확인 | 없음 | WING 읽기/export 잔여 범위 |

WING `문의/리뷰`의 실제 하위 메뉴는 `고객 문의`, `고객센터 문의`, `리뷰 목록`, `리뷰 이벤트 관리`다. 리뷰 목록은 고객 피드백 읽기 잔여 범위이며 리뷰 이벤트 관리는 마케팅 캠페인이므로 CS 수신에 합산하지 않는다.

## 공식 계약 대조

- 상품 문의 GET: `/v5/vendors/{vendorId}/onlineInquiries`, 기간 최대 7일, `ALL/ANSWERED/NOANSWER`, pageSize 최대 50.
- 콜센터 GET: `/v5/vendors/{vendorId}/callCenterInquiries`, 기간 최대 7일, `NONE/ANSWER/NO_ANSWER/TRANSFER`, pageSize 최대 30.
- 콜센터 단건 GET: `/v5/vendors/callCenterInquiries/{inquiryId}`. 채널 전용 readback이 이 vendor-bound 서명 경로를 사용한다.
- 콜센터 답변은 조회한 `inquiryId`와 `answerId`를 `parentAnswerId`로 보내야 하고, 중복 답변은 provider 오류다. 코드와 DB trigger는 모호한 parent를 보내지 않고 ACK가 반복돼도 readback child만 하나 유지한다.
- 반품/취소 목록과 교환 목록은 읽기만 다루며 승인·확인·거부·송장 API는 범위 밖이다. 교환 `nextToken`이 현재 token과 같으면 continuation을 만들지 않는다.

공식 근거: `https://developers.coupang.com/en/api/cs/customer-inquiry-query-by-product`, `https://developers.coupang.com/en/api/cs/query-of-coupang-contact-center-inquiries`, `https://developers.coupang.com/en/api/cs/query-of-coupang-contact-center-single-inquiry`, `https://developers.coupang.com/en/api/cs/answer-to-inquiries-via-coupang-contact-center`, `https://developers.coupang.com/ko/api/returns/return-cancellation-request-list-query`, `https://developers.coupang.com/ko/api/exchanges/query-a-list-of-exchange-requests`.

## 로컬로 완료한 경로

- 콜센터 목록/단건 readback, 최신 inbound와 유일 actionable parent 선택, seller 선답변·종료·stale/undated/multiple parent fail-closed.
- 상품·콜센터 history seller event의 정확한 원격 ID·본문 fingerprint·provider parent 관측; 현재 ticket parent를 과거 seller event에 상속하지 않음.
- 반품/취소/교환 분리, 교환 continuation/repeated-token 중단, 클레임 주소·전화번호 저장 제외.
- 30일 고정 복구 batch와 complete-only checkpoint. 실패·중단은 같은 종료일을 재생한다.
- provider acceptance 뒤 같은 credential의 콜센터 detail child 1개를 만드는 atomic SQL 초안. 공통 completion이 저장한 `steps[0].data.sellerpilotReplyAcceptance`가 delivery update와 trigger까지 보존됨을 합성 DB로 검증했다. NULL kind·source/ticket NULL seller key·credential/env/owner mismatch는 rollback하고 중복 ACK와 failed child는 reply를 재생성하지 않는다.
- exact credential의 fixture→격리 DB→인증 관리자 route. 응답은 필요한 ID/역할/본문만 내보내고 전화·주소·secret은 배제한다.
- 인증 route는 RPC 응답 scope와 요청의 credential/kind/from/to가 정확히 일치하고 counts/ticket prefix가 내부적으로 일관될 때만 200을 반환한다.
- 답변 원격 관측 DB: exact inquiry/parent/body만 `remote_observed`; 다른 credential의 동일 주문번호, 오래된 세대의 늦은 echo, 복수 후보는 새 문의를 잘못 닫지 않는다.

## 확인된 공통 경계

현재 공통 `commerce_orders`는 `(owner_id, channel_key, external_order_id)`만 identity로 사용하고 order row에 credential/vendor seller key가 없다. 따라서 같은 owner 아래 다른 쿠팡 vendor의 동일 주문번호를 order-side에서 증명할 수 없다. proposal `coupang-007` 보충본은 운영에서 관측한 Lazada→Shopee→기존 upsert 함수 해시를 고정하고 그 전체 체인을 먼저 호출한 뒤 exact provider-certified Coupang lineage만 기록한다. unverified/expired/storage-failure와 쿠팡 CS projection 실패는 주문 ingest를 롤백하지 않는다. 현재 order 갱신보다 오래된 lineage는 exact가 아니며, vendor B 최신 upsert 뒤 B ledger 저장 실패 시 과거 A evidence도 stale로 차단된다. 설치 시 기존 CS link를 일괄 지우지 않고 영향 수를 보존하며, 같은 exact provider read가 touch한 ticket만 재검증한다. 비쿠팡 exact 판정은 해시를 고정한 정본 predecessor 호출 그대로다.

그 보존 때문에 생기는 legacy 물리 link 노출은 proposal `coupang-009`가 목록·상세·AI 답변 초안·order binding health에서 fail-closed 처리한다. 저장된 link를 일괄 삭제하지 않고 007 exact 판정을 읽을 때마다 적용하며, 새 exact provider read 뒤에만 다시 노출한다. 같은 격리 DB에서 007/009+공통 20/20, Lazada+계보 TS 4/4가 통과했지만 두 제안 모두 공통 owner 검토 전 integration은 보류다.

운영 DB live read에서 `coupang:inquiries.list`는 local executor access가 없고 serverless fixed egress도 꺼져 있다. 별도 provider harness를 복제하지 않고 기존 gateway worker를 재사용하는 proposal `coupang-008`을 제출했다. 이 제안은 JS/DB에서 해당 tuple만 `read`로 추가하며 route row·job·credential·운영 상태를 만들지 않는다.

전용 폴더의 공통 `inquiry-sync-contract` 시험 1건은 11번가 오류 문자열의 오래된 기대값 때문에 실패했다. 동일 시험은 현재 통합 기준 폴더에서 24/24 통과했다. 이 채널은 공통 11번가 파일을 수정하거나 복사하지 않았다.

## 완료 판정

- 핵심 문의 완료: **아님**. 상품/콜센터의 현재 OpenAPI GET, 실제 신규 poll, 승인 답변의 원격 재조회가 없다.
- 쿠팡 전체 완료: **아님**. 반품/취소/교환 실제 조회, 콜센터 네 상태 전체, provider 최초 제공일까지의 실제 과거 수집, 리뷰 보존/export, 실제 DB·공통 화면 대조가 남았다.
- 로컬 구현 완료: **예, 전용 범위 기준**. 허용된 채널 파일·전용 경로와 proposal에서 진행 가능한 구현 및 반례 시험은 완료했다.
- 가장 먼저 필요한 한 행동: 별도 승인을 받아 proposal 008과 CS migration을 통합한 뒤, active credential·active release·현재 Mac egress에 짧은 `coupang + inquiries.list` route를 만들고 같은 7일 창의 상품 ALL과 콜센터 NONE부터 fresh GET한다.

세부 명령과 종료값은 `logs/20260909-supplement-8-reader-gate.md`, 후속 파일 해시는 `delta-supplement-8.json`, 공통 요청은 `003`~`009`에 있다.
