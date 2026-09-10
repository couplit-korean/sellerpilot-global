# eBay 배송 정책 확인 입력 수정

담당 ebay-006-r2의 한 줄 수정안을 중앙 현재 코드에 재기반해 적용했다. listingShippingRequirements가 요구하는 sellerpilotAssets.shipping.policyReview 경로가 편집 허용 목록에서 빠져 있었다. 이제 해당 확인 값을 입력하고 draft patch로 저장·복원할 수 있다. 확인 값은 자동 입력하지 않는다.

- 제출 patch SHA-256 확인: 3a7141178c29091fea63e61a05fd26fa5e90435d0856fb0acbf541fad1a0644a
- 중앙 before: 042dc068fa179da5cd5506978ad6e91a5c88012f8871e5d6c8949811fa7b4a78
- 중앙 after: 11a6da6faee999ddb74ebbdea4fa58183d21460e07b3f876ee40ac1c2be5e1fe
- 제출 before와 다른 이유: 중앙에는 sellerpilotCoupangBaseSku 보호가 추가돼 있다. 이 보호를 유지하고 editableInternalPaths 한 줄만 추가했다.

중앙 신규 회귀는 실제 shipping requirements → form field 노출 → 수정 patch 생성 → 복원 → requirement ready를 검사한다. 관련 폼·identity·배송·쿠팡 입력 회귀 34/34, 전체 non-incremental tsc 및 대상 ESLint 통과. 로그는 .local/product-channel-inbox/review13-policy-{tests,tsc,lint}.log에 저장했다.

담당의 실제 ProductPublishWorkbench browser 2/2 및 actual POST route 검증은 별도 제출 증거이며, 중앙에서 해당 browser/route 테스트 파일을 아직 통합·재실행하지 않았다. 중앙 화면 E2E 전체 통과로 확대하지 않는다. provider 등록, 배포, 운영 DB 변경 없음. 중앙 변경은 미커밋 상태.
