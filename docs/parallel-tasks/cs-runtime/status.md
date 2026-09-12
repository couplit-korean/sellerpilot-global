# 3 CS·로컬 실행 작업

상태: 시작 전. 단일 폴더 `/Users/kimchangheemac/dev/sellerpilot-app`의 Local 작업으로 시작한다.

새 채팅에 사용할 요청:

> `docs/parallel-tasks/README.md`와 `ownership.json`을 읽고 cs-runtime 담당으로 작업하세요. gateway ready:false, CS 결과 저장 503, 오래된 중복 supervisor, CS 초안 상주 실행 상태, 쿠팡·Temu의 주기 수집 경로 공백 가능성을 현재 상태부터 확인하고 해결하세요. 처리 중인 provider 작업의 결과를 확인하지 않고 재등록·재시작하지 마세요. 8채널 CS별 실제 수집 범위/마지막 수집/답변 지원을 구분하고 Temu 답변 미지원, Shopee Buyer Chat 별도 경로를 과장 없이 처리하세요. 상품 provider와 공용 protocols/serverless 조립부 및 DB migration은 4번에 변경 요청하고, 이미지 생성 엔진은 2번 소유로 유지하세요. 설치본 교체/launchd 조작은 runtime 잠금을 사용하고 2번의 이미지 소스 및 4번의 운영 SHA와 맞추세요. 이 문서에 변경·검사·채널별 남은 문제를 기록하세요. 새 복제본·Worktree·채팅 생성, Git stage/commit/push, 독자적인 운영 배포·DB 변경·CS 답변 발송은 하지 마세요.

수정 파일: 없음. 실행 상태는 이전 검토 시점의 관측이므로 시작할 때 재조회해야 한다.

검사 결과: 이 작업의 복구 증거는 아직 없음.

공용 변경 요청: DB 상태 조회/스케줄 변경/공유 gateway 계약은 4번과 조정. AI 런타임 재설치는 2번 검증 후.
