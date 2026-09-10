# 공통 변경 요청 smartstore-003

- 목적: SmartStore 정규화가 보존하는 주문참조 상태와 공용 DB 결속 상태를 합성해, 운영 UI에서 복수 상품주문·형식 오류·계약 불일치를 `주문번호 없음`으로 숨기지 않는다.
- 요청 채널: smartstore
- S0 ID / 현재 인터페이스 버전: `S0-20260908-decaba426812a3ba` / 공용 `sellerpilot-cs-order-binding-health/1`, 전용 `smartstore-cs-order-binding-projection/1`
- 수정할 공통 파일과 함수: `lib/cs/order-binding-health.ts` schema, `app/cs/order-binding-health.tsx` labels/rendering, `app/api/admin/cs/order-bindings/route.ts` response parser, `public.sellerpilot_read_cs_order_binding_health_v1()`의 후속 v2 RPC
- 현재 파일 SHA-256: `lib/cs/order-binding-health.ts`=`072606b4181c2dc314787e772b685b1688b160f41a3c1a487570c33fb60de5b3`, `app/cs/order-binding-health.tsx`=`555c71ffa239b82f895a7c95c7d80696503ecaa8e3302f173b530edccbedf48d`, `app/api/admin/cs/order-bindings/route.ts`=`26b5f4fc6d6f72b3758dd07eeb5cbdfb335920310268f58b300aef4bca20bde8`, `supabase/migrations/20260908001000_harden_cs_commerce_boundaries.sql`=`9dd479171e2a43c8ba2747a80149f4d494183d611253fd9493f44f658b1895dc`
- DB 객체: 기존 `sellerpilot_private.cs_order_bindings`, `support_tickets.provider_context`; 새 테이블 불필요. 기존 v1 RPC는 유지하고 `public.sellerpilot_read_cs_order_binding_health_v2()`를 별도 추가한다.
- 기존 동작: 공용 health RPC는 `cs_order_bindings.status` 네 값(`exact`, `unmatched`, `unverified_credential`, `not_applicable`)만 집계한다. SmartStore의 `providerContext.orderReferenceState=ambiguous_product_orders|invalid_product_order_list`도 `external_order_reference`가 없으므로 모두 `not_applicable`로 보인다. shared admin의 `auth.uid()`와 credential 소유 판매자 owner가 다를 수 있으므로 SmartStore v2는 활성 검증 credential의 owner를 별도 결정한다.
- 문제를 재현하는 최소 입력: 고객문의 `{orderReferenceState:"ambiguous_product_orders", productOrderIds:["10001","10002"]}`, `externalOrderReference=null`, binding `status="not_applicable"`. 현재 UI는 `주문번호 없음`으로 표시하지만 실제 운영 행동은 `복수 상품주문 확인 필요`여야 한다.
- 원하는 동작: v2 집계 상태를 `exact|unmatched|unverified_credential|not_applicable|ambiguous_product_orders|invalid_product_order_list|contract_mismatch`로 확장한다. SmartStore는 전용 projector와 같은 판정표를 사용하고 원격 주문 ID·고객 원문을 응답하지 않은 채 상태별 count만 반환한다. `["10001",null]`, `["10001",""]`, exact 중복 배열은 원소 제거 없이 `contract_mismatch`다. `automaticOrderLinkAllowed`는 `exact`에만 true이며 `csCommerceMutationAllowed`는 항상 false다.
- 전용 모듈 경로와 export: `lib/cs/channels/smartstore/order-binding-projection.ts`의 `projectSmartstoreOrderBinding`, `smartstoreOrderBindingUiLabels`
- 기존/새 입력·출력 계약: 기존 `groups[{channel,status,count}]` v1 유지. 새 v2도 집계만 반환하되 위 7상태와 `projectionContract:"smartstore-cs-order-binding-projection/1"`을 포함한다. raw `productOrderIds`, `externalOrderReference`, ticket/customer 식별자는 반환하지 않는다.
- 최소 변경안: `smartstore-003-order-binding-health-v2.sql`의 SmartStore 전용 v2 RPC에서 활성 검증 credential의 seller owner, ticket의 `provider_context`, binding을 join해 전용 판정표와 같은 CASE로 `ui_status`를 집계한다. `smartstore-003-004-common-integration.patch`는 route에서 기존 v1의 비-SmartStore groups와 SmartStore v2 groups를 합쳐 다른 채널을 보존하고 UI label을 확장한다. v1 함수와 권한은 제거하지 않는다.
- 다른 채널 영향: v2 UI 집계가 다른 채널의 기존 4상태를 그대로 유지한다. 공통 total은 상태별 count 합으로 동일해야 한다.
- 상품/주문/배송 mutation 영향: 없음. read-only aggregate이며 `csCommerceMutationAllowed=false`; 기존 DB trigger의 CS commerce mutation 차단을 유지한다.
- 재현·회귀 시험 명령: `node --import tsx --test tests/cs-smartstore-recovery.test.ts tests/cs-smartstore-common-proposals.test.mjs tests/cs-commerce-boundaries-db.test.mjs tests/cs-credential-bindings-db.test.mjs`
- migration 선행/preimage/ACL 요구: migration 번호는 통합 담당이 배정. v2 함수는 `SECURITY DEFINER SET search_path=''`, 내부 admin 확인, `PUBLIC/anon/service_role` revoke, `authenticated`만 execute. underlying table direct grant 금지. Supabase Data API 자동노출에 의존하지 않는다.
- 우선순위: 오연결·손실
- 통합 담당 처리 상태: 실제 SQL draft와 공용 연결 patch 제출, 운영 migration/UI에는 미반영
- 반영된 통합 소스 hash와 검증: `smartstore-003-order-binding-health-v2.sql` PGlite 설치·권한·상태 집계 통과, 공용 patch `git apply --check` 통과. 운영 반영 hash는 미반영

## 판정표

| provider state | 외부 참조/상품주문 ID | ledger state | UI state | 자동 연결 |
|---|---|---|---|---|
| product kind / unavailable | 없음 | not_applicable 또는 missing | not_applicable | false |
| exact_product_order | 유효한 동일 ID 정확히 1개 | exact | exact | true |
| exact_product_order | 유효한 동일 ID 정확히 1개 | unmatched | unmatched | false |
| exact_product_order | 유효한 동일 ID 정확히 1개 | unverified_credential | unverified_credential | false |
| ambiguous_product_orders | 참조 없음, 유효 ID 1개 이상(원문 중복 또는 복수) | not_applicable | ambiguous_product_orders | false |
| invalid_product_order_list | 참조 없음 | not_applicable | invalid_product_order_list | false |
| unavailable | 참조/ID 없음 | not_applicable 또는 missing | not_applicable | false |
| 위 조합과 모순 | 임의 | 임의 | contract_mismatch | false |
