# Shopee 006 r2 중앙 검토

상태: 수신 및 production diff 검토 완료, 중앙 미적용, r3 보완 요청.

담당 report SHA-256 `26fa753e266f8b48e62b5dc42ffc18e4330abd1a09c870454187ca51fb951ba7`, patch SHA-256 `0610f740c4bcce7842f495177ca8347f1256937f4f68c6b82dbcf3f19a263a4b`는 제출 식별자이며 이 기록에서 파일 해시를 독립 재계산한 것은 아니다.

요청했던 UI selected target 전달, Lazada v1 RPC 유지, gateway shops.get 결과 검증 반영을 확인했다. r1 SQL과 r2 production 변경을 검토하면서 다음 잔여 문제를 발견했다.

1. category-classification-workbench의 changeSelectedMarket에는 비동기 응답 순서 보호가 없다. SG 검증 요청 중 다른 국가를 선택하면 늦게 도착한 SG 응답이 최신 선택을 덮어쓸 수 있다. generation/abort/unmount 보호와 실제 순서 회귀 검사를 요청했다.
2. list v2 SQL의 credential_version은 캐시 저장 당시 버전이 아니라 현재 credential join 값이다. cache helper도 버전과 token freshness를 검사하지 않는다. 같은 ID에서 버전이 바뀌는 경우의 실제 rotation 근거와 재현을 요청했다. 불변이면 그 근거를, 변경 가능하면 저장 시점 결속 검사를 제시해야 한다.

기존 r1/r2는 frozen 유지하며 후속 companion으로 받는다. 담당 30/30·29/29 검사는 중앙 독립 통과로 계산하지 않았다. 운영 SQL, provider 요청, 배포는 실행하지 않았다. 이 제출만으로 진행률을 올리지 않는다.

동시에 도착한 SmartStore C03 r3는 별도 중앙 검토 대기로 수신했다. 패치 식별자 `38fb767bd09572fb87af7d5a583c9e38bae653b2e869d5f8cebb6d682f0c6405`. 아직 적용·독립 검증 전이며 신규 CREATE 계보와 분리한다.
