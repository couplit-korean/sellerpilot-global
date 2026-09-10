# Temu CS 외부 worker 상세 재시도 v5

- 기록일: `2026-09-08`
- 기준 S0: `S0-20260908-decaba426812a3ba`
- 전용 폴더/브랜치/포트: `/Users/kimchangheemac/dev/sellerpilot-cs-temu` / `codex/cs-temu-v1` / `3218`
- 동결 기준: V1~V4 제출물은 수정하지 않음
- 공통 원본: 읽기만 수행, 직접 수정 0건

## 결론

외부 gateway worker 경로에는 실제 누락이 있었다. provider adapter와 `operations.ts`가 만든 Temu `retryContinuation`은 외부 worker의 failed completion payload에서 버려졌고, route schema에도 해당 DTO가 없었다. 따라서 `POST /api/channel-gateway/worker/complete`는 상세 부분 실패를 기존 generic failed completion으로 종결할 수 있었다.

V5 proposal은 세 공통 파일만 최소 변경한다.

1. 외부 worker가 failed Temu `inquiries.list` 결과의 retry DTO를 completion payload에 보존한다.
2. route schema가 exact queue/count/backoff/status/privacy shape를 검증한다.
3. route가 generic snapshot보다 먼저 기존 v2 durable requeue RPC를 호출한다.
4. 성공 영수증은 HTTP 202 deferred acknowledgment이며 `jobCompleted=false`, `providerReadSucceeded=false`를 명시한다.
5. 동일 POST 재진입은 old claim 그대로 v2 replay 영수증을 받고 generic completion에는 들어가지 않는다.
6. retry exhaustion은 retry DTO 없이 generic failed completion으로 가며 canonical trigger가 `retry_exhausted`로 종결한다.
7. 최종 정상 batch는 parent succeeded, 동일 완료 replay에서 continuation child duplicate 0을 유지한다.

## 실제 POST fixture 결과

최신 통합본을 환경파일 없이 격리 복제한 `/tmp/temu-v5-final.jg9VJm`에 V5 patch를 적용했다. transpile한 실제 `app/api/channel-gateway/worker/complete/route.ts`의 `POST` export를 가짜 Supabase RPC에 연결해 요청을 실행했다.

- V5 전용: 6/6 통과
- 첫 retry POST: v2 requeue RPC 1회, generic context/completion 0회, HTTP 202, provider success false
- 첫 HTTP 응답 유실 후 동일 POST: 같은 token hash/job/claim/DTO 인자, `replayed=true`, retry count 추가 소비 0
- claim/lineage 40001: HTTP 503, generic completion 0회
- 3회 소진: retry RPC 0회, generic failed completion 1회, canonical `retry_exhausted` trigger 확인
- 최종 정상 완료 재전송: parent succeeded, 정규화된 detail revision 2건 모두 unique, continuation child duplicate 0

## 외부 상태 경계

- 실제 Temu provider 목록 read: 0회
- 실제 Temu provider 상세 read: 0회
- provider mutation, 환불, 실고객 답변: 0회
- 운영 DB 변경, credential 변경, 배포, commit, push: 0회
- 이번 V5에서 Partner app/compliance/seller 상태는 다시 조회하지 않았다. 이전 보고의 외부 승인 상태를 현재 확정 상태로 재진술하지 않는다.
- Buyer Chat은 이 변경 범위가 아니며 공식 계약/권한 부재 상태의 미구현 경계를 유지한다.

## 제출물

- `docs/cs-parallel/proposals/temu/005-external-worker-detail-retry.md`
- `docs/cs-parallel/proposals/temu/patches/temu-007-external-worker-detail-retry.patch`
- `docs/cs-parallel/proposals/temu/tests/temu-007-external-worker-detail-retry.test.ts`
- 이 폴더의 `integration-preimages.md`, `test-evidence.md`, `delta.json`

