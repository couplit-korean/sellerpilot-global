# CS·로컬 실행 장애 복구 결과

작성 시각: 2026-09-13 02:43 KST\
작업 위치: `/Users/kimchangheemac/dev/sellerpilot-app`\
상태: `completed-local / blocked-external`

## 결론

로컬에서 해결할 수 있는 중복 supervisor, 완료 응답 유실, CS LaunchAgent 재설치 경계는 C1~C3와 F3 재현까지 포함해 수정했다. F3는 실제 fetch wrapper의 raw network failure와 개별 request timeout을 완료 불확실성으로 분류하되, 생성이나 provider 전송 없이 동일 completion payload만 제한적으로 재시도한다. 운영에서는 draft와 gateway completion 503이 현재도 관측되지만 `/readyz`가 200으로 회복하는 구간도 있어 DB 전체 장애로 확정할 수 없다. 현재 Vercel log에는 SQLSTATE·timeout·connection 원인이 없고 Supabase SQL 권한도 없어 정확한 DB error code·RPC 실행시간은 미확인이다. gateway·draft worker를 kill·재등록·재설치하거나 고객 답변을 재전송하지 않았다.

## 실행 상태 전후

| 항목 | 변경 전 | 변경 후 |
| --- | --- | --- |
| 정상 gateway supervisor | PID 30270, launchd `com.sellerpilot.channel-gateway` | 유지, 재시작하지 않음 |
| gateway worker | PID 30285, PPID 30270, cwd `~/dev/sellerpilot-worker` | 유지, 재시작하지 않음 |
| 배포 결속 | release file와 runtime HEAD 모두 `fd426cc588f03c1e187b689141018b6de4a38eca` | 동일 |
| gateway 작업 | `activeGatewayJobs:1` | 일시 0 관측 후 마지막 확인에서 1. 같은 작업인지 새 claim인지와 channel/operation/provider 결과는 DB 권한 거부로 미확인 |
| gateway health | 8081 `/readyz`가 ready/degraded 변동, `/healthz`는 생존 | 02:42 KST `/healthz`, `/readyz` 모두 HTTP 200/ready, `activeGatewayJobs:1`. completion 저장 성공은 별도 미확인 |
| 고아 supervisor | PID 42249, PPID 1, cwd `~/dev/sellerpilot-worker`, URL 누락으로 재시작 반복 | exact PID/PGID 검증 뒤 종료. 기존 로그는 01:05 KST 이후 증가하지 않음 |
| supervisor 재발 방지 | mkdir 성공과 PID 쓰기 사이 경쟁, degraded `/readyz`를 프로세스 부재로 오인 가능 | 소스는 kernel `lockf`, legacy identity 확인, 명시적 URL, `/healthz` 감시. 실행본은 작업 보호를 위해 미설치 |
| CS 초안 worker | 별도 상주 프로세스 없음 | 기존 설치 LaunchAgent PID 50446 유지. plist 동일, 후속 worker 소스는 작업 상태 미확인으로 미설치 |
| CS 초안 원장 | 미확인 | claim 단계 `ledger_rpc`, HTTP 503. 최대 5분 backoff, 생성/발송 없음 |

## 원인 분리

### 중복 supervisor

고아 PID 42249는 현재 launchd label의 PID가 아니었고 provider worker 자식도 없었다. `/Users/kimchangheemac/dev/sellerpilot-worker-runner.sh`를 PPID 1에서 실행하며 URL이 없는 자식을 10초마다 만들었다. 기존 runner는 readiness URL이 503이면 이미 살아 있는 worker도 없는 것으로 판단했고 프로세스 단일 잠금도 없었다.

수정한 runner는 다음을 보장한다.

- `SELLERPILOT_URL`이 명시되지 않으면 fetch/checkout/worker 재시작 전에 종료한다.
- `SELLERPILOT_GATEWAY_HEALTH_PORT`와 `SELLERPILOT_WORKER_HEALTH_URL`을 일관되게 사용한다.
- supervisor 판단에는 `/healthz`만 사용하고 `/readyz` 503은 DB/queue degraded 상태로 남긴다.
- macOS `lockf`가 열린 FD의 kernel lock을 supervisor 생존 동안 보유한다. owner metadata 쓰기 전에도 두 번째 프로세스는 진입하지 못하고, 프로세스 사망 시 kernel이 잠금을 해제하므로 stale PID 파일 회수에 소유권을 맡기지 않는다.
- 이전 runner의 legacy PID는 현재 프로세스 명령 identity를 확인한다. 살아 있는 정상/불명 프로세스는 보존하고, unrelated live PID 재사용은 signal 없이 stale metadata로만 구분한다. 신선한 PID 없는 legacy 디렉터리는 초기화 grace 동안 회수하지 않는다.

실제 프로세스 검사로 동시 시작, kernel lock 후 owner 기록 2초 지연, owner 기록 전 사망과 재획득, 오래된 PID 없는 legacy lock의 두 회수자 경합, 살아 있는 unrelated PID 재사용을 검증했다. 단순 source 문자열 검사가 아니다.

### gateway CS 완료 저장 503

현재 Production release의 worker 로그에서 `CS 결과 저장 실패` HTTP 500/503과 동일 payload 재시도가 확인됐다. 같은 deployment의 gateway queue 접촉은 HTTP 200을 다시 반환했으므로 전체 `SELLERPILOT_URL`/worker token/필수 Vercel 설정 누락으로 설명되지는 않는다. 완료 route 내부 Supabase snapshot/정규화/완료 RPC 중 하나의 503이지만 Vercel runtime log와 Supabase SQL 조회가 모두 권한 거부라 정확한 함수는 확인하지 못했다.

기존 `processCsGatewayJob`은 heartbeat를 끈 뒤 최대 10분 완료 저장을 재시도했다. DB 지연 중 lease가 만료될 수 있고, 저장 재시도 자체가 실패하면 이미 얻은 provider 결과를 새 실패 payload로 바꿀 수 있었다. 수정 후에는 heartbeat를 유지한 채 동일 완료 payload만 재시도한다. 첫 completion이 commit되고 응답만 유실된 뒤 heartbeat 409가 와도 동일 completion replay가 최종 권한을 판정한다. 완료 저장 단계에 들어간 뒤에는 provider 실행으로 돌아가지 않고, provider 답변 수락 가능성이 있으면 `reconciliation_required`를 유지한다.

CS draft의 F3 경계도 같은 원칙을 적용한다. production fetch wrapper에서 raw `TypeError('fetch failed')`는 `network_failure`, 개별 request timeout은 `network_timeout`으로 status 0에 정규화한다. 이 두 경우와 5xx만 최대 8회의 동일 completion replay 대상이다. 각 시도 사이 lease heartbeat를 유지하고, 결과 object와 JSON payload를 다시 만들지 않는다. caller cancel과 SIGINT/SIGTERM stop signal은 원래 abort reason을 그대로 전파하며, 전체 job 10분 deadline, 완료 전 lease loss, 401/403/409, 임의의 알 수 없는 Error는 즉시 terminal 처리한다.

### CS 초안 503

별도 초안 worker는 기존 Keychain의 scoped AI worker identity를 사용해 정상 기동했다. 서버 응답을 안전한 고정 분류로 기록하도록 바꾼 결과 오류는 다음과 같다.

```text
phase: claim
category: ledger_rpc
status: 503
```

따라서 URL/Node/Keychain 신원이나 route의 필수 server configuration 누락이 아니다. 인증 scope 오류도 route 계약상 401이어야 하므로 현재 503과 다르다. 기존 Vercel CLI 인증으로 올바른 team/project와 Production `fd426cc`의 runtime log를 현재 조회했다. 과거 01:39:15~01:57:24 KST에는 여러 route의 503이 함께 보였고, 최신 10분 범위에서는 02:35:04~02:40:04 draft 2건이 모두 503, 02:33:23~02:42:32 gateway completion 최근 50개 request pair 중 49개가 503이고 1개가 200이었다. 같은 02:42 KST 로컬 `/readyz`는 HTTP 200이므로 queue 접촉과 completion 저장은 분리해 봐야 한다. 이 관측만으로 특정 draft RPC 누락, 단일 DB 연결 문제, DB 전체 장애 중 하나를 확정하지 않는다.

Vercel에는 URL·publishable·secret 세 환경 키가 Production에 존재하며, route는 실제로 `ledger_rpc` 고정 오류까지 도달한다. 다만 sensitive 값은 CLI에서 `[SENSITIVE]`로 보호되어 직접 PostgREST introspection에 재사용할 수 없었고, Supabase 연결 SQL 권한은 앞서 거부됐다. 현재 배포 route는 Supabase error code를 로그에 남기지 않으므로 RPC 존재/인자/EXECUTE 권한·SQLSTATE·실행시간은 운영 DB에서 최종 확인하지 못했다. 환경값 원문이나 고객 원문은 출력하지 않았다.

후속 소스의 draft route에는 실패 시 `phase`, RPC 함수명, 영숫자/underscore로 제한한 32자 이하 SQLSTATE/코드, HTTP 상태, 경과시간만 남기는 로그를 추가했다. Supabase `message`, `details`, `hint`, token, job/claim ID, 고객 원문은 기록하지 않는 실제 route 호출 테스트가 통과했다. 이 소스는 배포하지 않았으므로 현재 운영 log가 새 진단 정보를 제공한다고 주장하지 않는다.

CS 초안 worker는 고객 답변 전송 API를 호출하지 않는다. claim → 관리자 검토용 초안 생성 → 동일 결과 저장만 수행하고, 원장 503에서는 생성 전에 멈춘다. 연속 실패 시 15초, 30초, 60초, 이후 최대 5분으로 backoff한다.

완료 단계에서는 503 뒤 heartbeat 409를 즉시 lease abort로 바꾸지 않는다. 동일 completion payload를 다시 보내면 DB 함수가 같은 claim/result일 때 `replayed`, 다른 claim token·실제 lease 상실이면 HTTP 409를 반환한다. committed+lost response, 미커밋 503, 연속 5xx, 완료 후 heartbeat 409, 다른 claim token, 완료 전 실제 lease 상실을 각각 검증했고 generation은 항상 최대 1회였다.

### CS LaunchAgent 재설치

plist가 완전히 같고 label이 loaded면 설치는 멱등 no-op이며 `bootout`/`kickstart`를 호출하지 않는다. plist가 바뀌었는데 label이 running이거나 PID 없는 loaded/unknown 상태면 설치를 defer하고 기존 프로세스를 중단하지 않는다. label이 명확히 unloaded일 때만 plist를 교체하고 bootstrap하며, `kickstart -k`를 사용하지 않는다. mock command 검사로 no-op/defer에는 launchctl mutation이 0회이고 unloaded 설치에만 bootstrap과 비파괴 kickstart가 실행됨을 확인했다.

현재 설치 plist는 생성 결과와 동일하고 PID 50446은 running이다. 어떤 job인지 확인되지 않아 follow-up `cs-draft-worker.mjs` source/runtime SHA는 다른 상태로 남겼으며 실제 runtime 파일 복사나 LaunchAgent 재시작을 하지 않았다.

## 8채널 CS 경계

아래의 “현재 실제 확인”은 이번 실행에서 provider/운영 원장 readback이 있었는지를 뜻한다. 코드 구현·테스트 통과를 실제 수집으로 표시하지 않았다. Vercel runtime log는 route별 503을 확인했지만 Supabase 원장과 provider payload readback 권한은 없어 8개 채널 모두 현재 provider 수집 건수와 마지막 완료 시각은 미확인이다. 원장 0건도 고객 문의 0건 증거로 사용하지 않는다.

| 채널 | 지원 수집 종류 | 현재 실제 확인 | 답변 지원 | 막힌 지점 |
| --- | --- | --- | --- | --- |
| 쿠팡 | 상품 문의, 고객센터, 반품, 취소, 교환 | provider/DB readback 미확인 | 상품 문의·고객센터 조건부 지원, 클레임 답변 mutation 미지원 | Mac scheduler OFF. Vercel static-egress DB 허용·최근 실행을 조회하지 못함 |
| 스마트스토어 | 상품 문의 `questionId`, 네이버페이 고객 문의 `inquiryNo` | provider/DB readback 미확인 | 두 문의 유형 조건부 지원 | 상품/고객 namespace를 분리 유지. Vercel egress·계정별 실행 상태 미확인 |
| 11번가 | Product Q&A, 긴급알리미 고객 문의, 긴급알리미 시스템 알림 | provider/DB readback 미확인 | Product Q&A 답변 지원, 긴급알리미 답변 미개방 | 운영 Key/고정 IP 원격 조회 미확인. 시스템 알림을 고객 대화로 세지 않음 |
| Qoo10 | MSG·HELP·ITEM 문의·이력, 취소·반품·교환 클레임 | provider/DB readback 미확인 | 일반 문의 답변 지원, 클레임 답변 미지원 | review export/Buyer Chat 공식 계약·계정 결속 미확인 |
| Shopee | 상품 후기, 반품·환불, 별도 Buyer Chat push/history | provider/DB readback 미확인 | 후기 답변 지원, Buyer Chat 답변은 permission pending | 앱 live push·SellerChat history/send-message 권한과 실제 callback readback 없음 |
| Lazada | IM, IM 카드, 별도 상품 리뷰·판매자 답변 경로 | provider/DB readback 미확인 | IM·상품 리뷰 조건부 지원 | CS Bot app/token grant, 계정·국가 결속, 실제 readback 미확인 |
| eBay | ASQ 상품 문의, Trading Inbox 회원 메시지, 시스템 메시지, Commerce Message, 케이스·분쟁 | provider/DB readback 미확인 | ASQ·Commerce Message 조건부 지원, mailbox/system/case 답변 미개방 | commerce.message scope와 계정/site 결속, 케이스 자동수집 완료 미확인 |
| Temu | after-sales 반품·환불, 별도 Buyer Chat | provider/DB readback 미확인 | 답변 전부 미지원 유지 | Partner 앱·공식 Buyer Chat 계약/권한 미확인. after-sales 읽기도 최근 원격 readback 없음 |

Mac gateway는 명시적으로 `--no-scheduler`이며 health의 `periodicChannelSync:false`를 확인했다. launchd에 static-egress 채널 목록이 있어도 로컬 주기 수집이 실행된다는 뜻은 아니다. Vercel project/runtime log 읽기는 성공했지만 DB의 채널별 static-egress 허용 상태는 확인하지 못했다.

## 변경 파일

- `deploy/channel-gateway-runner.sh`: URL/Node/health 정합성, liveness 감시, 단일 supervisor lock.
- `scripts/cs-gateway-job.mjs`: heartbeat 유지, 동일 completion replay, 결과 재분류/재전송 차단.
- `scripts/cs-draft-worker.mjs`: completion 중 lease 갱신, 동일 초안 재시도, 안전한 503 단계 분류, 지수 backoff.
- `app/api/cs/worker/drafts/route.ts`: 비민감 RPC 실패 진단 필드 추가.
- `scripts/cs-draft-worker-launch-agent.mjs`: 기존 설치 runtime을 사용하는 별도 CS 초안 LaunchAgent 설치/상태 확인.
- `lib/cs/capability-inventory.ts`: Lazada 상품 리뷰와 eBay 회원/시스템 메시지 표면을 분리하고 답변 가능 범위를 명시.
- `tests/cs-runtime-task/completion-retry.test.mjs`
- `tests/cs-draft-api-flow.test.mjs`
- `tests/cs-draft-worker.test.mjs`
- `tests/cs-runtime-task/runner-and-launch-agent.test.mjs`
- `tests/cs-runtime-task/channel-capability-boundaries.test.ts`
- `docs/parallel-tasks/cs-runtime/status.md`
- `docs/parallel-tasks/cs-runtime/result.md`

첫 작업 때 운영 설치에는 당시 `scripts/cs-draft-worker.mjs` 한 파일과 `~/Library/LaunchAgents/com.sellerpilot.cs-draft-worker.plist`만 반영했다. 이번 C1~C3/F3 follow-up source는 실행 중 작업 상태가 미확인이므로 설치하지 않았다. `product-ai-worker.mjs`, 이미지 생성 소스, AI worker plist/runtime 전체, gateway release pin은 복사·교체하지 않았다.

## 검증

통과:

- `pnpm check:workspace`
- C1~C3/F3 새 재현 + 기존 핵심 흐름: 35/35
  - supervisor URL/kernel lock/liveness와 실제 프로세스 경합·사망·stale/PID reuse
  - gateway 완료 503 뒤 heartbeat conflict의 동일 payload replay
  - CS draft committed response loss, 미커밋/연속 5xx, 다른 claim, 실제 lease 상실
  - 실제 fetch wrapper raw `TypeError('fetch failed')`, 개별 request timeout, caller cancel, 전체 job deadline, unknown error terminal 경계
  - draft route 비민감 진단 로그와 민감 message/details/token/job ID 비노출
  - LaunchAgent unchanged no-op, loaded defer, unloaded-only install mock
  - admin API → 격리 SQL queue → worker API → draft → SQL 저장/readback
  - CS/상품 provider isolation
- C1/C2 직접 후속 검사: 16/16
- `pnpm exec eslint` (수정 파일과 새 테스트만)
- `pnpm exec tsc --noEmit --incremental false`
- `git diff --check`
- 8채널 확대 검사: 208개 중 202개 통과
- LaunchAgent running, PID 50446. plist 동일, follow-up source/runtime SHA는 미설치로 불일치

확대 검사 6개 실패는 이번 변경과 구분했다.

1. `tests/cs-qoo10-history-runtime.test.ts`: Node 직접 실행에서 `server-only` package resolve 실패. Qoo10 구현 assertion 전 import 환경 실패.
2. `tests/serverless-cs-gateway.test.ts`: publication review RPC 호출 기대 1개 실패. 공용 serverless 조립부/상품 release 경계이며 이 lane 소유가 아니다.
3. 같은 파일의 shipping setup mutation-boundary 기대 4개 실패: `LISTING_SHIPPING_CONFIRMATION_REQUIRED`, `COUPANG_SHIPPING_FEE_CONFIRMATION_REQUIRED`, `SMARTSTORE_SHIPPING_POLICY_CONFIRMATION_REQUIRED`, `QOO10_UPDATE_SHIPPING_UNVERIFIED`의 예상 `reconciliation_required`와 실제 `failed` 불일치. CS reply/초안 수정 경로가 아니며 기대값을 바꾸지 않았다.

## 외부 미완료

- 운영 Supabase의 draft claim/touch/complete RPC 존재·인자·EXECUTE 권한·SQLSTATE·실행시간과 gateway completion RPC의 정확한 DB error 확인. 새 진단 로그는 배포되지 않았다.
- 마지막 health에서 실행 중인 gateway 작업 1개의 channel/operation/provider 결과/lease/완료 저장 최종 readback. health 작업 수의 일시적 0/1 변화만으로 provider 성공이나 동일 작업 여부를 판정하지 않는다.
- Vercel runtime log는 draft와 completion의 현재 503까지 확인했지만 배포 route가 Supabase error code를 기록하지 않아 정확한 RPC/SQLSTATE 확인이 남았다. DB 전체 장애로 확정하지 않는다.
- 8채널별 최신 provider 수집, pagination 완료, 원장 투영, 답변 remote readback.
- 로컬 source의 C1/C2/C3/F3 변경을 검토 후 Production SHA/runtime에 적용. 현재 `activeGatewayJobs:1`이고 draft job 상태도 미확인이므로 release pin·gateway·draft worker를 그대로 유지했다.

고객 답변, 상품 CREATE, 발송/송장 등록, queue 재등록, DB migration, Vercel 배포는 실행하지 않았다.
