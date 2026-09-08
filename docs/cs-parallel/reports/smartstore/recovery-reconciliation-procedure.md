# SmartStore 과거 복구·대조 실행 절차

## 목적과 판정 경계

이 절차는 상품문의와 네이버페이 고객문의의 기간 창, 원격 ID digest, 로컬/운영 원장 digest, 판매자센터 웹 digest를 같은 판매자·credential·shop·environment와 정확한 비교 기간으로 묶는다. 고객 본문·답변·원격 ID 원문·credential·token은 입력하지 않는다.

`dataReconciliationComplete=true`는 익명화 snapshot 안에서 지정한 읽기 분모가 맞다는 뜻이다. snapshot의 `200/401/401` 값은 주장일 뿐 인증 증거가 아니므로 `authBoundaryVerified=false`, `operationalReadReconciliationComplete=false`를 고정한다. 신규 실문의 수신, 실제 답변 전송, provider 답변 readback, TalkTalk·리뷰 연결 또는 운영 배포 완료를 뜻하지 않는다.

## 익명 기준 fixture 실행

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx scripts/cs-smartstore-reconcile-snapshot.mjs
```

기본 입력은 `tests/fixtures/cs/smartstore/live-zero-reconciliation-v2.json`이다. `sourceEvidence.artifactSha256`가 `live-denominator.json`의 SHA-256과 일치하고, seller account·credential·shop digest가 provider/ledger/web 각 kind에서 반복되는 2026-09-08 read-only 관측을 재현한다. 예상 결과:

- `history.planMatches=true`, `complete=true`
- product/customer `successfulWindowCount=46`, unique/duplicate/missing/only 모두 0
- snapshot 주장 administrator 200, anonymous 401, expired session 401; `authBoundaryVerified=false`
- `dataReconciliationComplete=true`, `operationalReadReconciliationComplete=false`
- provider/database writes 0, customer bodies false

## 중단 재개 검증

`buildSmartstoreHistoryWindows(floorDate, throughDate)`는 최신 창부터 과거로 30일 이하의 포함 구간을 만든다. `resumeSmartstoreHistoryWindows(windows, completedWindowKeys)`에는 DB history coverage에서 같은 seller/credential/environment의 product/customer 두 scan이 모두 completed/reconciled인 window key만 전달한다.

- 완료 key 중복: `duplicateCompletionCount`에만 반영하고 재실행하지 않는다.
- 알 수 없는 key: fail-closed.
- failed: 기존 backfill retry fence에서만 재개.
- cancelled, `reconciliation_required`, retry exhausted: 자동 재전송 금지.
- 다음 창이 `null`: 계획상 전 창 완료. provider/DB/web 대조는 별도 verifier로 다시 확인한다.

## 0건이 아닌 실제 관측 입력

실제 ID는 SHA-256 digest로 바꾼 임시 snapshot을 `/Users/kimchangheemac/dev/sellerpilot-cs-handoff/smartstore/` 아래에 만들고 Git에는 넣지 않는다. `scope`과 provider/ledger/web 각 row에는 동일한 seller account·credential·shop digest와 environment를 넣는다. provider, ledger, web의 `comparisonFromDate/comparisonThroughDate`도 kind별로 정확히 같게 맞춘다. `sourceEvidence`는 이 관측을 만든 body-free 증거 artifact의 SHA-256과 관측 시각을 기록한다.

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx scripts/cs-smartstore-reconcile-snapshot.mjs /absolute/path/to/safe-snapshot.json
```

verifier는 다음을 별도 집계한다.

- provider observation/unique/duplicate
- ledger observation/unique/duplicate
- web observation/unique/duplicate
- provider 대비 원장 누락과 원장 단독
- provider 대비 웹 누락과 웹 단독
- history 계획 hash/완료 수/실패 수/중복 완료 수
- snapshot에 기록된 관리자/비로그인/만료세션 HTTP 주장(실제 인증 증거와 별도)

원장이나 웹에 누락·단독·중복이 있거나 판매자/credential/shop/environment/기간이 다르면 `dataReconciliationComplete=false`다. 원격 ID 원문, 고객 본문 또는 secret 이름이 들어간 snapshot은 verifier가 거부한다. 인증 경계는 자동화 route 계약 시험과 운영 브라우저 관측을 서로 분리한다. 이번 증거에는 운영 관리자 화면 read는 있지만 운영 비로그인·만료 세션 UI 재현은 없으므로 실제 UI auth boundary 완료로 판정하지 않는다.

## 주문 연결 상태 UI 입력

`projectSmartstoreOrderBinding()`에는 ticket의 `providerContext`, `externalOrderReference`, 공용 binding ledger의 `status`만 넣는다. 배열 원소를 제거하거나 압축하지 않으므로 `["10001",null]`, `["10001",""]`, 중복 2개는 exact로 축소되지 않고 `contract_mismatch`가 된다. 출력은 ID 없는 상태와 count만 사용한다.

- exact: 자동 주문 읽기 연결 가능
- unmatched: 같은 owner/channel/credential에서 상품주문 미발견
- unverified_credential: credential 소유자/채널 미검증
- not_applicable: 상품문의 또는 주문 참조 없는 고객문의
- ambiguous_product_orders: 복수 또는 중복 상품주문으로 수동 확인 필요
- invalid_product_order_list: 형식 오류/충돌
- contract_mismatch: 정규화와 ledger가 서로 모순

모든 상태에서 `csCommerceMutationAllowed=false`다.

## SQL proposal 실행 검증

- `smartstore-003-order-binding-health-v2.sql`: 활성 SmartStore credential에서 판매자 owner를 결정하고, shared admin의 `auth.uid()`와 판매자 owner를 혼동하지 않은 채 상태 count만 반환한다.
- `smartstore-004-next-history-window-v1.sql`: 실제 coverage scope인 `inquiries:history:<run UUID>:smartstore:<kind>:<from>:<to>`를 정확히 인식하며, 같은 owner/credential/environment의 product와 customer가 모두 completed/reconciled이고 `unprocessed_count=0`일 때만 다음 창으로 이동한다.
- `tests/cs-smartstore-common-proposals.test.mjs`가 두 SQL을 PGlite에 실제 설치해 malformed ID, shared admin, 다른 seller, credential revoked, 한 종류만 완료, 두 종류 완료를 검증한다.
- `smartstore-003-004-common-integration.patch`는 공용 원본을 수정하지 않은 검토용 패치다. `git apply --check`만 통과했으며 배포·migration 적용 증거가 아니다.

## 제외 범위

- TalkTalk와 리뷰는 이 fixture/parser에 넣지 않는다.
- 리뷰 판매자센터 export의 실제 header/version을 확보하기 전 parser를 만들지 않는다.
- TalkTalk 현행 공식 계약/자격이 확인되기 전 customer inquiry로 변환하지 않는다.
- 이 절차는 commit, push, deploy, 운영 DB/credential 변경, 주문·배송·환불 mutation, 실고객 답변을 실행하지 않는다.
