# 2번·3번 검토와 후속 수정 지시 — 2026-09-13

대상은 2번 · 이미지·상세페이지 품질 통합, 3번 · CS 수집·저장과 로컬 실행 복구다.
기존 완료 보고, 실제 변경, 집중 테스트와 별도 재현을 대조했다. 기존 테스트가 통과해도 아래 실행 경계는 보완이 필요하다.

## 2번

### I1: Vercel 함수에 6장 Base64를 한 번에 제출
scripts/first-draft-image-lane.mjs는 6장 전체를 JSON 한 요청으로 제출한다. 공식 Vercel Functions 문서의 요청 제한은 4.5 MB다(https://vercel.com/docs/functions/limitations#request-body-size, 2026-09-13 조회). 로컬 skill의 100 MB 설명과 달라 공식 문서를 우선했다.
올바른 규격 PNG 6장으로 전송만 재현한 fixture에서 요청은 40,407,202 bytes였다. 각 파일은 코드의 16 MiB 한도 아래였다. 모델 생성/시각 품질을 검증한 fixture는 아니며 receipt는 mock이다.
413을 반환하는 모의 API에서 worker는 한 번만 제출하고 completion-uncertain으로 종료했다. 확실한 미접수와 실제 저장 결과가 불확실한 경우가 구분되지 않는다.
필요: 6장 생성·검수 완료 barrier는 유지하되 큰 이미지는 기존 claim-scoped signed Storage 업로드 흐름으로 전송하고 최종 제출은 작은 메타데이터로 처리. API 경계 실제 크기 검사, 413·일시 실패·응답 유실·동일 제출 재시도 검증.

### I2: 부분 제출 뒤 동일 자산 재전송이 자기 자신과 중복
worker first-draft POST가 previousVerified의 모든 fingerprint를 검사 목록에 넣은 뒤 새 entry를 findDuplicateShot으로 비교한다. helper는 동일 assetId를 제외하지 않는다. 같은 역할의 같은 검증 자산 재전송도 exact duplicate로 400이 된다. 특히 부분 저장 후 중단·재개와 transport 재시도에 문제다.
필요: 같은 claim/역할/경로/digest의 동일 replay와 다른 역할의 중복을 구분. 이전 증거를 무조건 삭제하거나 다른 bytes를 같은 역할에 덮어써 통과시키지 않는다. 실제 route/Storage/RPC mock으로 부분 접수→동일 replay→나머지 완료를 검사.

### I3: legacy 이미지에 재생성을 요구하지만 기존 job 재생성은 거절
공개 product-studio API는 새 sidecar manifest가 없는 이전 composite 이미지를 FIRST_DRAFT_QUALITY_REQUIRED로 거절한다. 안내는 1차 6장 재생성이지만 기존 buildFirstDraftImageEnqueuePayload는 auditMode가 source-photo-catalog가 아니면 already_generated를 반환한다. 기존 test fixture의 composite 결과를 넣어 이 거절을 재현했다.
필요: 검증된 legacy 자산의 실제 재검수 또는 지원되는 재생성 진입 경로를 일관되게 제공. 가짜 manifest/checks, auditMode 임의 강등, 기존 승인·원본 계약 우회 금지. 기존 RPC 제약과 가능한 복구 범위를 실제로 검증한다.

### I4: Mac producer 미연결과 최종 사실/장면 검증
최종 worker의 loadReusableFirstDraftAssets consumer는 있지만 claim route가 필요한 firstDraftProductFacts/firstDraftQualityManifest/firstDraftSourcePhotoSha256/reusableFirstDraftAssets를 제공하지 않는다. 필드가 없으면 consumer는 빈 Map을 반환해 재사용하지 않는다.
서버 restore는 저장 당시 facts/manifest를 대조하지만 현재 판매자 수정값·최종 master와의 사실/장면 일치 검사가 연결돼 있지 않다. Mac facts match도 제한된 product 필드만 비교한다. 동일 사실·동일 계획일 때만 재사용한다는 보고의 범위를 충족하도록 보완해야 한다.
충돌 방지: 중앙에서 app/api/ai/worker/claim/route.ts 한 파일만 ownership.json의 image-detail 소유로 명시했다. 4번은 이 파일 수정 금지. 공용 lib/ai-cli-contract.ts와 DB schema는 그대로 유지하며 기존 요청/응답과 호환되는 additive producer 연결만 허용한다. 다른 job kind·claim 보상/권한 처리를 보존한다.

검증: 기존 이미지 관련 246개 재실행 모두 통과. I1~I4의 전송/상태/연결 경계는 기존 검사만으로 완료 증거가 되지 않는다. 실제 모델 이미지 품질은 이번 중앙 검토에서 평가하지 않았다.

## 3번

### C1: supervisor lock 생성과 PID 기록 사이에 소유권을 빼앗을 수 있음
deploy/channel-gateway-runner.sh의 mkdir 성공 후 pid 기록 전, 두 번째 프로세스는 PID 없는 lock을 stale로 보고 삭제·재획득한다. 실제 파일의 lock 함수만 임시 폴더에서 실행하고 첫 mkdir 반환을 제어한 결과 A_acquired=true, B_acquired=true, both_alive=true였다. 운영 프로세스에는 손대지 않았다.
필요: 초기화 중 lock을 stale로 회수하지 않는 원자적 소유권/보수적 복구와 stale 회수 경쟁 제어. 동시 시작·PID 쓰기 전 중단·PID 재사용·오래된 잠금 회수의 실제 프로세스 테스트.

### C2: 완료 저장 성공 후 응답 유실을 동일 완료 replay로 복구하지 못함
scripts/cs-draft-worker.mjs는 completion 503 후 heartbeat부터 호출한다. DB complete가 이미 성공했다면 기존 touch RPC는 status=running만 허용하므로 false→HTTP409다. heartbeat는 lease를 abort해 완전히 같은 complete를 다시 보내는 경로까지 차단한다.
runCsDraftJob에 실제 함수+mock RPC로 저장 commit 후 응답 503, 이후 heartbeat409, 동일 complete라면 replay 가능하도록 구성했다. 결과 committed=true, generationCalls=1, completionCalls=1, CS_WORKER_HTTP_409 throw. 초안이 유실되거나 고객에게 중복 발송됐다는 뜻은 아니며, 성공을 재확인하는 회복 경로가 깨진 것이다.
필요: 동일 완료 payload의 안전한 idempotent replay와 실제 claim 소유권 상실을 구분. 새 생성/고객 재전송 금지. committed+lost response, 미커밋503, 다른 claimToken, 완료 후 heartbeat409를 함께 검사.

### C3: 설치 재실행 시 active draft 보호
scripts/cs-draft-worker-launch-agent.mjs의 install은 기존 launch agent가 처리 중인지 확인하지 않고 bootout/kickstart -k를 수행한다. 첫 설치와 달리 재설치에는 진행 중 초안 손실 가능성이 있다. 기존 task의 초기 설치가 진행 중 작업을 죽였다고 판단한 것은 아니다.
필요: 변경 없는 설치는 멱등 no-op, 실행 중/상태 불명은 무조건 중단·교체하지 않음, 명확한 유휴 상태의 안전한 적용만 허용. 설치 동작은 mock 프로세스 도구로 검증.

실행 재조회: 8081 healthz/readyz 모두 HTTP200, ready=true, activeGatewayJobs=1. 정상 gateway는 재시작하지 않았다. 설치된 CS LaunchAgent 경로와 기존 Codex executable 존재만 읽기 확인했다. 운영 503의 내부 RPC 원인은 별도 현재 로그/권한 있는 조회가 필요하며, 8채널 CS 완료로 판정하지 않는다.
검증: 3번 관련 6개 파일 18개 검사 재실행 통과. 별도 C1/C2 재현이 기존 검사에 누락됐다.

## 후속 실행 원칙

1·4번은 기존 검토 R1~R4로 후속 지시를 이미 전달했다. 2·3번도 이 문서의 범위로 기존 채팅에서 구현·검증을 계속한다. 모두 gpt-5.6-sol / high, 통합 경로의 Local 작업이다. 채팅 간 연락·상태 조회·인계·새 채팅/복제본 금지. 중앙이 명시한 claim route 단일 소유권 예외 외에는 기존 담당 경계를 유지한다.
