# SmartStore CS 시험 증거

- 기준 시각: 2026-09-08 22:05:32 KST
- S0: `S0-20260908-decaba426812a3ba`
- Node: `/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node`
- 민감정보·실고객 원문: 기록하지 않음

## 전용 계약 시험

명령:

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test tests/cs-smartstore-contract.test.ts
```

- 종료코드: 0
- 결과: 5/5 통과
- 검증: questionId/inquiryNo namespace 충돌, 정확히 하나의 productOrderId만 주문 연결, 부모 orderId 미대체, 고객 최신 본문과 판매자 답변 이력 분리, 30일 경계/continuation, cross-kind 답변 ID 및 TalkTalk/review 위장 차단

## 필수 공통 시험

명령:

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test tests/inquiry-sync-contract.test.ts tests/inquiry-reply.test.ts tests/cs-history-channel-db.test.mjs
```

- 종료코드: 1
- 결과: 45개 중 44개 통과, 1개 실패
- SmartStore 관련 시험: 통과
- 실패: `unsupported channels do not invoke provider request`
- 원인 범위: S0 공통 코드가 Elevenst inquiry를 지원하게 된 상태에서 공통 시험은 여전히 `INQUIRY_CHANNEL_UNSUPPORTED`를 기대한다. 실제 결과는 `INQUIRY_PAGE_INVALID:elevenst`다. SmartStore 전용 변경과 무관하며 공통 시험/fixture 정합화가 필요하다.

## SmartStore 인접 공통 시험

명령:

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test tests/channel-pagination.test.ts tests/channel-protocols.test.ts tests/inquiry-maintenance.test.ts tests/reply-verification.test.ts tests/channel-sync-determinism.test.ts
```

- 종료코드: 1
- 결과: 107개 중 106개 통과, 1개 실패
- 실패: 공통 `channel-sync-determinism` fixture가 네이버페이 부모 `orderId=ORDER-1`을 `externalOrderReference`로 기대한다.
- 판정: 이번 전용 변경은 SmartStore 주문 원장의 외부키인 `productOrderId`와 일치하도록 부모 orderId 대체를 차단했으므로 의도된 계약 차이다. `smartstore-001`로 공통 fixture 최소 변경을 요청했다.

## archive/history 인증 경계

명령:

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test tests/cs-archive-route.test.ts tests/cs-history-window-route.test.ts
```

- 종료코드: 0
- 결과: 9/9 통과
- 검증: 관리자 인증 전 DB 접근 차단, 세션 만료 401, 정확한 기간/종류 filter, `no-store`, 잘못된 날짜 거부

## 타입·린트

```sh
PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH ./node_modules/.bin/tsc --noEmit --pretty false
PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH ./node_modules/.bin/eslint lib/channels/smartstore-inquiries.ts lib/channels/smartstore-inquiry-history.ts tests/cs-smartstore-contract.test.ts
```

- 타입검사 종료코드: 0
- 수정 파일 린트 종료코드: 0

## 실제 GET 및 전 기간 분모

명령:

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx /Users/kimchangheemac/dev/sellerpilot-cs-handoff/smartstore/cs-smartstore-first-read-get-only.mjs --history
```

- 종료코드: 0
- 실행 완료: 2026-09-08T10:12:22.459Z
- helper SHA-256: `565abb94b51de3b50fdada3e7b3246fba3e93066dabf54e23cfd9454555283ac`
- 결과: seller account HTTP 200, 상품문의 46/46 창 HTTP 200, 고객문의 46/46 창 HTTP 200, 원격 고유 ID 각각 0, 운영 원장 티켓/메시지/주문연결 각각 0
- mutation: provider 0, 운영 DB 0, 고객답변 0
- 안전: credential은 메모리에서만 복호화했고 token/secret/고객 원문은 출력·저장하지 않았다.

## 통합 후 보완 001 — 배열형 productOrderIdList

- 시각: 2026-09-08 20:22 KST
- 통합본 preimage: `lib/channels/smartstore-inquiry-history.ts`=`3de662f411bbcdf2b9fa0399032140d9caceb6a9753dacf0eaca444869a5f2e0`, `tests/cs-smartstore-contract.test.ts`=`a6fedbad3720e9994a10675b77476693f30a7bb20f30c6d6562c1aef44f01633`
- 수정: `productOrderIdList`가 배열이면 비어 있지 않은지 배열 길이로 판정해 실제 배열 정규화 분기에 도달시켰다.
- 반례: 배열 1개는 exact binding, 배열 복수는 ambiguous 미결속, 빈 배열은 unavailable이며 빈 `productOrderIds` 필드는 출력에서 생략한다.
- 전용 계약 시험: 5/5 통과, 종료코드 0
- 수정 파일 ESLint: 종료코드 0
- TypeScript `--noEmit`: 종료코드 0
- 보완 후 hash: `lib/channels/smartstore-inquiry-history.ts`=`b8219f965d73ec1890190efcebdf689b76125b2deaed97cc42070318e9c1bc31`, `tests/cs-smartstore-contract.test.ts`=`8573463f686452e4b4739f4c0415d5abd80e5076131f75a89e90a38fb2267c8d`

## 재시작 보완 002 — 주문 상태 투영·전체 기간 재개·scope 대조

- 시각: 2026-09-08 21:21 KST
- 범위: 전용 코드/fixture/스크립트만 추가. 공용 DB·UI·route는 proposals로만 요청.

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test tests/cs-smartstore-contract.test.ts tests/cs-smartstore-recovery.test.ts
```

- 종료코드: 0
- 당시 결과: 10/10 통과. 아래 `002-R`에서 malformed 배열·provenance·auth evidence 분·SQL 실행 시험을 추가해 최종 결과를 갱신했다.

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx scripts/cs-smartstore-reconcile-snapshot.mjs
```

- 종료코드: 0
- 당시 결과: v1 익명 live-zero fixture의 46/46 plan, product/customer 0건, 원장/웹 차이 0. 아래 `002-R`에서 v2로 교체했다.
- 제한: 읽기 분모 완료만 의미하며 신규 수신·실답변·TalkTalk·리뷰·배포 완료가 아님

공용 PGlite 집중 시험:

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test tests/cs-history-channel-db.test.mjs
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test tests/cs-history-coverage-db.test.mjs
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test tests/cs-commerce-boundaries-db.test.mjs
```

- 종료코드: 각각 0
- 결과: history/backfill 10/10, coverage ledger 6/6, 주문 결속/credential 무효화/CS commerce mutation 차단 12/12

정적 검증:

```sh
PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH ./node_modules/.bin/eslint lib/channels/cs/smartstore/history-recovery.ts lib/cs/channels/smartstore/order-binding-projection.ts lib/cs/channels/smartstore/reconciliation.ts tests/cs-smartstore-recovery.test.ts scripts/cs-smartstore-reconcile-snapshot.mjs
PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH ./node_modules/.bin/tsc --noEmit --pretty false
```

- ESLint 종료코드: 0
- TypeScript 종료코드: 0
- provider/DB/credential/customer reply mutation: 0

## 리뷰 보정 002-R — malformed 배열·provenance·SQL/PGlite

- 시각: 2026-09-08 22:05 KST
- v1 fixture는 삭제하고 `live-zero-reconciliation-v2.json`으로 교체했다.
- snapshot의 200/401/401은 `snapshot_claim_only`이며 실제 인증 증거가 아니다. 결과는 항상 `authBoundaryVerified=false`, `requiresIndependentAuthEvidence=true`, `operationalReadReconciliationComplete=false`다.
- 인증 경계 증거는 위 `archive/history 인증 경계`의 자동화 route 계약 시험 9/9와, 별도로 기록된 운영 관리자 웹 read다. fixture 결과와 합산하지 않는다. 운영 비로그인·만료 세션 UI를 실제로 재현하지 않았으므로 production UI 401 증거라고 부르지 않는다.
- v2 fixture는 `live-denominator.json` artifact hash, seller account·credential·shop digest, environment와 kind별 정확한 comparison period를 provider/ledger/web에 반복해 provenance를 고정한다.

전용 최종 시험:

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test tests/cs-smartstore-contract.test.ts tests/cs-smartstore-recovery.test.ts
```

- 종료코드: 0
- 결과: 11/11 통과
- 추가 반례: `["10001",null]`, `["10001",""]`, `["10001","10001"]`, non-array 값이 exact로 축소되지 않음; 다른 seller/credential/shop/environment와 evidence 관측시각 불일치가 data reconciliation을 만족하지 못함.

실제 SQL draft 실행:

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test tests/cs-smartstore-common-proposals.test.mjs
```

- 종료코드: 0
- 결과: 2/2 통과
- 003: SQL을 PGlite에 실제 설치하고 shared admin과 seller owner 분리, 상태 5개 집계, malformed exact→`contract_mismatch`, 다른 seller 제외, underlying table 직접 읽기 차단, admin 권한 제거 후 거절을 확인했다.
- 004: 실제 coverage scope 형식의 product/customer를 사용해 한 종류만 완료·다른 seller 완료·running 상태에서는 checkpoint가 이동하지 않고, 같은 credential seller의 두 종류가 completed/reconciled/unprocessed 0일 때만 정확히 한 창 이동함을 확인했다. credential `revoked`와 비관리자도 거절했다.

공용 연결 patch 정적 검증:

```sh
git apply --check docs/cs-parallel/proposals/smartstore/smartstore-003-004-common-integration.patch
```

- 종료코드: 0
- 의미: 현재 통합 preimage에 적용 가능한 patch 형식이라는 뜻이다. 공용 소스 반영, migration 적용, 실제 route 200/401, UI 렌더 증거는 아니다.

v2 snapshot verifier:

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx scripts/cs-smartstore-reconcile-snapshot.mjs
```

- 종료코드: 0
- 결과: `dataReconciliationComplete=true`, `authBoundaryVerified=false`, `operationalReadReconciliationComplete=false`, provider/database writes 0, customer bodies false.
