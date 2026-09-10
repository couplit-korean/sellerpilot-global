# Temu 외부 worker HTTP 202 수용 시험 v6

- 기준 S0: S0-20260908-decaba426812a3ba
- 중앙 통합 상태: V5 common patch 반영 후 route 8d3c1b41, worker 8bbff073
- 범위: provider 또는 운영 상태를 다시 호출하지 않고 외부 worker의 deferred acknowledgment 수용 경계만 검증
- 공통 원본 수정: 0건

## 확인한 단일 누락

기존 공통 lifecycle 시험은 HTTP 200과 5xx, 전송 유실, 401, 409를 검증하지만 Temu V5가 반환하는 HTTP 202 retry_scheduled를 명시적으로 고정하지 않았다.

새 전용 수용 시험은 실제 scripts/worker-lifecycle-retry.mjs의 requestWithTransientRetry를 import해 다음을 확인한다.

1. HTTP 202 응답은 Response.ok=true로 정확히 한 번만 반환된다.
2. 동일 completion POST의 transient retry delay는 0회다. 서버가 이미 동일 job의 durable retry를 예약했기 때문이다.
3. 응답 본문의 jobCompleted=false, providerReadSucceeded=false, retryScheduled=true가 유지된다.
4. 외부 worker의 실제 wiring이 이 helper를 사용하고 원래 provider 결과 result.ok=false에 따라 채널 원격 실패 로그 분기를 유지한다. HTTP acknowledgment를 provider 성공 로그로 바꾸지 않는다.

## 검증

- 전용 HTTP 202 수용 시험: 1/1 통과
- 기존 worker lifecycle 회귀: 11/11 통과
- 전용 test ESLint: 통과
- provider/API/browser/운영 DB/credential/customer reply 호출: 0회
- commit, push, deploy: 0회

이 시험은 HTTP 202를 운영 완료 증거로 승격하지 않는다. 확인한 것은 외부 worker가 durable retry 예약 acknowledgment를 한 번 수용하고, 같은 실행에서 불필요한 HTTP 재시도를 하지 않는다는 로컬 경계뿐이다.
