# 2 이미지·상세페이지 품질 작업

상태: 시작 전. 단일 폴더 `/Users/kimchangheemac/dev/sellerpilot-app`의 Local 작업으로 시작한다.

새 채팅에 사용할 요청:

> `docs/parallel-tasks/README.md`와 `ownership.json`을 읽고 image-detail 담당으로 작업하세요. 1차 6장과 2차 이미지·상세페이지가 카테고리·역할 계획 및 실제 생성·검수를 공유하도록 고쳐 주세요. `scripts/first-draft-image-lane.mjs`가 프롬프트만 공유하고 원본 합성/OCR/중복 검수를 생략하는 문제를 해결하세요. 원본 가공본을 검수된 생성 이미지로 기록하지 말고 실제 방식에 맞는 증거를 저장하세요. 검증된 6장의 2차 재사용과 상품 사실 변경 시 재검수 범위를 구현하세요. 1차 브라우저 상태/타일은 publishing-ui 소유이므로 직접 수정하지 마세요. 공용 schema/DB 변경은 channels-integration에 제안하고 설치된 AI 작업자 교체는 cs-runtime에 요청하세요. 관련 검증과 수정 파일을 이 문서에 기록하세요. 새 복제본·Worktree·채팅 생성, Git stage/commit/push, 직접 설치본 수정·재시작·운영 배포는 하지 마세요.

수정 파일: 없음. `product-ai-worker.mjs`의 생성 엔진은 이 작업 소유이며 설치 프로그램·launchd는 3번 소유다.

검사 결과: 이 작업의 품질 개선 증거는 아직 없음.

공용 변경 요청: 품질 증거/생성 방식 계약을 1번·4번과 먼저 합의. 실제 상품 원본/결과의 시각 확인까지 완료 기준에 포함.
