# 1 상품 화면 작업

상태: 시작 전. 단일 폴더 `/Users/kimchangheemac/dev/sellerpilot-app`의 Local 작업으로 시작한다.

새 채팅에 사용할 요청:

> `docs/parallel-tasks/README.md`와 `ownership.json`을 읽고 publishing-ui 담당으로 작업하세요. `app/_publishing/use-first-draft-images.ts`와 `first-draft-image-review.tsx`에 분리된 1차 이미지 요청/표시를 고쳐 주세요. 원본 URL만으로 완료 표시가 켜지는 문제, 같은 화면에서 둘째 상품 요청이 누락되는 문제, 이전 job polling이 현재 상품을 덮는 문제를 해결하세요. `app/page.tsx`의 상품 상태 전환도 이 작업 소유입니다. 이미지 생성 엔진/품질 검수/API/DB는 직접 수정하지 말고 필요한 응답 계약을 이 문서에 요청하세요. 완료 상태는 실제 생성·검수 근거에 맞춰 표시하세요. 소유 파일 검사와 관련 테스트를 수행하고 이 문서에 결과를 기록하세요. 새 복제본·Worktree·채팅 생성, Git stage/commit/push, 운영 배포는 하지 마세요.

수정 파일: 없음. 준비 작업에서 hook과 표시 컴포넌트를 분리했으며 기존 결함은 아직 남아 있다.

검사 결과: 준비 검증은 README와 현재상태 문서를 참고. 이 작업의 해결 증거는 아직 없음.

공용 변경 요청: 실제 생성 방식·품질 검수 완료 증거는 image-detail 담당과 channels-integration 담당에게 계약 요청.
