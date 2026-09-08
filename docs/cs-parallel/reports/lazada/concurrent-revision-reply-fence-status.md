# Lazada concurrent revision/reply fence status (010)

- 기준: `S0-20260908-decaba426812a3ba`
- 작업 브랜치: `codex/cs-lazada-v1`
- 확인 시각: `2026-09-08T16:09:13Z`
- 상태: 010 제안/단일-연결 격리 검증 완료, 실제 PostgreSQL 다중 세션 검증 및 통합 반영 대기
- 운영 변경: 없음
- provider 호출/실고객 답변: 0/0

## 결론

canonical 009의 `statement_timestamp()` cutoff는 문장 시작 뒤 commit/관측된 recall을
mutation 판정에서 제외할 수 있다. 통합 fixture에서 unsafe enqueue가 실제 생성된 결함을
확인했고, 010 제안 fixture에서는 같은 요청의 recall → enqueue가
`LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE`로 차단됐다.

010은 다음 네 경계를 닫는다.

1. 승인 draft 저장/resolve
2. AI draft 생성
3. gateway reply enqueue
4. enqueue 뒤 revision 및 local/serverless provider-mutation 직전

read-only archive/conversation cursor의 `asOf`는 그대로 유지한다. mutation만 canonical V3와
동일한 credential/seller lock을 사용하고 현재-visible revision 전체를 재검사한다.

## 검증 결과

| 검증 | 결과 | 한계 |
| --- | --- | --- |
| canonical 005 lock 순서와 gateway→direct V3 호출 정적 대조 | pass | 소스 계약 대조 |
| 두 실제 worker call path가 `inquiries.reply`에서 begin-provider RPC를 지나는지 정적 대조 | pass | provider 실행 없음 |
| 문장 시작 뒤 recall → same-request enqueue | 차단, job 0 | PGlite 단일 connection |
| recall/conflict → draft/resolve/AI/enqueue | 모두 차단 | PGlite 단일 connection |
| normal control | AI/enqueue 성공 | synthetic only |
| enqueue 뒤 recall/conflict trigger | provider 시작 전 failed | synthetic only |
| local/serverless begin-provider 재검사 | 모두 false, provider-start null | trigger를 끈 방어층 시험 |
| provider-start 뒤 revision | reconciliation_required | 실제 provider 결과는 만들지 않음 |
| private/unsafe ACL | anon/authenticated/service_role false | PGlite fixture |
| 전용 테스트 | 6/6 pass, 1918.448 ms | 실제 다중 backend 아님 |
| 005/008/009/010 관련 순차 회귀 | 24/24 pass, 14257.991 ms | 010은 전용 fixture; canonical 통합은 담당자 적용 대기 |
| ESLint | pass | 전용 `.mjs` |

## 잠금 및 재전송 안전성

- V3 한 batch는 credential row와 seller-level advisory lock을 batch loop 전에 한 번 획득한다.
- draft/update는 그 다음 ticket을 잠근다.
- enqueue와 provider boundary는 기존 queue의 global advisory를 먼저 잡은 뒤 V3 순서를 따른다.
- revision trigger는 ticket을 먼저 잠그지 않고 active job을 갱신하며, 기존 ledger trigger의
  `job → ticket` 순서를 유지한다.
- `reconciliation_required` reply generation은 기존 unique active/terminal index 때문에 같은
  generation의 새 enqueue가 허용되지 않는다. 자동 재전송 가능 상태로 바꾸지 않는다.

## 정확한 미완료 항목

PGlite 자체가 single-user/single-connection이므로 두 PostgreSQL backend 사이 advisory/row
lock wait와 fresh snapshot은 아직 실증하지 못했다. 로컬 시스템에도 `postgres`, `pg_ctl`,
`initdb`, Docker/Supabase local runtime이 확인되지 않았다. 따라서 010은 아직 운영 적용 가능
판정이 아니다. 격리된 실제 PostgreSQL에서 제안 문서의 5개 two-session 시나리오가 필수다.

또한 선형화 지점은 durable `provider_mutation_started_at`이다. 그 이전 commit된 revision은
send를 차단한다. 그 이후 도착한 revision은 이미 외부 호출이 시작됐을 수 있으므로
`reconciliation_required`이며 자동 재시도하지 않는다.

## 브라우저/실 grant 상태 분리

이번 010 검증 중 CHANGHEE Chrome에서 MY Seller Center는 로그인 폼, Lazada Open Platform은
`Sign in`을 표시했다. 브라우저 세션 비인증은 기존 저장 token의 grant 상실 증거가 아니다.
추가 로그인/로그아웃/재동의는 하지 않았다. 이전 실제 API 증거는 IM token으로 session list
HTTP 200/code 0과 선택 session 13개 message read까지였고, DB/web 0건이라 완전 연결 상태는
아니다. 이번 작업에서는 원격 API를 다시 호출하지 않았다.

## 산출물

- `docs/cs-parallel/proposals/lazada/lazada-010-concurrent-revision-reply-fence.sql`
- `docs/cs-parallel/proposals/lazada/lazada-010-concurrent-revision-reply-fence.md`
- `tests/cs-lazada-v3-concurrent-reply-fence.test.mjs`
- `docs/cs-parallel/reports/lazada/concurrent-revision-reply-fence-verification.json`
- `docs/cs-parallel/reports/lazada/concurrent-revision-reply-fence-delta.json`

009 산출물과 통합 canonical 파일은 수정하지 않았다. commit/push/deploy/운영 DB/webhook/token/
실고객 mutation도 수행하지 않았다.
