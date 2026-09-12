# 8채널 상품 등록 통합 결과 — R3/R4 후속

## 구현

### 요청 계약 전환

- `lib/product-registration/credential-execution-binding.ts`
  - `product_registration_request_identity_v2` 계약을 추가했다.
  - 만료시각을 제외한 credential ID/version/fingerprint/channel/environment만 반환하는 불변 identity 함수를 추가했다.
  - 만료시각 파싱과 현재 만료 차단은 기존대로 유지했다.
- `app/product-publish-workbench.tsx`
  - create/update 및 Qoo10 stop, Temu activate 요청에 v2 계약과 현재 credential version을 전달한다.
  - 화면 idempotency key의 mutation contract에도 v2 계약을 포함한다.
- `app/api/admin/products/[id]/remote-edit/route.ts`
  - v2 계약을 optional transition field로 파싱하고 최종 channel operation route까지 그대로 전달한다.
  - 표식이 없는 기존 클라이언트 요청은 표식을 임의로 추가하지 않는다.
- `app/api/admin/channel-operations/route.ts`
  - 계약 표식이 없으면 변경 전 fingerprint를 계산한다.
  - v2이면 같은 기본 요청에 불변 credential identity를 추가한다.
  - 어느 경우에도 claim은 한 번만 호출한다. mismatch guard를 제거하거나 기존 hash를 덮어쓰지 않는다.
  - claim 거절 응답에 provider/job 미생성 사실을 명시한다.

## 전환 안전성

| 입력/상태 | 기대 API 결과 | 실제 PGlite 원장 결과 | provider/job 증분 |
| --- | --- | --- | --- |
| 배포 전 계약 없는 요청 -> 동일 재시도 | 기존 진행 상태 | 동일 attempt, 202 | `0/0` |
| 새 v2 요청 -> 동일 반복 | 기존 진행 상태 | 동일 attempt, 202 | `0/0` |
| credential 만료일만 연장 | 동일 요청 | 동일 attempt, 202 | `0/0` |
| credential ID/version/fingerprint 회전 + 과거 key | 차단 | fingerprint mismatch, 409 | `0/0` |
| payload 변경 + 과거 key | 차단 | mismatch, 409 | `0/0` |
| product 변경 + 과거 key | 차단 | mismatch, 409 | `0/0` |
| target/account 대상 변경 + 과거 key | 차단 | mismatch, 409 | `0/0` |
| channel 변경 + 같은 문자열 key | 과거 channel attempt와 분리 | 다른 attempt | 새 channel 작업만 `1/1` |
| queued/running | 기존 작업 조회 | 202, 동일 attempt | `0/0` |
| succeeded | 기존 성공 조회 | 200 duplicate | `0/0` |
| reconciliation_required + provider mutation started | 수동 확인, 재실행 금지 | 409 | `0/0` |
| 요청 credential revision 미접수 | claim 전 차단 | 409, attempt 0 | `0/0` |

첫 접수 자체는 provider write 1회/job 1개로 모델링했고, 모든 재시도 수치는 그 기준 이후의 증분이다. 테스트는 SQL 소스 문자열만 확인한 것이 아니라 저장소의 실제 claim 함수 본문을 PGlite에 설치해 attempt/job 행과 호출 수를 검사한다.

## 왜 dual-fingerprint fallback을 사용하지 않았나

`sellerpilot_claim_channel_operation`은 read RPC가 아니다. 기존 `running` pre-gateway attempt에 job이 없거나 허용된 실패 상태이면 attempt를 다시 running으로 만들고 `credential_id`를 호출 credential로 바꿀 수 있다. 따라서 v2 claim mismatch 뒤 legacy hash로 재호출하면 다음 위험이 생긴다.

1. 단순 조회 의도로 과거 attempt가 재가동될 수 있다.
2. 새 credential이 과거 attempt에 결속될 수 있다.
3. 이후 enqueue가 provider write를 재실행할 수 있다.

이번 구현은 요청이 가진 계약 표식으로 fingerprint 공식을 먼저 하나로 결정하고 claim을 한 번만 실행한다. 새 key를 임의 발급하지 않고, mismatch 가드를 유지하며, 불확실 provider write를 재실행하지 않는다.

## 공유 RPC가 필요한 정확한 경계

현재 구현은 같은 활성 credential을 담은 정확한 과거 요청을 호환한다. 과거 credential이 회전·비활성화된 attempt를 새 credential로 자동 이어 붙이지 않는다. 그런 기능이 필요하다면 새 쓰기 RPC가 아니라, claim 전에 다음을 원자적으로 반환하는 읽기/검증 계약이 먼저 필요하다.

- `(channel, operation, idempotency_key)`로 찾은 exact attempt ID와 owner
- 접수 당시 credential ID/version/fingerprint 또는 불변 snapshot
- request fingerprint 및 product/listing/channel/market/target 결속
- attempt status, remote ID, gateway job 수/상태
- `provider_mutation_started_at`과 reconciliation 여부

이 정보 없이 credential이 달라진 legacy attempt를 자동 재개하는 것은 안전하게 구현할 수 없다. 이번 범위는 schema/migration 변경 금지였으므로 해당 확장은 하지 않았다.

## 검사 결과

- `node --import tsx --test tests/product-registration-credential-binding.test.ts tests/product-registration-request-identity-compatibility.test.mjs`: 9/9 통과.
- 위 두 검사 + `tests/product-remote-edit.test.ts`: 19/19 통과.
- `tests/ebay-channel-operations-route-flow.test.ts`: 실제 POST route harness 1/1 통과.
- 변경 파일 ESLint: 통과.
- 전체 `tsc --noEmit`: 통과.
- `pnpm check:workspace`: 통과.
- 기존 `tests/publish-workbench-retry-safety.test.mjs`: 1/2 통과. 실패 1건은 병행 UI의 숫자 표기 `65000`을 이전 소스 문자열 `65_000`으로 찾는 검사다.

## 외부 실행 여부

배포, Supabase schema/data 변경, credential 변경, provider mutation, 공식 provider GET, 구매자 노출 확인, worker 설치/재시작, Git stage/commit/push는 하지 않았다. 따라서 이번 결과는 R3/R4 로컬 완료이며 8채널 운영 등록 완료 증거가 아니다.
