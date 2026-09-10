# Qoo10 reply S3 canonical-stack 후속 결과

- 시각: 2026-09-09 01:01 KST
- S0: `S0-20260908-decaba426812a3ba`
- S0 파일 검증: manifest 1,628/1,628, SHA-256 mismatch 0 (기존 `verification.md` 증거 재사용)
- 작업폴더/브랜치/HEAD: `/Users/kimchangheemac/dev/sellerpilot-cs-qoo10` / `codex/cs-qoo10-v1` / `3cb72144e991626fae98a30cf51022d9a1aa6b0b`
- 통합 기준본: `/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908`, 읽기 전용
- source delegated task: `01a077b1-61db-7c20-a4a3-ae00dbbbef19`
- 운영 변경: production DB, provider, 실고객 답변, commit, push, deploy 모두 없음

## 결론

이전 actual JS 진입점 시험은 실제 중앙 `runOneServerlessCsGatewayJob` 및 external completion `POST`를 사용했지만 terminal/token/ledger/workspace DB 정의는 작은 synthetic fixture였다. 이번 후속 시험은 중앙 `tests/supabase-migrations.test.mjs`의 정본 PGlite compatibility layer와 실제 migration 적용 루프를 재사용해 다음 정의를 실제 중앙 스키마로 교체했다.

- `sellerpilot_complete_channel_gateway_job`: 현재 정본 terminal 함수
- `worker_token_may_complete_gateway_job`: `serverless_cs` scope를 포함한 현재 token gate
- `sync_inquiry_reply_delivery_ledger`: 현재 답변 배송 원장 trigger
- `sellerpilot_get_cs_workspace_snapshot`: Qoo10 S3 상태 projection이 연결된 현재 workspace RPC

그 위에 중앙의 실제 qoo10-007/008/009/010을 적용하고 synthetic credential/ticket/inbound/reply job을 넣어 아래 한 transaction lineage를 통과시켰다.

`provider_accepted parent receipt -> support_reply_delivery -> delivery-bound S3 child -> serverless completion receipt -> immutable response seal -> exact S3 status -> authenticated delivery GET`

같은 S3 completion과 status를 다시 호출해도 completion receipt 2개(부모 1, 자식 1), child seal 1개로 유지됐다. `qoo10ReplyContentObserved=false`, `qoo10AutomaticResendAllowed=false`도 정본 사용자 조회에서 확인했다.

## 정본 전체 스택 경계

중앙 원본의 전체 `tests/supabase-migrations.test.mjs`를 수정 없이 실행하면 20개 중 8개 통과, 12개 실패다.

1. 첫 시험은 고정 migration 목록이 현재 추가된 migration들을 포함하지 않아 strict deep-equal에서 실패한다.
2. 나머지 11개 실패는 `20260904211500_allow_local_shopee_category_and_diagnostic_claims.sql`의 `11820 Shopee in-list marker count=0` preimage drift다.

이 오류는 qoo10-010 실행 이전의 중앙 공통/Shopee 범위에서 재현된다. Qoo10 전용 폴더에서 공통 원본을 고치지 않았다.

신규 시험은 중앙 migration harness를 그대로 읽되 고정 목록 단언만 현재 010 존재 확인으로 바꾸고, 위 Shopee migration을 적용하기 직전에 멈춘다. 그런 다음 Qoo10 흐름에 필요한 아래 중앙 migration만 정확한 원본으로 적용한다.

- `20260907232000_add_cs_reply_remote_observation.sql`
- `20260908140419_cs_qoo10_reply_s3_status.sql`
- `20260908140421_cs_qoo10_reply_s3_response_seal.sql`
- `20260908145336_cs_qoo10_reply_s3_common_paths.sql`
- `20260908153341_cs_qoo10_reply_s3_actual_completion.sql`

따라서 이번 성공은 **Shopee blocker 이전 정본 기반 + 선택된 실제 Qoo10 migration의 결합 증거**다. blocker 이후 모든 중앙 migration을 순서대로 적용한 전체 스택 성공 증거는 아니다.

## 집중 시험

| 시험 | 결과 | 핵심 관찰 |
|---|---:|---|
| 중앙 migration harness를 Shopee blocker 직전까지 적용 | 통과 | 실제 compatibility layer와 migration loop 재사용 |
| 현재 terminal/token/ledger/workspace 함수 정의 확인 | 통과 | 정본 함수 본문 marker 및 `serverless_cs` scope 확인 |
| provider-accepted 부모 완료 | 통과 | canonical receipt 1, delivery `provider_accepted`, S3 child 1 |
| serverless S3 완료 | 통과 | canonical child receipt와 response seal 각각 1 |
| completion response replay | 통과 | `replayed=true`, child/receipt/seal 추가 없음 |
| exact S3 status 및 동일 status 재기록 | 통과 | 두 호출 모두 `verified`; body 관측/자동 재송신은 false |
| authenticated delivery GET | 통과 | `qoo10S3StatusObserved=true`, `qoo10S3ReadbackState=verified` |

fixture는 synthetic 본문만 사용했다. 주소, 연락처, 구매자 ID, 고객 원문, 실제 QAPI credential은 저장하거나 출력하지 않았다.

## 검증 결과

| 범위 | exit | 결과 |
|---|---:|---|
| 신규 canonical-stack 집중 시험 | 0 | 2/2 통과 |
| 신규 시험 + 기존 actual-entrypoint 집중 시험 | 0 | 11/11 통과 |
| Qoo10 contract/history/runtime/ledger/reply/status/seal/common/claim + 신규 시험 | 0 | 62/62 통과 |
| 신규 MJS ESLint | 0 | 출력 없음 |
| 중앙 전체 `supabase-migrations.test.mjs` 무수정 실행 | 1 | 8/20 통과, 12 실패; strict 목록 1 + Shopee preimage 11 |

실패 반례 중 actual-entrypoint 시험에 출력되는 `Qoo10 S3 status-only readback recording failed { code: '22023' }` 한 줄은 의도된 marker mismatch의 fail-closed 증거이며 해당 subtest는 통과했다.

## 정본 적응 중 fail-closed 관찰

1. qoo10-007만 처음 적용했을 때 기존 delivery에 remote-observation 필드가 없어 실패했다. 중앙 의존 migration `20260907232000`을 먼저 적용했다.
2. synthetic credential에 지정한 seller key는 정본 trigger가 credential incarnation key로 교체했다. 그 값을 읽지 않고 ticket을 넣자 `support ticket credential lineage mismatch`로 거부됐다. 정본이 생성한 키를 읽어 같은 계보에만 사용했다.
3. reply fingerprint placeholder는 실제 답변 SHA-256과 달라 부모 job을 `reconciliation_required`로 바꿨다. synthetic 답변의 정확한 hash로 교정했다.
4. reply job을 ticket의 `reply_gateway_job_id`에 연결하지 않은 상태에서는 `ticket ledger no longer matches`로 부모 완료가 격리됐다. 실제 enqueue 상태와 같은 linkage를 구성했다.
5. status reason을 비정본 문자열로 호출하면 `QOO10_REPLY_S3_READBACK_ARGUMENT_INVALID`였다. 정본의 `exact_s3_status_observed` 계약을 사용했다.

모든 실패는 운영 호출 없이 격리 DB에서 발생했고, 성공 횟수에 합산하지 않았다.

## 입력 SHA-256

- 신규 시험: `e805ef07bb14fe4ac26641b6e0343e683f4162ef04a2ed51e8ffe817d765d3a7`
- 중앙 qoo10-010: `1b6a391f392a12622b6d6f76bd5b95502f4e250b25e8d7890f552e70b6e3e827`
- 중앙 serverless gateway: `faedb5761704ff3f01fa4f42c892d3077777688f1d468bb95ce7a252dff945bf`
- 중앙 external completion route: `b9a1a5056557e8bf6ef204727af13492e078d8d4b2fd18ff5f1705224f466383`
- 중앙 Qoo10 completion helper: `580e3f67b05dfba6bc030364817e5c08518edab93f44aeb8bbfcdce928a227d2`
- 중앙 migration harness: `6d0eca2bc32d9278a40d3e3df41657349aa792438178d250ca03ee2b923f7c41`
- 중앙 Shopee blocker migration: `392aa64544e05945e050162081ade6b4358bc802e928060410692da9adc2d954`

## 중앙 다음 행동

1. 중앙 소유자가 migration 목록 단언과 Shopee `11820` preimage를 별도 복구한다.
2. 복구한 중앙 전체 migration stack에 010과 신규 Qoo10 시험을 반영해 순서 전체를 재실행한다.
3. staging synthetic job에서 JS 진입점 + 정본 DB 전체를 한 번에 연결한다.
4. provider ACK, DB 영수증, S3 상태, buyer-visible 답변은 계속 별도 증거로 유지한다.

이번 결과는 운영 DB 적용, QAPI mutation, 실고객 답변, buyer-visible 완료 증거가 아니다.
