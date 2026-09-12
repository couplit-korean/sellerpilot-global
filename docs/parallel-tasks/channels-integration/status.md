# 4 채널 등록·최종 통합 작업

상태: 시작 전. 단일 폴더 `/Users/kimchangheemac/dev/sellerpilot-app`의 Local 작업으로 시작한다.

새 채팅에 사용할 요청:

> `docs/parallel-tasks/README.md`와 `ownership.json`을 읽고 channels-integration 담당으로 작업하세요. 8채널 상품 등록의 Vercel/Mac 실행 허용, 자격증명/상품/승인 결속, 공식 조회 경로를 현재 운영 기준으로 확인하고 자신의 소유 파일을 수정하세요. 1~3번의 요청은 각각의 status.md에서 읽고 공유 schema/DB/gateway 계약을 조정하세요. 다른 담당 파일을 직접 덮어쓰지 마세요. 세 작업이 진행 중일 때는 채널 코드 검토/수정을 하고, 최종 배포는 모두 검사 결과를 제출하고 소스 수정을 멈춘 뒤 진행하세요. Git index/commit/push, 전역 문서/CSS/package, DB 적용, Vercel 배포는 이 작업만 해당 잠금 안에서 처리합니다. 작업자 설치/재시작은 3번이 담당하며 운영 배포 SHA와 맞춰야 합니다. 운영 DB·Vercel 권한 차단이나 미확인 provider 결과를 완료로 표시하지 마세요. 새 복제본·Worktree·채팅은 만들지 마세요. 채널 등록/CS 실제 쓰기는 기존 승인 범위와 작업 대상 확인 후 별도로 검증하세요.

수정 파일: 없음. 준비 작업의 커밋은 통합 준비 결과이며 네 작업의 완료 커밋이 아니다.

검사 결과: 최종 통합/운영 배포/8채널 실제 등록 검증은 아직 없음.

통합 대상 상태: publishing-ui 시작 전 / image-detail 시작 전 / cs-runtime 시작 전.

공용 변경 요청: 각 status.md에 올라오는 API/품질/DB 변경을 검토하고 버전 호환과 소유 파일 범위를 조정.
