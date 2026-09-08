# Lazada 010 — concurrent revision/reply fence

- 기준: `S0-20260908-decaba426812a3ba`
- 상태: integration-owned forward migration proposal; 운영 미적용
- 선행 순서: canonical 005 ingest → 008 projection → 009 ordinary workspace/reply guard → 010
- 금지 상태: provider 호출 0, 실고객 답변 0, 운영 DB/token/webhook 변경 0

## 실제 재현된 결함

canonical 009의 mutation wrapper는 ticket row를 잠근 뒤에도
`lazada_im_ticket_projection_state_v1(ticket_id, statement_timestamp())`를 호출한다.
PostgreSQL의 `statement_timestamp()`는 클라이언트 문장 수신 시각에 고정되므로,
같은 PL/pgSQL 요청에서 문장 시작 뒤 recall revision을 기록한 다음 enqueue를 호출하면
revision의 `first_observed_at`이 cutoff보다 늦어져 `normal`로 잘못 판정된다.

통합 격리 fixture의 기존 결함 probe는 이 순서를 실제 실행했고, 009 enqueue job이
생성된 직후 `clock_timestamp()` projection이 `recalled`임을 확인했다. 즉 009의
UI/preflight/atomic-enqueue 설명 중 동시 revision 부분은 출하 가능 상태가 아니다.

PostgreSQL 공식 문서도 `statement_timestamp()`가 문장 시작 시각이고
`clock_timestamp()`는 문장 안에서도 진행한다고 명시한다:
<https://www.postgresql.org/docs/current/functions-datetime.html>.
또한 `STABLE` 함수는 calling query 시작 snapshot을, `VOLATILE` 함수 안의 각 query는
fresh snapshot을 사용한다:
<https://www.postgresql.org/docs/current/xfunc-volatility.html>.

## 현재 소스와 preimage

| 대상 | SHA-256 | 관측 |
| --- | --- | --- |
| `20260908140409_cs_lazada_im_ingest_v3.sql` | `b67d6901906ea6022471ba124520ae3a83a17e0708866ede8ab706dd9ddbeed7` | credential `FOR UPDATE` → `lazada-im-v3:{owner}:{seller}` xact advisory lock → batch loop |
| `20260908145831_cs_lazada_v3_conversation_projection.sql` | `834e098b9509360d9b3286b34237cb8c086ab5627896488cfa61c523425942cb` | exact owner/credential/seller/session/remote ID/native fingerprint projection |
| `20260908153837_cs_lazada_ordinary_workspace_reply_guard.sql` | `f6a20872cac2295a37e9c9e6c94989e611765a5d35dca63322d76a0d9025cb20` | ordinary UI/draft/enqueue guard, but mutation cutoff is statement start |
| `lib/channels/serverless-gateway.ts` | `faedb5761704ff3f01fa4f42c892d3077777688f1d468bb95ce7a252dff945bf` | write operation executes begin-provider RPC immediately before provider adapter |
| `app/api/channel-gateway/worker/begin-mutation/route.ts` | `2a5253f73363bd98bcf7f34e201738bde27927593be4567d631a782d835ab028` | local worker begin-provider RPC entry |
| `scripts/ai-cli-worker.mjs` | `9174bd48ea554318dc9500021004fa2fd27b1669edef2ec8abc5f4cebaaac102` | local worker calls begin-provider fence before `executeChannelOperation` |
| `app/api/admin/cs/reply/route.ts` | `505c25ad45974728de50a487076fe4a19cd792ec3464c1d097cc677ef71aba5d` | 009 preflight state + enqueue path; no provider call in route |

## 변경 계약

1. 읽기 cursor는 기존 `asOf` 계약을 유지한다. archive/conversation pagination은 수정하지 않는다.
2. mutation만 exact V3 seller lineage lock을 획득하고 `infinity` cutoff로 현재-visible
   revision 전체를 판정한다. 이는 미래 revision을 보는 것이 아니라 현재 snapshot에 이미
   commit된 row에서 시간 cutoff만 제거한다.
3. lock 순서는 `credential row → seller lineage advisory → ticket row`다. enqueue는 기존
   gateway wrapper의 `ticket → global gateway advisory` 역순을 피하려고 global advisory를
   가장 먼저 획득한 뒤 이 순서를 따른다.
4. V3는 seller batch 전체에 advisory lock 하나를 batch loop 전에 잡는다. 따라서 한 batch의
   message/ticket 순서가 달라도 reply mutation과 ticket별 lock 순서 교착을 만들지 않는다.
5. revision INSERT trigger는 current generation의 exact owner/credential/seller/session/remote ID/
   native fingerprint를 대조한다. queued/running job은 provider mutation 전이면 `failed`, 이미
   시작 경계가 기록됐으면 `reconciliation_required`가 된다.
6. trigger는 `STABLE` projection으로 같은 INSERT의 NEW visibility를 추측하지 않고 NEW scalar
   fields를 직접 대조한다. 또한 ticket을 먼저 잠그지 않고 job update의 기존 ledger trigger가
   사용하는 `job → ticket` 순서를 보존한다.
7. local 및 serverless begin-provider RPC는 실제 adapter 호출 직전 같은 current state를 다시
   확인한다. recall/conflict가 enqueue 이후 commit됐지만 provider boundary 전이면 외부 호출을
   허용하지 않는다.
8. durable `provider_mutation_started_at`가 기록된 뒤 도착한 revision은 결과를 모르는 상태이므로
   자동 실패/재시도하지 않고 reconciliation으로 보낸다. 이 timestamp가 선형화 지점이다.
9. source credential, certified seller, current inbound key 중 하나라도 바뀌거나 빠지면 fail closed다.
10. private helpers와 renamed unsafe functions는 `anon`, `authenticated`, `service_role` 모두 직접
    실행할 수 없다. 공개 wrapper의 기존 API role만 유지한다.

`pg_advisory_xact_lock`은 같은 application-defined key에 대해 필요 시 기다리고 transaction
종료까지 유지되는 exclusive lock이다:
<https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS>.

## claim/send 경계 결론

- enqueue 뒤 revision INSERT가 먼저 선형화되면 trigger가 queued job을 제거하므로 새 claim은 없다.
- claim이 먼저 끝나 running이어도 revision trigger가 provider boundary 전에 job을 실패 처리한다.
- worker가 그 사이 job snapshot을 이미 받았더라도 begin-provider RPC가 latest projection을 재검사한다.
- provider boundary가 먼저 성공하면 그 뒤의 recall은 원격 호출과 순서를 확정할 수 없으므로
  reconciliation이다. Lazada send API에 conditional revision argument가 없는 현재 계약에서
  이 선형화 지점보다 강한 분산 원자성은 주장하지 않는다.

## 시험과 남은 필수 실증

전용 PGlite 시험은 다음을 확인한다.

- 문장 시작 뒤 recall ingest → 같은 요청 enqueue가 `LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE`
- current recall/conflict의 draft/resolve/AI/enqueue 차단과 normal control
- enqueue 뒤 recall의 queued job 실패, provider-start 뒤 recall의 reconciliation
- trigger를 의도적으로 비활성화한 fixture에서도 local/serverless provider boundary가 conflict 차단
- private/unsafe ACL과 canonical 005 lock 순서 정적 대조

PGlite 0.3.16은 단일 user/connection 실행이므로, 이 시험은 실제 두 backend의 lock wait를
증명하지 않는다. 운영 적용 전에 격리된 실제 PostgreSQL에서 두 세션으로 다음을 추가해야 한다.

1. 세션 A가 credential/seller lock을 잡은 V3 recall/conflict transaction을 대기 상태로 둔다.
2. 세션 B가 enqueue 또는 begin-provider를 시작해 동일 seller lock에서 대기함을 `pg_locks`로 확인한다.
3. A commit 뒤 B가 fresh snapshot으로 non-actionable을 보고 job/provider-start 0임을 확인한다.
4. 역순으로 B가 mutation boundary를 선형화하면 A는 대기하고, A commit 뒤 job이
   `reconciliation_required`임을 확인한다.
5. 서로 다른 seller 두 세션은 불필요하게 같은 seller lock으로 직렬화되지 않음을 확인한다.

실제 PostgreSQL 다중 세션 검증 전에는 “동시성 완전 해결” 또는 운영 적용 가능으로 표시하지 않는다.

## 통합 요청

- 통합 담당이 새 migration 번호를 배정하고 이 SQL을 현재 canonical 005/008/009 뒤에 적용한다.
- migration 전후 worker를 정지한 격리 DB에서 위 2-session test를 먼저 실행한다.
- 기존 009 cutoff 결함 test는 삭제하지 말고 010 적용 전 fail-open/적용 후 fail-closed 대조로 유지한다.
- 공통 TypeScript 변경은 요구하지 않는다. local/serverless worker 모두 이미 begin-provider RPC를
  호출하므로 SQL wrapper가 두 실행 경로를 함께 막는다.
- 운영 DB, 공개 webhook, token 저장/refresh, provider 응답은 이 제안에서 변경하지 않는다.
