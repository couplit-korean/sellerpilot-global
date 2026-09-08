# 공통 변경 요청 coupang-002

- 목적: 쿠팡 5종 읽기를 현재 활성 credential과 고정 출구에 결속하고, 30일 이후 과거 창·종류별 0건/실패·공통 웹 필터를 실제 운영 경로로 완성한다.
- 요청 채널: coupang
- S0 ID / 현재 인터페이스 버전: `S0-20260908-decaba426812a3ba`
- 수정할 공통 파일과 함수: `lib/channels/sync-arguments.ts`, 공통 gateway/claim route와 local executor route 등록, `app/cs/history-window.tsx`, 통합 담당이 배정할 migration
- 현재 파일 SHA-256: sync arguments `17a7670bc5ed8ca6237c412aa80a30b36af337585d3a34f22cb540735424a7a2`; history UI `b58adcbb4ca8fc6757d830143939fb0ffc514fd37056c6f24442f1adf8ee7f04`; 후보 SQL 08047000 `1405c48b7e9c21cb1dd2eb07fdbd83366f3189e6c6b7226ab6c14a7ee12e5c6d`; 08047100 `2b76dcbce16f92b0d46e1e0c2919780479fb282e80893d66149f164e71bd5b78`
- DB 객체: `sellerpilot_start_inquiry_history_backfill_v4` 계열, scope health, gateway route/worker heartbeat, support ticket/inbound ledger. 실제 migration 번호는 통합 담당 배정.
- 기존 동작: 로컬은 최근 30일 5개 창 × 8종 40개를 만든다. 운영 DB에는 08047000/08047100이 미적용이고 쿠팡 CS local executor route가 없다. 기존 운영 성공 읽기는 2026-08-22~26 상품 `ALL`, 콜센터 `NO_ANSWER`뿐이며 모두 원격 행 0이다. 반품/취소/교환 작업 기록은 없다.
- 문제를 재현하는 최소 입력: 활성 쿠팡 credential로 history 30일을 요청해도 static/local CS egress와 worker freshness를 만족하지 못하면 실제 40개 scope를 완료할 수 없다.
- 원하는 동작: seller/vendor/credential incarnation/egress hash를 한 실행에 고정하고 30일 batch가 성공한 후 endDate를 하루 전으로 이동한다. 각 batch는 상품 ALL, 콜센터 NONE/ANSWER/NO_ANSWER/TRANSFER, 반품, 취소, 교환을 별도 분모로 저장한다. provider 최소 제공일까지 반복하되 문서화되지 않은 최초일은 실제 빈 창과 export 가능 범위로 확정한다.
- 전용 모듈 경로와 export: 기존 `executeCoupangInquiry`; 새 `call-center-detail` readback; `normalizeCoupangInquiries`
- 기존/새 입력·출력 계약: 현재 30일 RPC를 유지하고 `historyEndDate`를 원자 cursor로 저장한다. 종류별 provider row/unique ID/duplicate/quarantine/excluded/gap과 total unknown을 분리해 반환한다.
- 최소 변경안: 쿠팡 `inquiries.list`만 허용하는 fresh worker route 추가, 후보 두 migration을 preimage 검증 후 통합 migration으로 반영, 공통 웹에 channel=coupang + kind + status + fixed from/to 필터와 coverage 표시 추가.
- 다른 채널 영향: 쿠팡 route와 scope만 enable; 공용 UI 필터는 기존 채널 기본값을 바꾸지 않는다.
- 상품/주문/배송 mutation 영향: 없음. CS worker claim allowlist에서 listing/order/shipment operation을 명시적으로 제외한다.
- 재현·회귀 시험 명령: `node --import tsx --test tests/coupang-after-sales.test.ts tests/cs-history-channel-db.test.mjs tests/cs-coupang-contact-center.test.ts`
- migration 선행/preimage/ACL 요구: 운영 적용 전 08047000/08047100 후보의 delegate preimage, RLS/execute grant, 재실행 안전성, rollback을 통합 worktree에서 재검증한다.
- 우선순위: 첫 실제 읽기/웹 차단 / 과거누락
- 통합 담당 처리 상태: 미반영
- 반영된 통합 소스 hash와 검증: 없음

