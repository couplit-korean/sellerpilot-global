> 2026-09-13 07:39 KST 후속 복구: DB 계약 10개 적용, 부재 RPC 93→79. 일별 이력 접수·Temu 승인 로컬 접수·Shopee 빈 반품 목록·CS 갱신 후 조회 실패 분류를 수정했다. 관련 77개 검사 통과. 배포 후 실제 결과 확인 단계이며 전체 채널 기능 완료는 아니다. [후속 보고서](../../reviews/20260913-runtime-restoration-followup.md)를 우선하고, 아래 기록은 각 당시 상태로 읽는다.

> 2026-09-13 07:02 KST 최신 판정: 실제 판매채널 API 읽기 진단 **8/8 통과**. Vercel·Supabase 활성 릴리스·Mac gateway는 `737171e`로 일치한다. 진단 대기 오판/로컬 진단 경로/Temu 조회 계정 결속/eBay 복구 DB를 추가 수정·적용했다. **전체 등록·CS·배송 완료는 아님**: 정적 RPC 93개 및 일부 실제 CS 실행 오류가 남아 있다. [최신 전체 채널 보고서](../../reviews/20260913-all-channel-runtime-repair.md)와 증거 JSON을 우선한다.

> 2026-09-13 추가 확인: 운영 5ae1ce0 및 Mac gateway 동기화 완료. 진단 45초 대기를 failed로 기록하던 결함과 비갱신 진단의 DB 기록 누락을 추가 수정했다. DB 적용 완료, API 후속 배포 대상. 관련 57/57 및 build 통과. 전체 채널 기능 완료 판정은 아직 아니다. 최신 근거는 [전체 채널 복구 보고서](../../reviews/20260913-all-channel-runtime-repair.md)를 따른다.

## 후속 중앙 통합 — 2026-09-13

독립 4개 작업 완료 이후의 운영 통합은 [전체 채널 실행 복구 기록](../../reviews/20260913-all-channel-runtime-repair.md)을 따른다. 아래 DB/배포 미변경 서술은 독립 작업 당시 범위다.

# 채널 등록과 최종 통합 상태

갱신 시각: 2026-09-13 KST

상태: `completed-local` / `blocked-external`

## R3/R4 후속 수정 결론

- R3 해결: 새 요청은 `product_registration_request_identity_v2`를 명시하고 credential ID/version/fingerprint/environment가 결속된 fingerprint를 사용한다. 배포 전 요청처럼 계약 표식이 없는 요청은 변경 전과 정확히 같은 fingerprint 입력을 사용하므로, 같은 idempotency key로 기존 attempt를 조회한다.
- 호환 경로는 claim을 한 번만 호출한다. 새 hash 실패 뒤 옛 hash를 다시 claim하지 않는다. 현재 claim RPC는 pre-gateway 상태를 재가동하며 `credential_id`를 갱신할 수 있으므로 dual-probe를 조회처럼 사용하는 것은 안전하지 않다.
- R4 해결: `expiresAt`은 현재 시점의 활성/만료 정책 검사에는 남겨 두되 불변 요청 identity에서는 제외했다. 같은 credential의 만료 일정만 연장해도 기존 attempt fingerprint는 바뀌지 않는다.
- 실제 credential 회전은 새 ID/version/fingerprint로 새 v2 fingerprint를 만들며, 과거 key를 강제로 재사용하면 DB mismatch로 409 차단된다. 배포 전 요청의 credential이 이미 grace/revoked/expired라면 claim 전 active-credential 검사에서 차단하고 자동 재결속·provider 재실행을 하지 않는다.
- claim 오류 응답은 `mode: channel_operation_claim_rejected`, `providerWritePerformed: false`, `jobCreated: false`를 명시한다.
- DB schema/migration, 배포, 운영 DB, provider, worker runtime은 변경하지 않았다.

## 로컬 행동 증거

- 실제 `supabase/migrations/20260825104900_resource_bound_gateway_writes.sql`의 `sellerpilot_claim_channel_operation`을 추출해 PGlite 최소 원장에 실행했다.
- R3/R4 집중 검사: 9/9 통과.
  - 변경 전 계약 없는 요청 접수 -> 배포 후 같은 요청/같은 key 재시도: 같은 attempt, provider write 1회, job 1개.
  - 새 v2 요청 반복: 같은 attempt, 추가 provider write/job 없음.
  - `expires_at`만 2030 -> 2031로 연장: 같은 attempt, 추가 provider write/job 없음.
  - credential ID/version/fingerprint 회전, payload/product/target 변경: 409, provider write/job 증가 없음.
  - 같은 key를 다른 channel에서 사용: 기존 attempt에 붙지 않고 별도 channel scope attempt.
  - queued/running: 202 기존 attempt. succeeded: 200 duplicate. reconciliation_required: 409 및 재실행 없음. 미접수 revision: 409 및 attempt/job 0개.
  - provider mutation 시작 뒤 reconciliation_required 재시도: provider write 1회와 job 1개를 그대로 유지.
- 관련 원격 수정 회귀 포함: 19/19 통과.
- 실제 `channel-operations` POST eBay route harness: 1/1 통과.
- 변경 파일 ESLint: 통과.
- 전체 `tsc --noEmit`: 통과.
- `pnpm check:workspace`: 통과.

## 공유 검사 상태

- 후속 중앙 통합에서 숫자 표기 검사를 두 표기 모두 허용하도록 정정했다. drain RPC 기대값과 Qoo10 write 경계 fixture도 함께 수정한 뒤 관련 통합 검사 286/286 및 production build가 통과했다. [통합·DB 안정화 기록](../../reviews/20260913-integration-db-stabilization.md) 참고.

## 외부 미완료

- 이번 결과는 로컬 코드/원장 행동 검증이다. 배포 SHA, 운영 Supabase attempt, 채널별 provider write/readback, 구매자 노출을 확인하지 않았으므로 실제 8채널 등록 완료로 집계하지 않는다.
- 계약 표식 없는 과거 attempt를 **다른 credential로** 자동 복구하는 것은 의도적으로 금지했다. 이를 허용하려면 claim 전에 과거 attempt의 owner, credential ID/version/fingerprint 또는 immutable credential snapshot, request fingerprint, status, gateway job/provider-mutation 경계를 원자적으로 읽는 공유 RPC가 필요하다. 현재 공개 원장은 그 정보를 제공하지 않으며, 이번 지시는 schema 변경을 금지했다.

상세는 [result.md](result.md)에 기록했다.
