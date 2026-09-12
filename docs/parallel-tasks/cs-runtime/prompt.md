이 채팅은 사용자가 명시적으로 요청한 네 개 독립 구현 작업 중 하나다. 모델은 gpt-5.6-sol, reasoning high다. 계획이나 재검토 보고만으로 끝내지 말고, 아래 자신의 문제를 이 채팅 안에서 구현·검증·결과 정리까지 계속 수행하라.

[최우선 사용자 지시]
- 다른 채팅과 메시지를 주고받거나 일을 넘기지 않는다. send_message_to_thread, read_thread, wait_threads, list_threads, collaboration 도구, subagent, 새 작업 생성, fork, handoff를 사용하지 않는다. 다른 작업의 status/result 파일을 조회하거나 그곳에 요청을 작성하지 않는다. 기존 문서의 '다른 담당에게 요청/기다림/통합' 문구보다 이 지시가 우선한다.
- 자기 소유 파일만 수정한다. 타 소유 파일, 공용 계약을 바꿔야 하는 경우에는 호환되는 자기 모듈 안의 방법을 먼저 찾는다. 불가능한 경계는 자기 최종 결과에 정확한 파일·필요한 변경·남은 검증으로 기록하고, 자신의 다른 해결 가능한 작업을 계속 완료한다. 다른 작업의 응답을 기다리지 않는다.
- 추가 채팅/프로젝트 복사본/clone/worktree/임시 체크아웃을 만들지 않는다. Git 브랜치를 바꾸거나 새로 만들지 않는다. 모든 실제 개발 명령은 아래 통합 경로에서만 실행한다.

[실제 작업 위치와 먼저 읽을 문서]
앱이 표시하는 프로젝트 경로가 옛 Documents여도 첫 파일/셸 작업부터 workdir=/Users/kimchangheemac/dev/sellerpilot-app 을 명시하라. 옛 Documents, dev/sellerpilot, 아카이브, .codex/worktrees에서 개발하지 마라.
1. /Users/kimchangheemac/dev/sellerpilot-app/AGENTS.md
2. /Users/kimchangheemac/dev/sellerpilot-app/docs/parallel-tasks/INDEPENDENT-RUN.md
3. /Users/kimchangheemac/dev/sellerpilot-app/docs/parallel-tasks/ownership.json
4. /Users/kimchangheemac/dev/sellerpilot-app/docs/채널-CS-이미지-연동검토-20260913.md
5. 자신의 docs/parallel-tasks/cs-runtime/prompt.md
Documents의 Git 탐색을 하지 말고 통합 경로에서 pwd -P, git status --short --branch, git log -3 --oneline을 읽어 현재 상태를 확인한다. git diff는 자신이 수정할 구체적 파일을 지정해 확인한다. 전체 작업 폴더와 모든 옛 문서를 재감사하지 마라.

[이미 끝난 작업: 다시 하지 말 것]
- 개발 소스 /Users/kimchangheemac/dev/sellerpilot-app 단일화와 iCloud 실행 의존성 차단.
- 57bc85f 전역/프로젝트 지침, 1aa6afb 채널·CS·이미지 검토, 237c0b2 네 작업 준비.
- app/page.tsx에서 use-first-draft-images.ts와 first-draft-image-review.tsx 추출, ownership.json과 parallel-workspace.mjs 준비.
- 준비 당시 관련 81개 테스트, tsc --noEmit --incremental false, Vercel 호환 Next build 통과. 상품↔CS↔배송 금지 참조 6방향 0개.
- 이미지 주요 코드가 당시 운영 fd426cc 및 Mac 설치본과 일치한다는 비교. '옛 파일을 다시 가져오기'나 전체 재통합은 해결책이 아니다.
- output/pdf/는 다른 사용자 작업의 산출물이다. 수정·삭제·추적·정리하지 않는다.
이 준비는 기능 결함의 해결을 의미하지 않는다. 현재 함수/파일이 이미 수정돼 있으면 변경 근거와 실제 동작을 확인하고 같은 일을 반복하지 않는다. 이력이 확인되지 않은 과거 성공 기록은 현재 성공으로 사용하지 않는다.

[공통 충돌 방지]
- 편집할 정확한 파일마다 node scripts/parallel-workspace.mjs check cs-runtime FILE... 로 소유권을 확인한다. ownership.json, AGENTS.md, 공유 README, 공용 현황 문서는 바꾸지 않는다. 자신의 prompt.md는 작업 명령이므로 수정하지 않는다.
- 이 독립 실행 동안 어느 작업도 git add/commit/push/reset/stash/checkout/merge, 공용 lockfile/dependency 갱신, 전체 포매팅, Vercel 배포/환경변수 변경, 공용 DB 스키마 변경을 하지 않는다. 변경은 원래 파일에 남기고 자신의 결과 문서에 목록을 정확히 적는다. 최종 통합·운영 적용은 이 네 작업 이후의 별도 단계다.
- asset IDs, API/RPC 이름, jobId/claimToken, 원본 hash, 승인/계정 결속, 기존 응답 schema를 깨지 않는다. 권한·릴리스·중복 등록·원본 보존 가드를 끄지 않는다.
- Node 22: /Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node. 필요한 경우 해당 bin과 /Users/kimchangheemac/Library/pnpm을 PATH 앞에 추가한다. 재설치하지 않는다.
- Next UI/API 코드를 쓰기 전 설치된 node_modules/next/dist/docs/의 관련 문서를 읽는다. Supabase/Vercel 작업은 관련 skill을 적용하되 사용자 승인 범위 안의 조회/수정을 반복 확인받지 않는다.
- 기본 검증은 node --import tsx --test 정확한-관련-테스트-파일. pnpm test는 내부 build가 있으므로 병행 단위 검사에 쓰지 않는다.
- Next dev/build/타입 생성은 node scripts/parallel-workspace.mjs run cs-runtime next -- COMMAND ... 잠금을 사용한다. 잠금이 차 있으면 다른 자기 작업을 먼저 진행하고, 새 포트/출력 폴더/직접 명령으로 우회하지 않는다. 서버를 계속 켜두고 작업을 끝내 잠금을 점유하지 않는다.
- 각자의 소스가 변경되는 동안 전체 build를 통합 완료 근거로 삼지 않는다. 타입 검사 시 --incremental false를 사용한다. 다른 작업의 오류를 자기 성공으로 덮거나 타 담당 파일을 고치지 말고 범위를 기록한다.
- 기존 전체 테스트 실패를 이번 회귀와 구분한다. 앞선 관련 58개 검사에는 운영 기준에서도 같은 4개 실패(local whitelist, Shopee continuation 2개, Qoo10 guard 기대값)가 있었다. 실패를 감추려고 기대값만 바꾸지 않는다.
- 판매자 계정/상품/문의가 지정되지 않은 실제 CREATE, 고객 답변 전송, 발송/송장 등록은 검증용으로 임의 실행하지 않는다. HTTP 202, 큐 접수, Online, 코드 구현을 실제 외부 완료로 표시하지 않는다. 인증이 막혀도 가능한 구현/단위 검증을 계속하고 정확한 외부 미검증 범위를 남긴다.
- 3번만 기존 Mac 설치/프로세스 제어를 runtime 잠금으로 수행할 수 있다. 작업 중인 다른 소스를 설치본으로 복사하거나 승인 없이 배포 SHA를 변경하지 않는다.

[한 채팅에서 마칠 기준]
요구사항별 현재 구현 확인 → 자기 소유 파일의 최소한의 수정 → 실제 오류/회귀를 잡는 집중 검사 → 검증 결과/남은 외부 적용을 정리한다. 문서만 고치고 구현 완료라고 하지 않는다. 자기 범위를 끝내면 다른 담당으로 범위를 넓히지 말고 같은 채팅의 사용자에게 완료 보고한다.
자신의 docs/parallel-tasks/cs-runtime/status.md와 result.md만 갱신한다. 상태는 completed-local 또는 blocked-external 등 의미를 정확히 적고, 변경 파일 목록, 해결한 재현 조건, 실행한 검사와 통과/실패, 아직 배포/설치/공식 조회하지 못한 항목을 구분하라. 다른 작업에 요청하는 문구나 작업 인계 메시지를 쓰지 마라. 수행 중에는 60초 이상 사용자 설명 없이 방치하지 말고 핵심 진행 상황을 간결하게 알려라.

[이 작업의 유일한 목표: CS·로컬 실행의 확인된 장애 복구]
소유 lane은 cs-runtime이다. 핵심 소유 파일:
- lib/cs/, lib/channels/cs/, 문의·답변 정규화 파일
- app/cs/, app/api/cs/, app/api/admin/cs/, support-reply
- scripts/cs-*.mjs, scripts/channel-gateway-worker.mjs, scripts/ai-cli-worker.mjs
- scripts/persistent-worker-health.mjs, scripts/install-ai-worker-launch-agent.mjs
- deploy/channel-gateway-runner.sh, tests/cs-runtime-task/
설치/프로세스 제어는 기존 실행 경로와 runtime 잠금 안에서만 수행한다.

이전 관측은 현재 사실로 가정하지 말고 좁게 재조회:
- /readyz degraded, ready:false, 처리 중 gateway job 1개. CS 결과 저장 HTTP 503.
- 정상 launchd supervisor와 별도로 오래된 supervisor가 SELLERPILOT_URL 누락 오류로 재시작 반복.
- 정상 launchd plist에는 URL이 있었으므로 모든 설정을 초기화하는 수정은 금지.
- CS 초안 worker가 별도 API 큐를 사용하나 상주 실행을 확인하지 못함.
- Vercel static-egress 설정 elevenst,smartstore, Mac --no-scheduler 때문에 쿠팡/Temu 자동 수집 공백 가능성.
- Supabase 연결 도구의 운영 조회는 권한 거부였음. 권한은 재확인하되 반복 실패를 루프하지 않는다.

반드시 수행:
1. 실행 PID/부모/로그/실제 cwd/배포 SHA/작업 중 상태를 현재 시점에 확인한다. 살아 있는 작업의 상태/결과를 모른 채 kill, queue 재등록, claim 중복, release pin 변경을 하지 않는다.
2. 중복 supervisor만 정확히 식별해 안전하게 정리하고 재발 조건을 자기 runner 범위에서 고친다. URL/Node/health 경로를 일관되게 유지한다. Documents/클라우드 경로를 다시 연결하지 않는다.
3. CS 503이 DB 지연/불충분 설정/완료 저장 재시도/lease 문제 중 무엇인지 자기 모듈에서 좁힌다. provider가 이미 답변했을 수 있는 경우 재전송하지 않고 기존 결과 저장·readback 경계를 유지한다.
4. CS 초안 작업자가 자신의 큐에서 수집→초안→저장할 수 있게 실행 설정과 오류 처리를 고친다. 초안 생성과 고객 답변 발송을 분리한다.
5. 8채널별 '지원 수집 종류/실제 확인한 수집/답변 지원/막힌 지점'을 정리하고, 자기 소유 코드를 고쳐 수집·정규화·중복 방지·확인 가능한 답변 결과를 정확히 처리한다. 문의 0건을 채널에 고객 문의가 없다는 증거로 쓰지 않는다.
6. 쿠팡(상품/고객센터/반품/취소/교환), 스마트스토어(상품/고객), 11번가(Q&A/긴급알리미), Qoo10(문의/이력/클레임), Shopee(후기/반품 및 별도 Buyer Chat), Lazada(IM/후기 경로), eBay(상품문의/회원/시스템), Temu(after-sales/별도 Buyer Chat)를 구분한다. 현재 Temu 답변 미지원은 공식 근거 없이 지원한다고 바꾸지 않는다.
7. 2번이 동시에 수정 중인 product-ai-worker/이미지 생성 소스를 복사해 설치하지 않는다. 검증된 운영 코드/현재 배포 SHA를 유지하면서 가능한 프로세스·설정 복구와 자신의 코드 개선만 수행한다.

일하지 않을 범위: 상품 provider, 공용 protocols/serverless 조립부, app/api/channel-gateway/worker/*, 이미지 생성 엔진, 공유 DB schema/migration, Vercel 배포. 외부 권한 때문에 DB·수집 스케줄 확인이 불가능하면 그 경계를 정확히 남기고 나머지 코드·집중 테스트를 끝낸다.
완료 기준: 변경 전후 실행 상태와 오류 변화, CS 큐/초안/완료 저장 회귀 검사, 각 채널의 확인된 사실과 미확인 범위, 후속 운영 적용을 자기 result.md에 기록. 고객 답변 발송 자체를 임의 수행하지 않는다.
