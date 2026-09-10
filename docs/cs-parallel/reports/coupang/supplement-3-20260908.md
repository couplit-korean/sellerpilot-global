# 쿠팡 CS 3차 보완 결과

- 시각: 2026-09-08 22:35 KST
- S0 ID: `S0-20260908-decaba426812a3ba`
- 기준: 2차 delta 21파일은 통합 담당이 before/after와 ownership을 확인해 통합본에 복사했고, 통합본에서 쿠팡 전용+공통 회귀 74/74 및 전체 TypeScript 검사를 통과했다.
- 이번 범위: RPC 응답 scope/count 결속과 다른 vendor 동일 주문번호를 막는 실행 가능한 private order-lineage proposal.

## 인증 route 결속

- schema 자체가 `displayedTickets === tickets.length`, `totalTickets >= displayedTickets`, 모든 external ticket prefix가 응답 kind와 같음을 요구한다.
- route는 응답 `credentialId/kind/fromDate/toDate`가 요청과 정확히 같고 displayed 수가 요청 limit 이하여야 200을 반환한다.
- 다른 credential, kind, from/to, count, ticket prefix를 각각 주입한 7개 반례는 모두 502이며 표시되지 않는다.

## 주문 credential/vendor 계보

- `patches/007-coupang-order-lineage.sql`은 private RLS ledger, exact recorder, candidate, validator, reconcile trigger를 제공한다.
- recorder는 order upsert와 같은 트랜잭션에서 exact credential/order/external ID 한 건을 기록하도록 설계했고 API 역할 실행권이 없다.
- credential ID가 회전해도 검증 seller key가 같으면 exact이다.
- 같은 owner의 다른 vendor seller key가 같은 external order ID에 관측되면 관련 ticket 모두 `cross_vendor_collision`, `order_id=null`이다.
- 기존 주문은 추정 backfill하지 않고 `legacy_unknown`으로 연결을 해제한다. 주문 row/status는 변경하지 않는다.
- common order ingest 함수에는 `RETURNING order_id` 뒤 private recorder 한 줄을 추가하는 정확한 hook patch를 별도 제출했다. 공통 파일은 직접 수정하지 않았다.

## 검증

- route mismatch/count 시험 포함 `tests/cs-coupang-db-web.test.ts`: 4/4.
- `tests/cs-coupang-order-lineage-db.test.mjs`: 최종 4/4. 최초 0/4는 PGlite에 pgcrypto binary가 없는 fixture 환경 문제였고 저장소 표준 방식의 합성 `extensions.digest`로 고쳐 proposal SQL 자체는 그대로 검증했다.
- 후속 포함 쿠팡 표적 전체: 46/46.
- TypeScript/ESLint: 모두 exit 0.

## 완료 경계

- 로컬 후속 구현: 완료.
- 공통 runtime/migration 적용: 미완료.
- 운영 DB/order/provider 변경: 0.
- 실제 OpenAPI 읽기·신규 수신·실답변 원격 관측: 미완료 상태 유지.
- 핵심 문의 완료와 쿠팡 전체 완료: 둘 다 아직 아님.
