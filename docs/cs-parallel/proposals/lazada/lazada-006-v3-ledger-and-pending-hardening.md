# 공통 변경 보완 요청 lazada-006

- 기준: `S0-20260908-decaba426812a3ba`, V3 delta SHA-256 `0a02b66ae1b7feef010044e956b589d757b434ab48ef9370a657066a34c6dabf`
- 대상: `lazada-005-ingest-v3.sql` 후속 강화. 기존 V3 delta는 변경하지 않고 다음 delta에서 SQL과 PGlite fixture만 전진한다.
- 운영 적용: 없음. 이 문서는 격리 SQL과 시험 근거다.

## 1. revision ledger scalar allowlist

기존 V3 SQL은 알려진 payload key를 빼는 denylist였다. 미래의 unknown key, `extraText`, `attachmentUrl`, nested object가 들어오면 revision ledger의 `provider_context`에 본문이나 URL이 남을 수 있었다.

후속 SQL은 다음 scalar metadata만 `jsonb_build_object`로 새로 구성한다.

- `eventKind`: string 1~80자
- `messageStatus`, `messageType`, `templateId`: JSON number 또는 null. number는 부호 포함 최대 10자리 정수 표현만 허용
- `templateKind`, `roleBasis`: string 1~80자
- `recallTargetMessageId`: string 1~240자
- `historyOnly`: boolean 또는 null
- `projectionConflict`: SQL이 conflict revision에만 내부적으로 추가하는 boolean

그 밖의 top-level key와 모든 nested object/array는 ledger에 복사하지 않는다. 유효하지 않은 허용 key의 타입·길이는 해당 event를 pending 처리하고 ticket/message/revision projection을 만들지 않는다. 기존 raw inbox와 현재 message projection의 bounded payload 보존은 유지한다.

PGlite 반례는 `extraText`, `attachmentUrl`, nested `{body,url}`을 넣은 뒤 revision JSON에 문자열과 URL이 없고 key 집합도 allowlist 안인지 검사한다. object형 `eventKind`와 81자 `roleBasis`는 pending 2건, ticket/message/revision 0건이어야 한다.

## 2. pending batch 선검증

기존 V2와 첫 V3 초안은 `lazadaIngestionPending` fingerprint/expiry를 V3 ingest 뒤 비교했다. 다른 재시도 batch 또는 만료 batch가 `originalBatchRequired`를 반환하면서도 독립 normal ticket/message/revision을 먼저 쓸 수 있었다.

후속 V3 gateway는 다음 순서를 강제한다.

1. completion context로 worker token, job, claim, operation을 검증한다.
2. running job row를 `for update`로 잠그고 기존 pending receipt를 읽는다.
3. 호출 batch fingerprint를 계산한다.
4. pending receipt의 object 형태, 64자리 fingerprint, string expiry와 파싱 가능한 시각을 검증한다.
5. malformed, fingerprint mismatch, expired 중 하나면 `ingestSkipped=true`, `originalBatchRequired=true`, `status=partial`을 반환하고 V3 ingest를 호출하지 않는다.
6. identity와 TTL이 일치할 때만 direct V3 ingest를 호출한다.

PGlite 시험은 mismatch와 expired 호출 전후의 ticket/message/revision count 및 원래 job `response_payload` 전체가 동일한지 검사한다.

## 3. completed replay 근거와 한계

현재 공통 완료 context의 근거 파일은 다음과 같다.

- `supabase/migrations/20260826090400_atomic_gateway_completion_side_effects.sql`, SHA-256 `9f1ec6f764ec39f8f4f8fce92e8449bdd5fd4feb02000beadfb2856152d3528f`
- 최신 wrapper `supabase/migrations/20260907174000_smartstore_existing_remote_content_repair.sql`, SHA-256 `5fed024b265974c026b5566d9d0d7a6faff51e71259c60bc612491d257cbf5eb`
- 기존 Lazada V2 precedent `supabase/migrations/20260905140000_preserve_unordered_lazada_messages.sql`, SHA-256 `48ad520707b79c740fba3f846974fc979302d6efefa8c66e7ab86fd0c67675f1`

base `sellerpilot_service_gateway_completion_context`의 `completed_replay`는 `gateway_completion_receipts`를 동일 `job_id`, `claim_token`, worker token hash/scope/status/expiry로 결합한다. 이는 같은 claim의 기존 완료 transaction이 존재함을 증명하지만 normalized inquiry payload digest는 증명하지 않는다. 최신 wrapper는 SmartStore repair metadata만 context에 추가하며 이 경계를 바꾸지 않는다. 기존 Lazada V2도 completed replay 입력을 재수행하지 않고 `alreadyApplied=true`를 반환한다.

따라서 후속 V3는 completed replay에서 어떤 `p_inquiries`도 읽거나 저장하지 않는다. 응답에 `replayPayloadIgnored=true`, `replayBasis=gateway_completion_receipt`를 추가해 “이번 payload가 적용됐다”는 의미와 분리한다. PGlite 시험은 완료 뒤 다른 payload로 replay해도 ticket/message/revision/job payload가 모두 불변인지 확인한다.

향후 replay payload 자체의 동일성까지 증명해야 한다면 공통 `gateway_completion_receipts`에 normalized batch fingerprint를 원자적으로 저장·readback하는 별도 migration이 필요하다. 현재 receipt에는 그 필드가 없으므로 이번 Lazada SQL이 임의로 동일성을 주장하지 않는다.

## 적용·회귀 순서

1. 후속 SQL hash를 정식 migration preimage에 맞춰 검토한다.
2. PGlite 8개 V3 DB 시험과 runtime patch 2개 시험을 실행한다.
3. parser 관련 Lazada 집중 시험을 함께 실행한다.
4. runtime은 `status=partial`과 `ingestSkipped=true`를 retry/reconciliation으로 유지하고 success로 완료하지 않아야 한다.
5. 운영 DB, 공개 webhook, credential/token, 실제 답변은 이 proposal로 변경하지 않는다.
