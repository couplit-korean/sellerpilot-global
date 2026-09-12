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
5. 자신의 docs/parallel-tasks/publishing-ui/prompt.md
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
- 편집할 정확한 파일마다 node scripts/parallel-workspace.mjs check publishing-ui FILE... 로 소유권을 확인한다. ownership.json, AGENTS.md, 공유 README, 공용 현황 문서는 바꾸지 않는다. 자신의 prompt.md는 작업 명령이므로 수정하지 않는다.
- 이 독립 실행 동안 어느 작업도 git add/commit/push/reset/stash/checkout/merge, 공용 lockfile/dependency 갱신, 전체 포매팅, Vercel 배포/환경변수 변경, 공용 DB 스키마 변경을 하지 않는다. 변경은 원래 파일에 남기고 자신의 결과 문서에 목록을 정확히 적는다. 최종 통합·운영 적용은 이 네 작업 이후의 별도 단계다.
- asset IDs, API/RPC 이름, jobId/claimToken, 원본 hash, 승인/계정 결속, 기존 응답 schema를 깨지 않는다. 권한·릴리스·중복 등록·원본 보존 가드를 끄지 않는다.
- Node 22: /Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node. 필요한 경우 해당 bin과 /Users/kimchangheemac/Library/pnpm을 PATH 앞에 추가한다. 재설치하지 않는다.
- Next UI/API 코드를 쓰기 전 설치된 node_modules/next/dist/docs/의 관련 문서를 읽는다. Supabase/Vercel 작업은 관련 skill을 적용하되 사용자 승인 범위 안의 조회/수정을 반복 확인받지 않는다.
- 기본 검증은 node --import tsx --test 정확한-관련-테스트-파일. pnpm test는 내부 build가 있으므로 병행 단위 검사에 쓰지 않는다.
- Next dev/build/타입 생성은 node scripts/parallel-workspace.mjs run publishing-ui next -- COMMAND ... 잠금을 사용한다. 잠금이 차 있으면 다른 자기 작업을 먼저 진행하고, 새 포트/출력 폴더/직접 명령으로 우회하지 않는다. 서버를 계속 켜두고 작업을 끝내 잠금을 점유하지 않는다.
- 각자의 소스가 변경되는 동안 전체 build를 통합 완료 근거로 삼지 않는다. 타입 검사 시 --incremental false를 사용한다. 다른 작업의 오류를 자기 성공으로 덮거나 타 담당 파일을 고치지 말고 범위를 기록한다.
- 기존 전체 테스트 실패를 이번 회귀와 구분한다. 앞선 관련 58개 검사에는 운영 기준에서도 같은 4개 실패(local whitelist, Shopee continuation 2개, Qoo10 guard 기대값)가 있었다. 실패를 감추려고 기대값만 바꾸지 않는다.
- 판매자 계정/상품/문의가 지정되지 않은 실제 CREATE, 고객 답변 전송, 발송/송장 등록은 검증용으로 임의 실행하지 않는다. HTTP 202, 큐 접수, Online, 코드 구현을 실제 외부 완료로 표시하지 않는다. 인증이 막혀도 가능한 구현/단위 검증을 계속하고 정확한 외부 미검증 범위를 남긴다.
- 3번만 기존 Mac 설치/프로세스 제어를 runtime 잠금으로 수행할 수 있다. 작업 중인 다른 소스를 설치본으로 복사하거나 승인 없이 배포 SHA를 변경하지 않는다.

[한 채팅에서 마칠 기준]
요구사항별 현재 구현 확인 → 자기 소유 파일의 최소한의 수정 → 실제 오류/회귀를 잡는 집중 검사 → 검증 결과/남은 외부 적용을 정리한다. 문서만 고치고 구현 완료라고 하지 않는다. 자기 범위를 끝내면 다른 담당으로 범위를 넓히지 말고 같은 채팅의 사용자에게 완료 보고한다.
자신의 docs/parallel-tasks/publishing-ui/status.md와 result.md만 갱신한다. 상태는 completed-local 또는 blocked-external 등 의미를 정확히 적고, 변경 파일 목록, 해결한 재현 조건, 실행한 검사와 통과/실패, 아직 배포/설치/공식 조회하지 못한 항목을 구분하라. 다른 작업에 요청하는 문구나 작업 인계 메시지를 쓰지 마라. 수행 중에는 60초 이상 사용자 설명 없이 방치하지 말고 핵심 진행 상황을 간결하게 알려라.

[이 작업의 유일한 목표: 상품 등록 화면과 1차 이미지 상태 오류 해결]
소유 lane은 publishing-ui다. 핵심 소유 파일:
- app/_publishing/use-first-draft-images.ts
- app/_publishing/first-draft-image-review.tsx
- app/page.tsx와 app/_publishing/의 상품 입력/연구 상태 모듈
- tests/publishing-task/ 및 ownership.json이 지정한 UI 테스트

반드시 해결할 재현:
1. recover 응답에 기존 원본 가공 URL 6개가 존재한다는 이유만으로 studioDraftImagesMerged=true가 되는 오류. source-photo-catalog/생성 대기/부분 완료/실패/실제 생성 완료를 기존 응답의 상태와 preflightAssetLineage 등 근거로 구분하라. 알 수 없는 상태는 완료로 표시하지 않는다.
2. firstDraftImageRequestedRef가 컴포넌트 전체 boolean이라 첫 상품 뒤 다른 jobId의 enqueue가 건너뛰는 오류. jobId별 중복 방지·재시도·작업 변경 초기화를 구현한다. 같은 job의 중복 클릭은 중복 요청이 되지 않게 한다.
3. 이전 job의 polling/늦은 응답이 현재 상품의 이미지·진행 상태를 덮는 오류. 작업 세대/job 식별, abort/타이머 정리, unmount 정리, 변경/복구 시점의 소유권을 확인한다.
4. 1차 자동 생성과 상세 자동 시작이 뒤섞여 검토 승인/다음 단계 상태를 잘못 바꾸는지 자기 화면 범위에서 고친다. 원본·상품정보가 바뀌면 이전 사람 검토 승인이 유효한 것으로 남지 않아야 한다.
5. 역할 6개와 접근성/빈 상태/진행 표시를 유지한다. 모든 이미지가 같은 원본 가공본인데 '동일 품질 생성 완료'라고 안내하지 않는다.

일하지 않을 범위: 실제 이미지 생성 엔진·prompts·lib/first-draft-images.ts·AI API·채널 provider·CS·DB·전역 CSS·운영 배포. API가 현재 제공하지 않는 새 필드를 다른 작업이 만들어줄 것이라고 가정하지 말고 기존 응답으로 동작하며 누락은 pending/unknown 처리한다.

집중 검증:
- 동일 job 중복 클릭, 첫 job 다음 둘째 job, 인증/요청 실패 후 재시도, job 변경 직후 늦은 recover 응답, unmount, 부분 6장, 원본 가공 6장, 실제 완료 6장을 구분하는 행동 테스트.
- 기존 product-research-lifecycle/provenance 및 추출된 image-review 렌더 테스트.
- 상품 입력/첫 연구→사람 검토→상세 제작 진입이 우회되지 않는지 검증.
이미 존재하는 분리 구조를 다시 추출하거나 app/page 전체를 재작성하지 말고 위 결함을 집중 해결하라.
