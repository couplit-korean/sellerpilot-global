# 1번 · 상품 등록 화면 오류 해결

상태: `completed-local`

2026-09-13 Local 통합 작업공간에서 상품 등록 화면과 1차 이미지 상태 결함을 구현·검증했다.

- 원본 가공 6장, 생성 대기, 부분 완료, 실패, 계보 불명, 실제 생성 완료를 분리했다. URL 수만으로 완료되지 않는다.
- job별 요청 fence, 세대 확인, AbortController, timeout 정리로 중복 enqueue와 이전 job의 늦은 응답 덮어쓰기를 막았다. effect setup/cleanup이 반복되는 React StrictMode에서도 fence를 새 세대로 다시 열며, 이전 세대 응답은 계속 거부한다.
- 중앙 검토 R2에 따라 polling 중 세션 부재와 401을 stale job과 분리했다. 현재 job 잠금을 해제하고 정확한 재로그인 안내와 재시도를 열며, 로그인 복원 뒤에는 이미 접수한 job을 중복 enqueue하지 않고 확인만 재개한다.
- 원본이나 상품정보 변경 시 사람 검토 승인을 해제한다. 실제 생성 계보 6장이 확인되기 전에는 검토 승인과 상세 제작이 열리지 않는다.
- 사람 검토 전 상세 제작 자동 시작과 상세 제작 자산의 1차 타일 merge를 제거했다.
- 6개 역할, 부분/빈 타일, live status, 재시도 동작을 유지했다.

실제 React 19 + happy-dom 훅 검사를 포함한 집중 검사 29/29 통과, TypeScript `--noEmit --incremental false` 통과. Git stage/commit/push, 배포, 운영 worker 설치·재시작, 실제 외부 상품 등록은 수행하지 않았다. 자세한 파일과 검사 결과는 `result.md`에 기록했다.
