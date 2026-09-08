# 쿠팡 CS 7차 보완: 주문 provenance 비간섭·정본 보존

- 시각: 2026-09-09 KST
- S0: `S0-20260908-decaba426812a3ba`
- 범위: proposal `coupang-007`과 격리 PGlite만 수정/실행
- 운영 변경: DB/provider/credential/order/reply/route/job mutation 0
- 금지 범위: 상품 등록·재고·주문 상태 변경·송장·취소·반품·교환 승인 코드 수정/실행 0

## 결과

구형 007은 실제 주문 함수 없이 `... existing assignments unchanged ...`만 제시했고, 설치 즉시 모든 기존 쿠팡 CS order link를 일괄 해제했으며, unverified credential recorder 예외가 주문 수집까지 롤백할 수 있었다. 보충본은 이를 다음처럼 교체했다.

- 운영에서 read-only로 관측한 최신 public/Lazada/Shopee/Temu wrapper와 정본 common exact/reconcile 함수의 `md5(prosrc)`를 첫 DDL 전에 고정한다.
- 최신 `public.sellerpilot_service_ingest_orders`를 predecessor로 rename하고 전체 기존 체인을 먼저 호출하는 완전한 함수 정의를 제공한다.
- 기존 체인의 반환값·필드·status·오류를 보존하고, 쿠팡 성공 주문에 대해서만 provenance를 best-effort로 기록한다.
- incarnation, 만료, 저장 장애는 주문 수집을 롤백하지 않는다. ledger는 0이고 CS는 `unverified_credential` 또는 `legacy_unknown`, exact false다.
- 비쿠팡 exact는 본문 해시가 고정된 정본 predecessor를 그대로 호출한다. ticket/order trigger도 비쿠팡은 정본 common reconciler를 그대로 호출한다.
- 설치 시 `support_tickets`/`cs_order_bindings` 일괄 `UPDATE`가 없다. 기존 수·link를 보존해 영향 집계를 먼저 하고 exact provider read로 touch한 owner/order reference만 재연결한다.
- reader gate 없이 legacy link가 화면에 노출될 수 있으므로 common owner의 gate 승인 전 007 운영 배포를 금지했다.

## 실증

| 항목 | 결과 |
|---|---|
| 007 최신-chain PGlite | 5/5, skip 0, exit 0 |
| 공통 CS boundary + 007 | 17/17, skip 0, exit 0 |
| Lazada durable wrapper + 전용 TS | 4/4, skip 0, exit 0 |
| 쿠팡 CS 전체 | MJS 26/26 + TS 28/28 = 54/54, skip 0, exit 0 |
| 직접 ESLint | exit 0 |

PGlite 반례:

1. 설치 전 exact legacy order/ticket/binding을 만들고 설치 전후 count, 원래 order 필드, ticket `order_id`, binding 원래 필드를 비교해 모두 동일함을 확인했다.
2. 같은 exact provider read 재수집 후 그 ticket만 `legacy_unknown→exact`, lineage 1건으로 바뀌고 order 필드는 동일했다.
3. `credential_incarnation_v1`, 만료 provider credential, 강제 ledger trigger 오류 각각 order ingest 반환 1, order 존재, lineage 0, ticket order null, exact false를 확인했다.
4. Qoo10과 Coupang의 이전/이후 ingest 반환·주문 필드/status·invalid payload/unknown credential 오류 본문을 비교해 동일함을 확인했다.
5. 비쿠팡 exact wrapper의 결과를 정본 predecessor와 직접 비교했다.
6. 동일 seller key credential rotation은 exact, 다른 seller key ticket은 vendor mismatch, 두 seller가 같은 order number를 실제 수집하면 양쪽 모두 cross-vendor collision이며 candidate는 각각 한 행만 반환했다.
7. public function preimage를 고의로 바꾸면 첫 DDL 전에 migration 전체가 중단되고 ledger table은 생성되지 않았다.

## 제출·남은 외부조건

- 제출 파일: `docs/cs-parallel/proposals/coupang/007-executable-order-lineage.md`
- 실행 SQL: `docs/cs-parallel/proposals/coupang/patches/007-coupang-order-lineage.sql`
- 시험: `tests/cs-coupang-order-lineage-db.test.mjs`
- 구형 의사 hook과 축약 fixture는 삭제했다.
- 공통 order hook integration은 통합 담당/공통 owner 검토 전 보류다.
- 운영 DB와 실주문에는 적용하지 않았다.
