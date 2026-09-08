# 공통 변경 요청 coupang-006

- 목적: 한 SellerPilot 소유자가 쿠팡 vendor credential을 둘 이상 보유하고 두 vendor에 같은 외부 주문번호가 있을 때 CS ticket을 다른 vendor의 order에 연결하지 않는다.
- 요청 채널: coupang
- S0 ID: `S0-20260908-decaba426812a3ba`
- 채널 전용 fail-closed 계약: `lib/cs/channels/coupang/order-lineage.ts`
- 시험: `tests/cs-coupang-order-lineage.test.ts`
- 공통 현재 파일 SHA-256: `supabase/migrations/20260908001000_harden_cs_commerce_boundaries.sql` `9dd479171e2a43c8ba2747a80149f4d494183d611253fd9493f44f658b1895dc`; `supabase/migrations/20260816104732_operations_core.sql` `2d4cbb627493edd2658e406fd9ecbddd51d5bb6d538901757e6d580b7ec9aa64`; `supabase/migrations/20260821102500_order_product_linking.sql` `7664e0f259fdbe1ab24570bd03d5636a5108c8a388c4c074d8a69d49d4e2529f`.

## 재현된 경계

현재 `commerce_orders`의 identity와 upsert conflict target은 `(owner_id, channel_key, external_order_id)`이며 order row에 `source_credential_id` 또는 `seller_account_key`가 없다. `cs_order_binding_is_exact`와 `reconcile_one_cs_order_binding`은 ticket credential의 소유자·채널 유효성은 확인하지만 order 후보는 owner·channel·external order ID만으로 고른다. 따라서 한 owner 아래 두 쿠팡 vendor가 같은 주문번호를 쓰는 경우 provider vendor 일치를 증명할 수 없다.

`sellerpilot_read_cs_order_binding_health_v1`의 현재 문자열 `same_owner_channel_exact_external_order_and_credential`은 이 스키마에서 order-side credential 일치를 실제로 검증하지 못한다. 이 상태를 다른 vendor 주문번호 차단 완료로 보고하면 안 된다.

## 최소 통합 변경

1. 주문 수집 시 사용한 credential incarnation을 `commerce_orders.source_credential_id`와 `seller_account_key`에 원자적으로 저장한다. seller key는 검증된 `channel_credentials` 행에서만 복사한다.
2. 쿠팡 order identity와 upsert conflict target을 owner·channel·seller account key·external order ID로 바꾼다. legacy key가 없는 row는 자동 추정하지 않고 별도 backfill/quarantine 상태로 둔다.
3. CS binding은 ticket과 order 양쪽의 `source_credential_id` 및 `seller_account_key`가 모두 일치하고 후보가 정확히 한 건일 때만 `exact`으로 만든다. 0건은 `unmatched`, legacy/상대 vendor만 있으면 `unverifiable_order_lineage`, 둘 이상 exact 후보는 `ambiguous_order_lineage`로 fail closed한다.
4. 기존 unique constraint, order ingest RPC, CS binding trigger와 health RPC를 한 migration에서 함께 바꾼다. 부분 적용 중에는 신규 쿠팡 CS order binding을 열지 않는다.
5. 이 변경은 CS 읽기 연결 정확성용이다. 주문 상태·송장·취소·환불 mutation 권한을 열지 않는다.

## 회귀 입력과 기대값

- 같은 owner, channel=`coupang`, external order=`9001`, vendor A/B 두 row: A ticket은 A row만 exact이고 B row는 후보가 아니다.
- legacy order row에 order number만 존재: exact 금지, `unverifiable_order_lineage`.
- 같은 credential/vendor의 exact 후보 둘: 임의 선택 금지, `ambiguous_order_lineage`.
- credential 또는 검증 seller key 누락: `unverified_credential`.
- 기존 CS commerce mutation 차단 trigger는 그대로 유지한다.

## 적용 상태

- 채널 전용 fail-closed 판단과 위 반례 시험은 구현했다.
- 실행 가능한 private lineage ledger/recorder/CS lookup SQL과 order-ingest 최소 hook, 격리 DB 회귀는 후속 `coupang-007`로 제출했다.
- 공통 order ingest/binding은 이 채널의 직접 수정 범위 밖이며 통합본 runtime에는 미반영이다.
- 운영 주문이나 운영 DB에는 쓰기·변경을 수행하지 않았다.
