# 공통 변경 요청 coupang-009

- 목적: 007 설치 직후 물리적으로 보존된 legacy Coupang `order_id`가 CS 목록·상세·AI 답변 초안·order binding health에서 exact 주문처럼 노출되지 않게 한다.
- 선행: 검토 완료된 `coupang-007`.
- S0 ID: `S0-20260908-decaba426812a3ba`
- SQL: `patches/009-coupang-exact-order-reader-gate.sql`
- 격리 시험: `tests/cs-coupang-order-reader-gate-db.test.mjs`
- 상태: proposal/PGlite 전용. 공통 owner 승인 전 운영 적용 금지.

## 노출 재현

007은 영향 집계를 위해 설치 시 기존 `support_tickets.order_id`와 `cs_order_bindings`를 일괄 수정하지 않는다. 따라서 reader gate 전에는 다음 정본 reader가 ledger 없는 legacy link를 그대로 사용한다.

- `sellerpilot_get_cs_workspace_snapshot`: ticket `orderId`에 `t.order_id` 직접 반환.
- `sellerpilot_get_ticket_reply_context_v2`: reply 상세의 `order_id`에 `t.order_id` 직접 반환.
- `sellerpilot_create_support_reply_job`: `t.order_id`의 주문을 조회해 AI request `order`에 외부 주문번호·상품명·수량·상태·시각을 포함.
- `sellerpilot_read_cs_order_binding_health_v1`: 저장된 `binding.status='exact'`를 재검증 없이 집계.

동일 PGlite DB에서 legacy exact order/ticket/binding을 만든 뒤 007만 적용하면 실제로 목록·상세·AI request에 order가 남고 health는 exact 1로 보인다. 이는 007 exact validator가 false/candidate `legacy_unknown`인 것과 모순된다.

## gate 계약

private helper는 non-demo ticket을 읽고 비쿠팡은 true, 쿠팡은 물리 `order_id`가 존재하고 현재 `cs_order_binding_is_exact`이 true일 때만 true다. API role 실행권은 없다.

- workspace: predecessor 전체 결과를 먼저 얻고, 쿠팡 non-exact ticket의 `orderId`만 JSON null로 바꾼다. external order reference와 문의 원문은 그대로 둔다.
- reply 상세: 같은 판정으로 쿠팡 non-exact의 `order_id`만 null로 바꾼다.
- AI draft: 기존 stale-inbound/locale/tone/auth 검증과 오류를 그대로 수행한 뒤, 쿠팡 non-exact이면 같은 트랜잭션 안에서 새 job payload의 `order`를 null로 만들고 audit `has_order_context=false`로 맞춘다. transaction commit 전이므로 잘못된 order context는 worker에 노출되지 않는다.
- health: 쿠팡은 저장 status가 아니라 current candidate를 집계한다. `legacy_unknown/vendor_mismatch/cross_vendor_collision/unmatched`는 기존 schema의 `unmatched`, invalid credential은 `unverified_credential`, exact/not-applicable은 그대로다.
- 비쿠팡 reader 결과·AI order context·health status는 그대로다.

false 또는 판정 불능은 모두 fail closed다. 물리 link를 삭제하지 않으므로 영향 count와 이후 exact rebind가 가능하다.

## 007 동시 보정

supplement8은 007 SQL에도 두 공통 검토 결함을 보정한다.

1. exact/candidate는 lineage가 한 vendor뿐인 것에 더해 `lineage.observed_at >= order.updated_at`인 최신 성공 증거를 요구한다. vendor B의 최신 order ingest 뒤 B ledger 기록이 실패하면 과거 vendor A evidence는 stale이어서 A도 exact가 아니다. 이후 B 기록이 성공하면 보존된 A+B seller key 때문에 collision이다.
2. order/ticket/credential/lineage AFTER trigger의 Coupang projection 예외를 국소 격리한다. 기존 order ingest wrapper의 반환·필드·provider/predecessor 오류는 그대로 유지하면서 CS projection 오류만 주문 수집을 롤백하지 못하게 한다. exact reader는 stale 물리 link를 다시 신뢰하지 않는다.

## 권한·범위

- 기존 reader/AI 함수와 007 exact 함수의 `md5(prosrc)`, public ACL을 DDL 전에 고정한다.
- predecessor는 API role 권한을 회수하고 새 public 함수만 기존 authenticated 권한을 유지한다.
- 테이블 일괄 UPDATE, provider 호출, reply enqueue, order/product/inventory/shipment/refund mutation은 없다.
- 운영 DB에는 적용하지 않았다.

## 격리 시험 결과

`tests/cs-coupang-order-reader-gate-db.test.mjs`: 3/3 통과.

- 같은 PGlite DB에서 legacy Coupang link를 007 전후 목록·상세·AI payload·health로 먼저 재현하고, 009 뒤에는 네 surface 모두 fail-closed가 됨을 확인했다.
- 물리 `ticket.order_id`와 `cs_order_bindings.status='exact'`는 일괄 변경하지 않은 채, health만 `unmatched`로 재분류했다.
- 같은 exact credential의 새 주문 read가 lineage를 기록하면 목록·상세·AI payload·health가 다시 exact로 노출된다.
- Qoo10의 목록·상세·AI payload·health는 009 전후 동일하고 public/private 함수 ACL을 보존한다.
- reader preimage를 고의로 바꾸면 첫 rename 전에 `COUPANG_CS_ORDER_READER_GATE_PREIMAGE_OR_ACL_MISMATCH`로 전체 중단한다.

공통 CS boundary와 007/009를 함께 실행한 격리 DB 묶음은 20/20, 쿠팡 전용 전체는 MJS 29/29와 TS 28/28로 통과했다. 이는 로컬 proposal 검증이며 운영 적용이나 실제 웹 대조를 뜻하지 않는다.
