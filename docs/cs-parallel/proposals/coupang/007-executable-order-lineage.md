# 공통 변경 요청 coupang-007 보충본

- 목적: 쿠팡 주문 수집 credential의 vendor 계보를 private ledger에 기록하고, CS ticket→order 연결이 증명된 같은 vendor에서만 `exact`이 되게 한다.
- S0 ID: `S0-20260908-decaba426812a3ba`
- 실행 가능한 전체 SQL: `patches/007-coupang-order-lineage.sql`
- 격리 DB 시험: `tests/cs-coupang-order-lineage-db.test.mjs`
- 직접 변경하지 않은 공통 소스: `supabase/migrations/`, order runtime, common CS lookup.
- 상태: proposal/PGlite 전용. 공통 소유자의 통합 승인 전 운영 적용 금지.

## 보충 결과

구형 `... existing assignments unchanged ...` 의사 patch는 제거했다. 새 SQL은 운영에서 관측한 최신 public wrapper를 `sellerpilot_ingest_orders_pre_coupang_cs_lineage_v1`으로 rename하고, 그 전체 체인을 먼저 호출한 후 쿠팡 provenance만 best-effort로 기록하는 완전한 함수 정의다.

다음 운영 preimage를 migration 시작과 끝에서 고정한다.

| 함수 | `md5(prosrc)` |
|---|---|
| `public.sellerpilot_service_ingest_orders` | `7657c4469226c8a0873628e9f029380d` |
| `public.sellerpilot_ingest_orders_pre_lazada_ownership` | `1a426cc962f53f230a4fa4e0f147d22e` |
| `public.sellerpilot_270827_ingest_orders_without_shopee_lineage` | `72163b030ad8554f56df9b673f098510` |
| `public.sellerpilot_service_ingest_orders_pre_temu_fulfillment` | `fb7b4b6eea9d1d4b8c7e3a60c9949b31` |
| 정본 `sellerpilot_private.cs_order_binding_is_exact` | `1fdde0da2bcaf7c1e1d903e471f37c52` |

해시·ACL 중 하나라도 다르면 첫 DDL 전에 `COUPANG_CS_ORDER_LINEAGE_PREIMAGE_OR_ACL_MISMATCH`로 중단한다. public 함수는 기존처럼 `service_role`만 실행하며 내부 predecessor와 ledger/recorder는 API role 모두 실행할 수 없다.

## 주문 수집 비간섭 계약

1. 새 public wrapper는 최신 Lazada→Shopee→기존 upsert 체인을 먼저 끝낸다. 그 반환값과 기존 예외는 그대로 돌려준다.
2. 비쿠팡은 추가 쿼리 없이 즉시 기존 반환값을 돌려준다.
3. 쿠팡은 기존 체인이 성공한 뒤 그 호출에서 실제로 touch한 owner/order reference만 찾는다.
4. recorder는 production, active/grace, 미만료, 64자리 key, `provider_certified_v1`, 검증 시각 존재를 모두 만족할 때만 ledger를 쓴다.
5. unverified/expired credential은 `credential_unverified`, ledger 저장/trigger 오류는 `storage_unavailable`을 내부 진단값으로 반환한다. 어느 경우도 이미 성공한 주문 수집을 롤백하지 않는다.
6. exact는 seller key가 하나뿐이라는 과거 사실만으로 성립하지 않는다. 현재 주문 `updated_at` 이상인 같은 seller의 lineage가 있어야 한다. 최신 vendor B 주문 upsert 뒤 B ledger 저장이 실패하면 과거 vendor A lineage는 stale이 되어 A/B 모두 exact가 아니다.
7. provenance가 없거나 stale이면 CS candidate는 `unverified_credential` 또는 `legacy_unknown`이고 `exact=false`다. 주문 상태·상품 연결·고객 필드·provider context는 새 wrapper가 직접 수정하지 않는다.

격리 시험은 incarnation, 만료 credential, 강제 ledger trigger 오류 세 경우 모두 주문 ingest 반환 `1`, 주문 행 존재, ledger `0`, CS exact `false`를 확인한다. vendor B의 최신 upsert 뒤 B ledger trigger만 실패하는 경우에도 주문은 갱신되고 과거 A lineage는 stale이라 A exact가 false다.

## 정본 공통 동작 보존

기존 `cs_order_binding_is_exact`은 이름만 `cs_order_binding_is_exact_pre_coupang_lineage_v1`으로 바꾸고 본문 해시를 보존한다. 새 wrapper의 비쿠팡 분기는 인자를 바꾸지 않고 이 predecessor를 그대로 호출한다.

기존 ticket/order reconcile trigger OID와 조회 대상·정렬을 유지한다. 선택된 ticket이 쿠팡일 때만 전용 reconciler로 보내며 비쿠팡은 정본 `reconcile_one_cs_order_binding`을 그대로 호출한다. 쿠팡 전용 projection 호출만 국소 `exception` 블록으로 격리해 ticket/order/credential/lineage intake를 롤백하지 못하게 한다. 특히 order AFTER trigger는 기존 provider/predecessor 체인 밖에서 예외를 삼키므로 provider/predecessor 오류는 여전히 그대로 전파된다. PGlite는 Qoo10에 대해 다음을 이전/이후 대조했다.

- order ingest 반환값 동일
- 전체 주문 필드 동일(UUID/생성·갱신 시각 제외)
- invalid normalized orders 오류 본문 동일
- exact validator의 order 있음/null 결과가 predecessor와 동일
- ticket binding `exact` 유지

## vendor 판정 계약

- credential rotation으로 ID가 달라도 provider-certified seller key가 같으면 같은 vendor다.
- 같은 owner/channel/external order ID에 서로 다른 seller key가 관측되면 관련 ticket 모두 `cross_vendor_collision`, `order_id=null`이다.
- ledger 1 vendor지만 ticket vendor와 다르면 `vendor_mismatch`다.
- 현재 order 갱신보다 오래된 단일 seller lineage만 있으면 `legacy_unknown`이고 어느 vendor도 exact가 아니다.
- 임의 `credential_incarnation_v1`, 만료 credential, ticket/credential seller-key 불일치는 `unverified_credential`이다.
- candidate의 모든 분기는 정확히 한 행을 반환하고 종료한다. 비정상 행 뒤 `exact`가 붙는 fall-through를 허용하지 않는다.

## 설치 영향·격리·재연결 계획

설치 SQL에는 `support_tickets`나 `cs_order_bindings`를 일괄 수정하는 문장이 없다. 따라서 배포 직전 read-only 영향 집계와 설치 후 점진 재연결을 분리한다.

1. 영향 집계: owner별 쿠팡 비-demo ticket 수, external order reference 보유 수, 현재 `order_id`/binding `exact` 수, active/grace credential source·검증·만료 상태를 read-only로 센다. 고객 원문·주소·전화번호는 조회/기록하지 않는다.
2. 격리: ledger 없는 기존 link는 물리적으로 즉시 지우지 않지만 새 exact validator에서 `false`이고 candidate에서 `legacy_unknown`이다. 공통 reader가 이 상태를 숨기는 변경은 공통 소유자의 별도 승인 항목이다. 그 reader gate가 없으면 007 자체를 운영 배포하지 않는다.
3. 재연결: provider-certified exact credential로 성공한 주문 read가 같은 order를 touch할 때만 ledger를 추가하고 해당 owner/order reference의 ticket만 재검증한다. order number만으로 bulk backfill하지 않는다.
4. 충돌: 서로 다른 seller key가 같은 order number를 관측하면 자동 선택하지 않고 두 vendor 모두 collision 격리한다.
5. 진행률: `legacy_unknown`, `unverified_credential`, `vendor_mismatch`, `cross_vendor_collision`, `exact`을 각각 집계한다. 0건과 조회 실패를 구분한다.
6. 롤아웃: synthetic→격리 사본→read-only 영향 집계→작은 exact credential batch→DB/웹 대조 순서다. 운영 DB write와 실고객 답변은 이 제안 범위가 아니다.

PGlite 설치 회귀는 기존 order/ticket/binding 개수와 원래 필드·link가 설치 전후 동일함을 확인한 뒤, 같은 exact provider read가 들어온 단일 ticket만 `legacy_unknown→exact`으로 전환됨을 검증한다.

## 시험 결과

`tests/cs-coupang-order-lineage-db.test.mjs`: 5/5 통과.

- production wrapper/정본 validator preimage와 ACL
- 설치 전후 synthetic 개수·필드·기존 link 동일
- verified read의 단일 재연결
- unverified/expired/storage-failure 주문 비롤백과 lineage 0/exact false
- 실제 CS projection trigger 실패 시 order/lineage intake 비롤백, 실제 lineage trigger 실패 시 order 갱신과 과거 evidence stale 처리
- vendor B 최신 upsert+B ledger 실패 뒤 과거 A exact false, 이후 B 성공 시 보존된 A+B collision
- 쿠팡/비쿠팡 반환·필드·기존 오류와 비쿠팡 validator 동일
- rotation exact, vendor mismatch, cross-vendor collision 단일행 판정
- preimage drift 시 첫 DDL 전 전체 중단

## 범위 경계

- 이 제안은 CS 읽기 문맥의 order ownership 증명만 보강한다.
- 상품 등록·재고·주문 상태 변경·송장·취소/반품/환불 승인 기능은 추가하거나 호출하지 않는다.
- 운영 DB에는 적용하지 않았고, 공통 소유자의 integration은 현재 보류 상태다.
