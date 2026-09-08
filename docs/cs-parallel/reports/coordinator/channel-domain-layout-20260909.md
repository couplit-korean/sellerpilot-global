# 상품·CS·배송 / 8채널 구조 정리 및 Git 전달

2026-09-09. 사용자의 채널별 코드 구분, Markdown 명시, 커밋·푸시만 수행하고 Vercel에는 배포하지 않는 요청에 따른 기록이다.

## 구현한 구조

- 상품 실행 monolith의 채널 구현을 `lib/product-registration/channels/` 8개 파일로 이동했다. 공통 계약/순수 helper는 `execution-shared.ts`, 라우팅은 `channel-adapters.ts`가 소유한다. 기존 `commerce-operations.ts`는 공통 검증/호환 진입점으로 유지한다.
- 배송 실행 monolith를 `lib/shipping/channels/` 8개 파일로 나눴다. eBay shipment 및 Lazada Pack/ReadyToShip의 별도 변경 경계도 해당 배송 영역에 유지한다.
- CS는 `lib/cs/channels/<channel>/adapter.ts` 8개를 명시적으로 연결했다. 기존 문의/과거내역/클레임 세부 구현은 그대로 보존한다. SmartStore token 갱신과 Temu 재시도 결과 변환은 해당 채널 adapter가 맡는다.
- 세 registry는 8개 키를 TypeScript `Record`로 검사한다. 24개 실행 진입점은 채널 불일치 입력을 인증/transport 전에 거부한다.
- CS 문의 타입을 `lib/cs/operations/inquiry-contracts.ts`로 옮겨 공통 reply 검증이 전체 채널 normalizer 구현을 거쳐 다른 채널 코드에 의존하지 않게 했다.
- 기존 상품/CS/배송 UI·API·조회·완료·worker 격리를 보존한다. 공용 인증/HTTP/DB/queue 기반은 명시적인 조합 경계에서만 공유한다.

[8채널 연결 지도](../../../channel-connections/README.md)와 채널별 8개 지침에 소유 파일, 연결 입력, 구현/검증 순서, 지원하지 않는 동작과 운영 증거 기준을 명시했다.

## 보존한 작업

통합 폴더에서 앞서 수신한 CS 코드/새 SQL/테스트/보고서와 상품·CS·배송 분리 작업을 함께 Git에 기록한다. 시작 전 2,159개 파일 해시 체크포인트를 `/Users/kimchangheemac/dev/sellerpilot-cs-snapshots/channel-layout-20260909T040230`에 만들었다. 과거 SQL 번호 충돌에 따른 103000→103100 정리를 보존하며 기존 운영 데이터는 건드리지 않는다.

원격 `origin/integration-aside`의 쿠팡 개선 22개 커밋(`957db34238f64ad3d6f54c61adb0a5c970900aef`)도 정상 merge로 포함한다. 기존 monolith의 쿠팡 가격 변경 후 재조회 수정은 새 쿠팡 상품 실행기에 반영한다. 원격 이력을 강제로 덮어쓰지 않는다.

## 검증 기록

최종 통합 뒤 아래 수치/로그를 확정한다. 초기 채널 격리 28/28 및 전이 의존 0을 확인했다. 확대 TypeScript 시험에서 분리 전 소스 경로를 참조하는 검사와 기존 일반 기능 검사 실패가 발견되어 경로 검사를 수정했다. 전체 suite가 무조건 통과했다고 보고하지 않는다.

## 운영과 Git 범위

비공개 `origin` 저장소의 `integration-aside`에만 정상 push한다. Vercel 연결 별도 원격/main은 변경하지 않는다. `vercel.json`의 `git.deploymentEnabled`에서 대상 브랜치와 작업 브랜치를 false로 설정했다. deploy CLI/API·운영 migration·provider mutation·고객 답변은 실행하지 않는다. 로컬 구조 분리 완료는 8채널 운영 E2E 인증 완료와 다른 판정이다.
