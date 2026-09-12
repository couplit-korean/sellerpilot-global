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
5. 자신의 docs/parallel-tasks/image-detail/prompt.md
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
- 편집할 정확한 파일마다 node scripts/parallel-workspace.mjs check image-detail FILE... 로 소유권을 확인한다. ownership.json, AGENTS.md, 공유 README, 공용 현황 문서는 바꾸지 않는다. 자신의 prompt.md는 작업 명령이므로 수정하지 않는다.
- 이 독립 실행 동안 어느 작업도 git add/commit/push/reset/stash/checkout/merge, 공용 lockfile/dependency 갱신, 전체 포매팅, Vercel 배포/환경변수 변경, 공용 DB 스키마 변경을 하지 않는다. 변경은 원래 파일에 남기고 자신의 결과 문서에 목록을 정확히 적는다. 최종 통합·운영 적용은 이 네 작업 이후의 별도 단계다.
- asset IDs, API/RPC 이름, jobId/claimToken, 원본 hash, 승인/계정 결속, 기존 응답 schema를 깨지 않는다. 권한·릴리스·중복 등록·원본 보존 가드를 끄지 않는다.
- Node 22: /Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node. 필요한 경우 해당 bin과 /Users/kimchangheemac/Library/pnpm을 PATH 앞에 추가한다. 재설치하지 않는다.
- Next UI/API 코드를 쓰기 전 설치된 node_modules/next/dist/docs/의 관련 문서를 읽는다. Supabase/Vercel 작업은 관련 skill을 적용하되 사용자 승인 범위 안의 조회/수정을 반복 확인받지 않는다.
- 기본 검증은 node --import tsx --test 정확한-관련-테스트-파일. pnpm test는 내부 build가 있으므로 병행 단위 검사에 쓰지 않는다.
- Next dev/build/타입 생성은 node scripts/parallel-workspace.mjs run image-detail next -- COMMAND ... 잠금을 사용한다. 잠금이 차 있으면 다른 자기 작업을 먼저 진행하고, 새 포트/출력 폴더/직접 명령으로 우회하지 않는다. 서버를 계속 켜두고 작업을 끝내 잠금을 점유하지 않는다.
- 각자의 소스가 변경되는 동안 전체 build를 통합 완료 근거로 삼지 않는다. 타입 검사 시 --incremental false를 사용한다. 다른 작업의 오류를 자기 성공으로 덮거나 타 담당 파일을 고치지 말고 범위를 기록한다.
- 기존 전체 테스트 실패를 이번 회귀와 구분한다. 앞선 관련 58개 검사에는 운영 기준에서도 같은 4개 실패(local whitelist, Shopee continuation 2개, Qoo10 guard 기대값)가 있었다. 실패를 감추려고 기대값만 바꾸지 않는다.
- 판매자 계정/상품/문의가 지정되지 않은 실제 CREATE, 고객 답변 전송, 발송/송장 등록은 검증용으로 임의 실행하지 않는다. HTTP 202, 큐 접수, Online, 코드 구현을 실제 외부 완료로 표시하지 않는다. 인증이 막혀도 가능한 구현/단위 검증을 계속하고 정확한 외부 미검증 범위를 남긴다.
- 3번만 기존 Mac 설치/프로세스 제어를 runtime 잠금으로 수행할 수 있다. 작업 중인 다른 소스를 설치본으로 복사하거나 승인 없이 배포 SHA를 변경하지 않는다.

[한 채팅에서 마칠 기준]
요구사항별 현재 구현 확인 → 자기 소유 파일의 최소한의 수정 → 실제 오류/회귀를 잡는 집중 검사 → 검증 결과/남은 외부 적용을 정리한다. 문서만 고치고 구현 완료라고 하지 않는다. 자기 범위를 끝내면 다른 담당으로 범위를 넓히지 말고 같은 채팅의 사용자에게 완료 보고한다.
자신의 docs/parallel-tasks/image-detail/status.md와 result.md만 갱신한다. 상태는 completed-local 또는 blocked-external 등 의미를 정확히 적고, 변경 파일 목록, 해결한 재현 조건, 실행한 검사와 통과/실패, 아직 배포/설치/공식 조회하지 못한 항목을 구분하라. 다른 작업에 요청하는 문구나 작업 인계 메시지를 쓰지 마라. 수행 중에는 60초 이상 사용자 설명 없이 방치하지 말고 핵심 진행 상황을 간결하게 알려라.

[이 작업의 유일한 목표: 1차 6장과 2차 이미지·상세의 생성/검수 품질 일치]
소유 lane은 image-detail이다. 핵심 소유 파일:
- scripts/first-draft-image-lane.mjs, scripts/product-ai-worker.mjs
- lib/first-draft-images.ts, lib/ai-image-planning.ts, lib/ai-generated-assets.ts
- lib/server-product-research*.ts, lib/server-product-studio*.ts, 관련 source/image 모듈
- ownership.json이 허용하는 AI API와 상세 제작 UI, prompts/, tests/image-task/

확인된 사실: 최초 서버 6장은 기본 source-photo-catalog로 원본을 리사이즈/여백/배경색 변경한다. Mac 1차는 공통 프롬프트만 사용하고 원본 1장으로 제품 전체를 생성 후 normalize한다. 2차에는 보호 대상 원본 합성, 라벨 OCR/픽셀 검증, dHash/의미 중복 검사와 재시도가 있다. 1차는 이 검수를 거치지 않고 segmented-source-composite로 기록할 수 있다. 일반 품목 카테고리 매칭은 이미 있으므로 새 분류기를 처음부터 만들지 않는다.

반드시 해결할 내용:
1. 2차 자산 생성·검수의 필요한 공통 기능을 자기 소유 경로에 추출하고 1차 6장도 실제 같은 생성/원본 보존/라벨/중복 검사로 실행한다. 프롬프트 문구만 같게 하고 품질이 같다고 끝내지 않는다.
2. 6개 기존 ID portrait/wide/detail-overview/detail-use/detail-routine/detail-scale 및 기존 요청/응답 계약을 유지한다. 카테고리·제품 사실·역할에 따른 시각 장면 차이를 적용하고, 확인되지 않은 구성/효능/라벨을 발명하지 않는다.
3. 실제 source-composite 검증 없이 해당 auditMode를 쓰지 않는다. 기존 schema와 호환되는 정확한 실행·완료 조건을 구현한다. 필요 시 실패/대기 상태로 남겨 품질 검증이 통과한 것처럼 승격하지 않는다. 공용 lib/ai-cli-contract.ts나 DB를 바꾸지 않고 해결 가능한 구조를 우선한다.
4. 건강기능식품 여부 미확정(null)의 보수적 분류를 제거하지 않는다. 식품/음료/스킨케어/의류 등 확인된 카테고리는 적절한 계획을 쓰고 일반상품 fallback 원인을 설명 가능하게 유지한다.
5. 가능한 경우 검증된 동일 원본·동일 사실 버전의 1차 6장을 2차에서 재사용하고 필요한 추가 자산/상세 레이아웃을 완성한다. 호환 증거가 없는 오래된 이미지는 재사용하지 않는다.
6. 병렬 생성에서 하나의 오류가 나면 다른 진행 작업의 임시 파일을 먼저 삭제하거나 늦은 업로드가 실패 결과를 덮지 않게 자원 수명/완료 처리를 검증한다. 원본 download hash/규격·업로드·완료 계약을 보존한다.
7. 카테고리/역할 계획→실제 생성→검수→업로드·서버 결과의 전 과정을 자기 코드 범위에서 연결한다. 실제 생성 도구가 제한되면 mock 단위 검사와 실제 품질 검증 미수행을 분리한다.

일하지 않을 범위: app/page.tsx, app/_publishing/, CS, 채널 등록, 공유 schema/DB, 설치 프로그램/launchd 및 이미 실행 중인 AI runtime. 설치본을 직접 덮거나 재시작하지 않는다.
검증: 참조 원본 변조/라벨 변경/중복·유사 장면 거부, 카테고리별 6개 역할, 일부 실패·재시도·재사용 lineage, 기존 first-draft-images/ai-image-planning 테스트. 과거 작업의 6장 이미지를 새 결과로 재사용하거나 사람이 안 본 품질을 검증 완료로 표시하지 않는다. 완료한 구현·검사와 후속 설치/실제 생성 검증을 result.md에 구분해 남겨라.
