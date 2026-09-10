# Temu 외부 gateway worker 상세 재시도 변경안

- 목적: 외부 `scripts/ai-cli-worker.mjs`가 Temu after-sales 상세 부분 실패를 `/api/channel-gateway/worker/complete`로 보낼 때, 실패가 일반 완료로 확정되거나 retry DTO가 소실되지 않고 기존 v2 durable retry/replay RPC를 통과하게 한다.
- 기준 S0: `S0-20260908-decaba426812a3ba`
- 기준 통합본 관측 시각: `2026-09-08T23:56:04+09:00`
- 동결 범위: 기존 V1~V4 proposal, patch, SQL, test, report는 수정하지 않는다.
- 공통 수정 후보: `lib/channels/gateway-contract.ts`, `scripts/ai-cli-worker.mjs`, `app/api/channel-gateway/worker/complete/route.ts`
- 전용 제출: `patches/temu-007-external-worker-detail-retry.patch`, `tests/temu-007-external-worker-detail-retry.test.ts`

## 확인된 누락

1. `executeChannelOperation`은 실패 결과에 `retryContinuation`을 붙이지만 외부 worker의 failed completion payload는 `error`만 보내므로 DTO를 버린다.
2. 공통 `gatewayWorkerCompletionSchema`의 failed variant에 해당 필드가 없어 임의로 payload에 넣어도 parsing 과정에서 제거된다.
3. 완료 route는 먼저 generic completion context를 읽고 generic completion RPC로 failed를 확정한다. durable retry RPC가 첫 요청을 commit한 뒤 HTTP 응답이 유실되어 old claim으로 같은 POST가 재진입하면, generic snapshot 선행 구조로는 queued job의 v2 replay receipt를 받을 수 없다.

## 최소 변경

1. failed Temu `inquiries.list`에만 retry DTO를 전달한다. queue identity/count, 5/10/20초 backoff, provider status allowlist, 총 200건 제한, 내부 pagination marker와 연락처/주소 계열 key 제외를 route schema에서 먼저 검사한다.
2. failed+retry payload는 generic completion snapshot 전에 `sellerpilot_service_requeue_temu_after_sales_detail_v2`를 호출한다. 이 RPC가 active gateway token, job, claim, lease, Temu read-only operation, credential, scope, queue lineage와 replay fingerprint를 원자적으로 검증한다.
3. 예약 성공 응답은 HTTP `202`와 `completionStatus=retry_scheduled`, `jobCompleted=false`, `providerReadSucceeded=false`를 반환한다. 이는 worker의 저장 acknowledgment일 뿐 provider read 성공이나 parent completion이 아니다.
4. 첫 DB commit 후 완료 HTTP 응답이 유실되어 같은 POST가 다시 오면 snapshot을 거치지 않고 v2 RPC의 `replayed=true` 영수증을 받는다.
5. 3회 실패 후에는 adapter가 retry DTO를 만들지 않으므로 기존 generic failed completion으로 진행한다. 이미 통합된 DB trigger가 retry count 3을 `retry_exhausted`로 종결한다.
6. 이후 정상 상세 batch는 기존 generic succeeded completion과 completion fingerprint/continuation periodic key dedupe를 그대로 사용한다. parent는 succeeded가 되고 동일 완료 재전송의 child 중복은 0이다.

## 통합 조건

- patch preimage hash가 `integration-preimages.md`와 일치하거나 patch가 현재 통합본에 clean apply되는지 확인한다.
- 이미 반영된 `20260908140414_cs_temu_durable_detail_retry.sql`, `20260908140416_cs_temu_detail_retry_replay.sql`, `lib/channels/cs/temu/retry-rpc.ts`가 먼저 존재해야 한다.
- 새 SQL은 필요 없다. 이 제출은 기존 v2 RPC를 외부 worker POST entrypoint에 결속한다.
- 공통 원본 직접 수정, 운영 DB 적용, provider/credential 사용, 고객 답변 전송은 이 제출에 포함하지 않는다.

