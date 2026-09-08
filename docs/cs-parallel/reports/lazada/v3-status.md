# Lazada CS V3 인계 상태

- 시각: 2026-09-08 21:56:58 KST
- 기준: `S0-20260908-decaba426812a3ba`, 보완 delta SHA-256 `37a7f5843c783d2eca318f3a64cde09a0501401f8f77041e5213a826c938889d`
- 작업폴더/브랜치/포트: `/Users/kimchangheemac/dev/sellerpilot-cs-lazada` / `codex/cs-lazada-v1` / `3216`
- 제출물: `lazada-005-ingest-v3.sql`, `lazada-005-runtime-v3.patch`, PGlite fixture, exact-preimage patch test
- 금지 작업 준수: commit/push/deploy/운영 DB/운영 webhook/token refresh/실고객 답변 mutation 없음

## 결론

parser/2가 만든 `system`, `seller`, `recalled`, conflict 의미를 공통 DB가 잃지 않도록 V3 SQL 초안과 다섯 runtime 진입점 전환 patch를 실행 가능한 형태로 만들었다. SQL은 PGlite에 실제 적용됐고, runtime patch는 exact preimage 검사와 격리 복제본 전체 TypeScript 검사를 통과했다. 다만 통합 source와 운영 DB에는 아직 반영되지 않았으므로 실제 Push·DB·웹·답변 연결 완료가 아니다.

CS Bot IM read grant의 실제 증거는 기존과 같다. MY CS Bot app `137571`의 별도 token으로 session/message API가 HTTP 200/provider code 0이었고, 선택 official session은 원격 고유 메시지 13개, 운영 DB 0개, SellerPilot 웹 0개였다. Commerce app `137451`과 token 계보가 다르다. UI Online 상태는 이 결과를 대신하지 않는다.

## G1–G8

| 게이트 | 상태 | 이번 V3 결과 | 다음 한 행동 |
|---|---|---|---|
| G1 범위·권한 | 진행 | CS Bot/Commerce app·token 분리를 유지했고 V3 readiness가 unexpired credential, provider-certified seller key, country, 단일 app/token capability lineage를 모두 요구하도록 고정됐다. | 통합 격리 DB에서 실제 credential row를 body 없이 대조한 뒤 provider-certified MY binding을 발급·readback한다. |
| G2 로컬 | 통과 | V3 SQL PGlite 7개 의미 시험, runtime patch 2개 계약 시험을 포함한 최종 59/59, ESLint exit 0, patch 적용 복제본 tsc exit 0. | 통합 담당이 SQL을 정식 migration 번호로 옮기고 같은 시험을 실행한다. |
| G3 실제 읽기 | 통과(선택 세션), account-wide 진행 | CS Bot session-list와 선택 session 전량 13개 grant 증거 유지. account-wide session-list는 `has_more=true`다. | V3가 durable DB에 적용된 뒤 저장 cursor로 account-wide continuation을 재개한다. |
| G4 과거·웹 | 진행 | 선택 session remote 13 / DB 0 / web 0 차이를 보존했다. V3는 system timeline과 customer generation 불변성을 로컬 DB에서 증명했다. | 같은 13개 fingerprint를 bootstrap→raw→DB→인증 웹에서 재대조한다. |
| G5 신규 Push | 외부조건 대기 | raw-first ACK와 parser 경로는 존재하며 V3 patch가 webhook readiness와 V3 contract를 강제한다. 콘솔 callback 공란, 7개 group 미선택 상태는 바꾸지 않았다. | V3 release 뒤 공개 callback Verify, 다른 app 서명 거절, 동일 receipt 재전달을 관측한 다음 IM group만 활성화한다. |
| G6 답변 관측 | 외부조건 대기 | 오래된 seller echo가 새 customer generation을 해결하지 못하는 V3 DB 반례가 통과했다. 승인 ticket/text가 없어 실제 send는 하지 않았다. | 승인된 1개 티켓·문구로 1회 전송 후 동일 session의 원격 seller echo를 확인한다. |
| G7 복구 | 진행 | terminal retry 집계 수정, V3 revision/claim, normal→recall, body/attachment conflict, seller 경계가 격리 시험을 통과했다. 기존 256KB/5,000행/TTL/attachment URL 만료 시험 증거도 유지된다. | 실제 raw receipt 하나를 ACK 뒤 중단 지점에서 재실행하고 raw/quarantine/card/attachment UI까지 관측한다. |
| G8 운영 | 외부조건 대기 | 실제 적용 순서와 rollback ABI가 patch/SQL에 명시됐지만 통합/운영 mutation은 하지 않았다. | SQL readiness false 검증 → 정확한 binding fixture에서 true → runtime patch → parser/2+V3 동시 release 순으로 반영한다. |

## V3 계약과 시험

- `sellerpilot_private.lazada_im_message_revisions`는 본문이 아닌 fingerprint와 ordering metadata만 append-only로 보존한다.
- `sellerpilot_service_lazada_im_ingest_ready_v3(uuid)`는 credential별 app/token/country/seller 계보가 빠지거나 중복이면 false다.
- `system`은 timeline에는 저장되지만 기존 customer latest/status/message를 바꾸지 않는다.
- 과거 seller echo는 최신 customer generation을 해결하지 않는다.
- 동일 ID·동일 fingerprint의 normal→recall은 `message`와 `recalled` 두 revision을 보존하고 현재 projection만 recall로 바꾼다.
- 동일 ID에서 본문 또는 첨부 fingerprint가 달라지면 conflict/quarantine이며 recall 우회가 아니다.
- 다른 provider-certified seller credential은 기존 ticket/revision에 붙을 수 없다.
- batch 500행/1MB 상한과 service-role-only RPC/table ACL을 고정했다.

## 리뷰·사후지원 범위

- 리뷰는 공식 read/reply 및 notification 계약이 있으나 현재 앱 permission 확인이 남아 `permission_pending`이다. IM 연결 완료에 합산하지 않는다.
- reverse-order 사후지원은 공식 read/push 계약과 Commerce permission이 있으나 CS 전용 구현이 없다. cancel/return/refund mutation은 이번 범위 밖이며 별도 구현·승인이 필요하다.
- 판매자 화면 로그인 완료는 메뉴 접근 전제다. 앱 grant, callback binding, 실제 API/Push/readback 증거와 분리한다.

## 통합 적용 순서

1. `lazada-005-ingest-v3.sql`을 격리 DB의 정식 forward migration으로 변환하고 public/anon/authenticated revoke와 service-role execute를 재검증한다.
2. binding이 없거나 모호한 fixture에서 readiness false를 확인한다.
3. 하나의 provider-certified seller/country/app/token capability lineage에서만 readiness true를 확인한다.
4. `lazada-005-runtime-v3.patch`를 exact preimage에 적용한다.
5. PGlite·parser·raw replay·reply observation·attachment/TTL 회귀시험을 통과시킨다.
6. parser/2와 V3 runtime을 같은 release로 배포한 뒤 signed Push와 선택 session 13개를 remote→raw→DB→web으로 재대조한다.

## 증거 경로

- 실제 grant: `docs/cs-parallel/reports/lazada/actual-grant.json`
- 원격/DB/웹 대조: `docs/cs-parallel/reports/lazada/message-reconciliation.json`
- 기존 raw/card/attachment: `docs/cs-parallel/reports/lazada/raw-reprocess-card-attachment.json`
- 답변 관측 경계: `docs/cs-parallel/reports/lazada/reply-observation.json`
- V3 최종 시험: `docs/cs-parallel/reports/lazada/v3-isolated-verification.json`
- V3 delta: `docs/cs-parallel/reports/lazada/v3-delta.json`
