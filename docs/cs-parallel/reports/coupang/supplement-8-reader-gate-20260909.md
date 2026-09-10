# 쿠팡 CS 8차 보완: stale provenance 차단과 exact reader gate

- 시각: 2026-09-09 KST
- S0: `S0-20260908-decaba426812a3ba`
- 범위: proposal `coupang-007`, 신규 proposal `coupang-009`, 격리 PGlite
- 운영 변경: DB/provider/credential/order/reply/route/job mutation 0
- 금지 범위: 상품 등록·재고·주문 상태 변경·송장·취소·반품·교환 승인 코드 수정/실행 0

## 결과

공통 검토에서 확인된 세 경계를 로컬 proposal과 실행 시험으로 닫았다.

1. vendor A의 과거 lineage가 있는 주문을 vendor B가 다시 수집했지만 B ledger 저장이 실패할 때, A evidence를 계속 exact로 보지 않는다. exact/candidate는 현재 `commerce_orders.updated_at` 이상인 lineage를 요구하며, 실패한 최신 provenance는 A/B 모두 fail-closed다. 이후 B provenance가 성공하면 보존된 A+B seller key 때문에 collision으로 격리한다.
2. order AFTER trigger를 포함한 ticket/order/credential/lineage 경로에서 쿠팡 CS projection 예외만 국소 격리한다. 실제 CS binding trigger 실패와 lineage trigger 실패 모두 order ingest를 롤백하지 않는다. 기존 provider/predecessor 호출과 오류는 이 격리 바깥에 있어 그대로 전파된다.
3. 007 설치 직후 물리적으로 보존된 legacy `ticket.order_id`/binding exact가 CS 목록·상세·AI 답변 초안·health에서 노출되던 상태를 같은 PGlite DB에서 재현했다. 009는 007 exact validator를 reader gate로 적용해 네 surface를 모두 fail-closed 처리하고, 새 exact provider read 뒤에만 다시 노출한다.

비쿠팡 동작과 ACL은 보존했다. Qoo10의 workspace/detail/AI payload/health 결과는 009 전후 동일했고, authenticated public 함수만 실행 가능하며 private helper와 predecessor는 API role에 열리지 않는다.

## 실증

| 항목 | 결과 |
|---|---|
| 007 order-lineage PGlite | 5/5, skip 0, exit 0 |
| 009 reader-gate PGlite | 3/3, skip 0, exit 0 |
| 공통 CS boundary + 007 + 009 | 20/20, skip 0, exit 0 |
| Lazada durable wrapper + 전용 lineage TS | 4/4, skip 0, exit 0 |
| 쿠팡 CS 전체 | MJS 29/29 + TS 28/28 = 57/57, skip 0, exit 0 |
| 신규 DB 시험 ESLint | exit 0 |

PGlite의 legacy 재현은 설치 전에 실제 order/ticket/binding exact를 만들고 007을 적용한 뒤 수행했다. 009 전에는 workspace `orderId`, reply context `order_id`, AI payload `order`, health `exact=1`이 남았다. 009 뒤에는 앞의 세 order context가 null이고 health는 `unmatched=1`이며, 물리 link는 영향 집계를 위해 그대로 남았다. 같은 exact credential 주문을 재수집한 뒤에는 네 surface가 모두 exact로 복구됐다.

reader와 007 exact/candidate의 함수 본문 해시 및 public ACL은 첫 DDL 전에 고정했다. 고의 preimage drift는 rename/table mutation 전에 전체 migration을 중단했다.

## 제출·남은 외부조건

- 수정 proposal: `docs/cs-parallel/proposals/coupang/007-executable-order-lineage.md`
- 수정 SQL: `docs/cs-parallel/proposals/coupang/patches/007-coupang-order-lineage.sql`
- 신규 proposal: `docs/cs-parallel/proposals/coupang/009-exact-order-reader-gate.md`
- 신규 SQL: `docs/cs-parallel/proposals/coupang/patches/009-coupang-exact-order-reader-gate.sql`
- 시험: `tests/cs-coupang-order-lineage-db.test.mjs`, `tests/cs-coupang-order-reader-gate-db.test.mjs`

007/009는 공통 order/reader 함수 변경안이므로 통합 담당과 공통 owner 승인 전 proposal/PGlite 상태다. 운영 DB와 실제 주문에는 적용하지 않았다. 따라서 운영 CS 화면이 현재 legacy order를 숨긴다고 주장하지 않으며, 실제 상품·콜센터·클레임 fresh GET과 DB→인증 웹 대조도 이번 보완에서 새로 수행하지 않았다.
