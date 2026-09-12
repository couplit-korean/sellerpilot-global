# 3번 · CS 수집·저장과 로컬 실행 복구

상태: `completed-local / blocked-external` (2026-09-13 02:43 KST)

- 고아 중복 supervisor PID `42249`만 runtime 잠금 아래 종료했다. 정상 launchd supervisor PID `30270`과 gateway PID `30285`, 당시 처리 중 작업 1개는 재시작·재등록하지 않았다. `/readyz`의 `activeGatewayJobs`는 일시 0을 거쳐 마지막 확인에서 다시 1이며, 같은 작업인지 새 claim인지와 결과는 DB 권한 거부로 미확인이다.
- 정상 gateway는 Production 고정 SHA `fd426cc588f03c1e187b689141018b6de4a38eca`, cwd `~/dev/sellerpilot-worker`, Node 22, 8081을 유지한다. 02:42 KST 확인에서 `/healthz`와 `/readyz`는 HTTP 200/ready, `activeGatewayJobs:1`, scheduler/periodic sync는 false다. ready 회복은 queue 접촉 성공이지 completion 저장 성공 증거는 아니다.
- C1: supervisor 소스 잠금을 macOS `lockf` kernel lock으로 바꿨다. PID 기록 전 경쟁 창과 stale PID cleanup 의존을 없애고, legacy PID는 시작시각·명령 identity를 확인해 살아 있는 supervisor/불명 상태는 보존하며 unrelated PID 재사용은 signal 없이 구분한다. 실제 동시 프로세스·owner 기록 지연·초기화 중 사망·stale 경합·PID 재사용 검사가 통과했다. 실행 중 gateway에는 후속 소스를 설치하지 않았다.
- C2: draft completion 503 뒤 heartbeat 409가 와도 동일 completion endpoint가 `replayed`/lease conflict를 판정하도록 동일 payload replay를 계속한다. 미커밋 503·연속 5xx·다른 claim token·완료 전 실제 lease 상실을 분리했고, gateway completion에도 같은 안전 경계를 적용했다. 새 생성·provider 재전송·실패 payload 덮어쓰기는 없다.
- C3: LaunchAgent plist가 같고 이미 loaded면 멱등 no-op, 변경됐는데 loaded/running/상태 불명이면 중단 없는 defer, label이 명확히 unloaded일 때만 bootstrap하도록 바꿨다. `kickstart -k`를 제거했다. 현재 plist는 동일하고 PID `50446`은 running이지만 job 상태는 미확인이므로 worker 후속 소스는 설치하지 않았다.
- F3: 실제 fetch wrapper에서 raw `TypeError('fetch failed')`와 개별 30초 request timeout을 status 0의 제한된 transient 오류로 정규화했다. 완료 여부가 불확실하면 이미 만든 정확한 completion payload만 최대 8회 재전송하고 생성/provider 전송은 반복하지 않는다. caller/SIGINT signal, 전체 job 10분 deadline, 완료 전 실제 lease loss, 401/403/409, 알 수 없는 오류는 재시도하지 않고 원래 terminal 경계를 유지한다.
- 운영 503은 현재 읽을 수 있는 Vercel request log 범위로만 판정했다. 02:35:04~02:40:04 KST draft 요청 2건은 모두 503이었다. 02:33:23~02:42:32 KST gateway completion 최근 50개 request pair 중 49개는 503, 1개는 200이었다. `/readyz`는 02:42에 200으로 회복했지만 completion 503은 같은 시각까지 지속됐다. 현재 로그에는 SQLSTATE·timeout·connection 원인이 없으므로 특정 RPC나 DB 전체 장애로 확정하지 않는다.
- `app/api/cs/worker/drafts`에는 배포 전 진단용으로 phase, RPC명, 정제된 SQLSTATE/코드, HTTP 상태, 경과시간만 기록하도록 추가했다. 고객 원문·토큰·job ID·Supabase message/details/hint는 기록하지 않는다. 소스만 변경했고 배포하지 않아 현재 운영 원인은 아직 확인되지 않는다.
- 후속 집중 검사 35/35, ESLint, `tsc --noEmit --incremental false`, `git diff --check`가 통과했다. 앞선 채널 확대 검사의 범위 밖 알려진 실패는 수정하거나 성공으로 계산하지 않았다.

Git add/commit/push, Vercel 배포·환경변수 변경, DB 스키마·migration 적용, 고객 답변 전송은 하지 않았다. 자세한 변경·검증·8채널 경계는 `result.md`에 있다.
