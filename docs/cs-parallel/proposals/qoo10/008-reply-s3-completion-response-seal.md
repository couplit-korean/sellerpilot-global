# Qoo10 S3 completion response seal 제안 qoo10-008

## 결론

현재 통합 소스에서 일반 gateway completion은 provider 결과를 `channel_gateway_jobs.response_payload`에 기록한 뒤 같은 transaction에서 `gateway_completion_receipts`를 삽입한다. replay는 기존 receipt fingerprint를 확인하고 추가 write 없이 반환한다. 그러나 terminal `response_payload` 전체에 대한 공통 불변 trigger는 없고, 다른 채널에는 의도적인 후처리 write가 있으므로 전역 잠금은 안전하지 않다.

`qoo10-008`은 delivery-bound Qoo10 S3 readback job만 receipt 삽입 시 request/response SHA-256과 lineage를 별도 seal하고, seal 이후 해당 job·receipt·seal의 증거 필드 변경을 차단한다. 다른 채널, 일반 Qoo10 history, Qoo10 reply job은 대상이 아니다.

- S0: `S0-20260908-decaba426812a3ba`
- 실행 SQL: `docs/cs-parallel/proposals/qoo10/008-reply-s3-completion-response-seal.sql`
- 격리 재생: `tests/cs-qoo10-reply-s3-response-seal-db.test.mjs`
- 적용 순서: `qoo10-007` 다음, 공통 completion route의 status RPC 연결 전에 적용
- 기존 receipt backfill: 금지. seal 설치 전에 끝난 readback은 S3 증거로 승격하지 않는다.

## 읽기 전용 소스 추적

| 공통 파일 | SHA-256 | 확인한 경계 |
|---|---|---|
| `app/api/channel-gateway/worker/complete/route.ts` | `9e1ba34b77788d1ea68ac2489e09dda322fea4d9f8400cbd8c85e757e7831781` | 최신 통합본. validated worker result를 `p_response_payload`로 atomic completion RPC에 전달 |
| `supabase/migrations/20260826090400_atomic_gateway_completion_side_effects.sql` | `9f1ec6f764ec39f8f4f8fce92e8449bdd5fd4feb02000beadfb2856152d3528f` | fingerprint 계산, replay 비교, job completion write, receipt insert 순서 |
| `supabase/migrations/20260905140000_preserve_unordered_lazada_messages.sql` | `48ad520707b79c740fba3f846974fc979302d6efefa8c66e7ab86fd0c67675f1` | Lazada ingestion pending marker를 response payload에 쓰고 제거하는 정상 경로 |
| `supabase/migrations/20260907160000_smartstore_adoption_gateway_readback.sql` | `43aaa7e3d5987a9b37b0f52bfeca61405fedb77a83f8566fb47eae7a1293d264` | SmartStore 전용 completion/receipt insert |
| `supabase/migrations/20260907174000_smartstore_existing_remote_content_repair.sql` | `5fed024b265974c026b5566d9d0d7a6faff51e71259c60bc612491d257cbf5eb` | SmartStore repair 전용 response/receipt write |
| `supabase/migrations/20260907175200_smartstore_repair_uncertain_official_readback.sql` | `1d417d0a04038de0e4419e30d9f9fb14825e44cda6bba0a267377fd57c36793e` | SmartStore uncertain readback receipt write |
| `supabase/migrations/20260907175400_smartstore_repair_adoption_recheck.sql` | `a7f4d49d51ddf214b82897d98e2fdee782f597c1b91cea1395dc9716d889e9db` | SmartStore recheck 전용 response/receipt write |

`gateway_completion_receipts` 직접 insert를 가진 migration은 위 atomic completion 1개와 SmartStore 전용 4개뿐이다. 새 trigger는 insert된 job의 `arguments.sellerpilotQoo10ReplyReadback` marker가 없으면 즉시 그대로 반환하므로 SmartStore와 다른 채널 completion에 seal이나 추가 제약을 만들지 않는다.

Qoo10 작업폴더의 completion route SHA는 `41435b65a23dc4d12a9c47a37f8ac20d572a81afe8af1fb9171d004edb0f7e64`이고 최신 통합본은 위 `9e1ba...`다. read-only diff는 Lazada V3 readiness/ingest 호출 변경뿐이며, Qoo10 분기나 마지막 atomic completion RPC의 ordering은 바꾸지 않는다. 008은 최신 통합본 SHA를 preimage로 사용한다.

`response_payload` write는 공통 completion 외에도 Lazada partial ingestion, listing publication review, SmartStore repair 같은 채널별 복구 경로에 존재한다. 따라서 `channel_gateway_jobs` 전체를 terminal 이후 불변으로 만드는 trigger는 기존 동작을 깨뜨린다. Qoo10 S3 marker를 가진 `inquiries.list` job 하나로 범위를 한정해야 한다.

이 조사는 통합 작업폴더의 현재 migration/code 정본을 읽은 결과다. 운영 DB의 `pg_get_functiondef`, trigger catalog 또는 실제 grant를 조회한 결과는 아니다.

## seal 생성 순서

```text
worker result schema 통과
  -> sellerpilot_service_complete_gateway_transaction
     -> channel_gateway_jobs terminal response 저장
     -> gateway_completion_receipts INSERT
        -> AFTER INSERT: Qoo10 S3 marker 검사
        -> request/response SHA + claim/worker/job lineage seal INSERT
  -> completion RPC 성공 또는 exact replay 확인
  -> sellerpilot_service_record_qoo10_reply_s3_readback_v1
     -> seal과 현재 job/receipt SHA 재대조
     -> qoo10-007의 stored provider row 판정
```

receipt와 seal은 같은 transaction에서 생성되므로 중간 상태는 외부 transaction에 노출되지 않는다. status wrapper는 job, receipt, seal을 `FOR SHARE`로 잠근 뒤 두 SHA와 모든 seal identity를 대조한다.

## 실행 SQL의 동작

### 1. 별도 seal ledger

`sellerpilot_private.qoo10_reply_s3_completion_seals`는 다음을 보존한다.

- `job_id + claim_token + worker_token_id + completion_fingerprint`
- credential, channel, operation, environment, owner, seller account key
- terminal status와 completed time
- 전체 canonical JSONB request SHA-256
- 전체 canonical JSONB response SHA-256. failed completion의 SQL NULL도 JSON `null`로 고정해 hash한다.

테이블은 RLS를 활성화하고 `public`, `anon`, `authenticated`, `service_role`의 직접 권한을 모두 회수한다. seal 생성은 receipt의 `AFTER INSERT SECURITY DEFINER` trigger만 수행한다.

### 2. marker fail-closed

Qoo10 readback metadata key가 존재하면 다음 중 하나라도 틀릴 때 receipt insert 자체를 rollback한다.

- contract version, UUID delivery ID, MSG/HELP/ITEM type, 숫자 question/sequence
- S3 상태와 14자리 고정 시작/종료 시각
- channel `qoo10`, operation `inquiries.list`
- terminal status/completed time
- credential, owner, 64자리 seller account key
- claim, worker, completion fingerprint

marker가 없는 다른 채널과 일반 Qoo10 조회는 trigger가 관여하지 않는다. Qoo10 marker를 다른 채널 job에 붙이는 경우는 미영향 대상이 아니라 위조 조합이므로 receipt를 거부한다.

### 3. seal 이후 불변성

seal된 Qoo10 job은 다음 필드의 변경과 job 삭제를 거부한다.

- request/response payload
- credential, channel, operation, environment
- owner, seller account key
- terminal status, completed time

`updated_at`만 바꾸는 replay bookkeeping은 허용한다. receipt와 seal row의 update/delete도 거부한다. trigger를 우회해 response를 바꾸더라도 status wrapper의 SHA 비교에서 `QOO10_REPLY_S3_READBACK_SEAL_INVALID`가 발생하고 delivery는 변경되지 않는다.

### 4. qoo10-007 wrapper

`qoo10-008`은 기존 qoo10-007 상태 RPC를 revoke된 내부 predecessor 이름으로 바꾸고 같은 외부 함수명에 seal wrapper를 둔다. service role은 wrapper만 실행할 수 있다. wrapper가 seal을 검증한 뒤에만 qoo10-007의 NULL/evidence/ACL/lineage 판정을 호출한다.

## completion과 replay 호환성

- 첫 completion: common RPC가 job response를 먼저 저장하고 receipt를 insert하므로 AFTER INSERT seal에 필요한 값이 모두 존재한다.
- exact replay: common RPC는 기존 receipt fingerprint가 같으면 추가 receipt를 쓰지 않고 반환한다. 기존 seal을 그대로 재검증하며 seal row는 1개다.
- mismatch replay: 기존 common fingerprint 비교가 먼저 실패한다. seal은 변경되지 않는다.
- failed/reconciliation completion: response가 NULL 또는 오류 구조여도 hash를 봉인한다. qoo10-007은 status-only 결과를 `provider_transport_or_contract_failed` 등으로만 기록하고 자동 재전송은 계속 false다.
- 다른 채널: marker가 없으므로 기존 response 수정 및 receipt 동작이 그대로 유지된다.

## 검증 행렬

격리 PGlite는 qoo10-007과 qoo10-008 SQL을 그대로 순서대로 적용한다. PGlite 배포본에 `pgcrypto` 확장 파일이 없어 fixture만 PostgreSQL 내장 `sha256`으로 동일한 `extensions.digest(text,'sha256')` 서명을 제공한다. 운영 SQL은 Supabase의 기존 `extensions.digest`를 사용한다.

1. receipt insert가 request/response seal을 만들고 status RPC가 exact S3를 기록.
2. sealed job의 request, response, credential, channel, operation, environment, status, owner, seller account, completed time, delete를 각각 거부.
3. receipt와 seal update/delete를 거부.
4. mutation trigger를 강제로 우회한 response 변조도 wrapper SHA에서 거부하고 delivery 불변.
5. replay 뒤 seal 1개와 동일한 status result 유지; `updated_at` bookkeeping 허용.
6. 정상 Shopee와 marker 없는 일반 Qoo10 list는 seal 0개이고 response 후처리 허용.
7. Qoo10 marker를 붙인 다른 채널 receipt는 거부.
8. failed Qoo10 readback의 NULL response도 봉인하고 transport failure/status-only로만 기록.

최종 격리 결과: `8/8` 통과.

## 적용·롤백 경계

- 실제 migration을 만들 때는 qoo10-007과 qoo10-008을 같은 release candidate에서 적용하고, completion route의 status RPC 연결은 두 schema가 모두 확인된 뒤 활성화한다.
- 기존 receipt를 backfill하지 않는다. backfill은 “completion 시점에 봉인됨”을 소급해서 주장할 수 없기 때문이다.
- rollback은 먼저 status RPC 연결을 비활성화하고, wrapper execute를 회수한 다음 trigger와 seal table을 제거한다. seal이 있는 상태에서 job/receipt를 먼저 수정하거나 삭제하지 않는다.
- 운영 적용 전 Supabase catalog에서 실제 function definition, trigger order, table grants를 read-only로 재확인한다.

## 현재 상태

- 공통 원본 변경: 없음
- 운영 DB 적용: 없음
- 실고객 답변/S3 원격 조회: 없음
- commit/push/deploy: 없음
- qoo10-007 기존 delta: 변경하지 않음
