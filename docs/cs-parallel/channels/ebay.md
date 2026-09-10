# eBay CS 독립 개발 계획

이 문서는 [공통 분업 계획](../README.md)과 [소유권 목록](../ownership.json)을 따른다. 전용 채팅 하나의 범위는 eBay CS 전체다. 다른 채널이나 상품등록 개발을 맡지 않는다. 현재 문서는 2026-09-08 로컬 소스와 이전 운영 관측을 바탕으로 작성했으며, 이번 계획 작성 중 실제 provider 상태를 새로 조회하지 않았다.

## 현재 구현과 완료 범위

ASQ, Trading Inbox, Commerce FROM_MEMBERS/FROM_EBAY 수신과 1년 복구, ASQ/Commerce 조건부 답변 경로가 있다. Trading Inbox 자체는 읽기 전용이다. 과거 API 9건/센터 21행과 commerce.message 403은 이전 관측이므로 같은 계정·폴더·기간으로 재확인해야 한다.

필수 조사 범위: Ask Seller Question / Trading Inbox / Commerce 일반 회원·시스템 대화 / 케이스·분쟁. 같은 메시지가 여러 API에 보이는 경우 출처와 identity mapping을 보존한다.

## 순서가 고정된 실행 작업

1. **EBAY-01** — seller account·site/marketplace·app와 OAuth grant를 확인한다. ASQ 수신자 계보와 Commerce conversation 권한을 따로 기록한다.
2. **EBAY-02** — Trading의 Summary/헤더/본문을 같은 폴더·기간으로 대조하고 Commerce FROM_MEMBERS/FROM_EBAY를 각각 실제 읽기한다. 이전 9/21을 현재 총수로 사용하지 않는다.
3. **EBAY-03** — 빈 페이지에 next가 있어도 중단하지 않고, 누락 total을 0으로 만들지 않는다. Inbox는 25 header 후 최대 10 ID 상세, Commerce는 10 대화/25 메시지 continuation의 끝을 검증한다.
4. **EBAY-04** — 1년 고정 범위를 31일 이하 창으로 나누고 폴더/시스템 메시지 포함 범위를 대조한다. API별 집합 차이를 원격 ID mapping으로 분류하며 21-9만으로 누락 출처를 추정하지 않는다.
5. **EBAY-05** — 동일 외부 메시지의 ASQ/Inbox/Commerce 중복은 공식 매핑이 있을 때만 연결한다. Inbox 레코드를 임의로 replyable로 승격하지 않는다.
6. **EBAY-06** — ASQ는 parent/recipient/site, Commerce는 회원 conversation/latest inbound에 결속해 답변·재조회를 검증한다. FROM_EBAY 시스템 대화는 답변 차단한다.
7. **EBAY-07** — 케이스·분쟁의 실제 계정에서 쓸 수 있는 공식 계약/권한/보존범위를 확인하고 전용 읽기·이력·지원되는 응답 경로를 구현한다. 환불·분쟁 종결 같은 업무 action은 별도로 통제한다.

## 첫 제출물

첫 제출물은 동일 범위의 API별 원격 ID 집합과 실제 Commerce 권한 결과다. 권한 403 상태를 parser 개발 완료로 대체하지 않는다.

처음부터 채널 전체 재설계·리팩터링·전 저장소 테스트를 반복하지 않는다. 실제 첫 읽기를 막는 값과 권한, 현재 구현 경로의 누락을 우선 확인한다. 완료한 단계와 남은 단계를 G1~G8로 제출한다.

## 수정할 수 있는 기존 파일

- lib/channels/ebay-inquiries.ts
- lib/channels/ebay-asq.ts
- lib/channels/ebay-message-history.ts
- lib/channels/ebay-message-pages.ts
- lib/cs/ebay-messages.ts
- app/api/admin/cs/ebay-messages/route.ts
- app/cs/ebay-messages.tsx
- scripts/ebay-message-access-get-only.mjs
- tests/ebay-asq.test.ts
- tests/ebay-message-history.test.ts
- tests/ebay-message-pages.test.ts
- tests/ebay-message-route.test.ts
- tests/ebay-my-messages.test.ts
- tests/ebay-conversation-sync.test.ts
- tests/ebay-mailbox-history.test.ts
- tests/ebay-commerce-message-db.test.mjs

위 기존 파일에 더해 다음 채널 전용 위치만 새로 작성할 수 있다.

- lib/channels/cs/ebay/ — 채널 정규화·날짜/페이지 계획·답변 검증·readback 함수
- lib/cs/channels/ebay/ — 채널 전용 import·표현 계약
- app/cs/channels/ebay/ 및 app/api/admin/cs/channels/ebay/ — 꼭 필요한 전용 컴포넌트/route
- tests/cs-ebay-*.test.ts, tests/cs-ebay-*.test.mjs, tests/fixtures/cs/ebay/
- scripts/cs-ebay-*.mjs, scripts/cs-ebay-*.ts — scope 고정, 기본 dry-run인 진단/검증 도구
- docs/cs-parallel/reports/ebay/ — 진행·증거·제출 manifest
- docs/cs-parallel/proposals/ebay/ — 공통 코드 요청·DB 초안

scripts나 fixture에 비밀번호·API 키·실고객 원문을 기록하지 않는다. 채널명이 붙은 listing/OAuth/배송 파일까지 수정 허용된 것은 아니다. 기존 전용 adapter를 재사용하고 같은 기능의 두 구현을 만들지 않는다.

## 통합 담당에 맡길 변경

commerce.message scope 추가와 OAuth refresh·credential 저장, 공통 XML/normalizer/reply/history·SQL 08044000, 공통 archive UI. listing/inventory/배송 eBay 파일은 수정하지 않는다.

공통 변경 요청에는 S0 ID, 현재 파일 hash, 위치/함수, 기존 입력/출력, 새 입력/출력, 최소 변경안, 회귀 시험과 적용 선후관계를 적는다. 공유 파일을 자기 worktree에서 먼저 수정한 뒤 통째로 덮어쓰지 않는다. SQL은 proposals/ebay/에만 초안으로 제출하고 실제 migration 번호는 통합 담당이 배정한다.

## 검증

채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

```sh
node --import tsx --test tests/ebay-asq.test.ts tests/ebay-message-history.test.ts tests/ebay-message-pages.test.ts tests/ebay-message-route.test.ts tests/ebay-my-messages.test.ts tests/ebay-conversation-sync.test.ts tests/ebay-mailbox-history.test.ts tests/ebay-commerce-message-db.test.mjs tests/channel-pagination.test.ts tests/inquiry-sync-contract.test.ts tests/inquiry-reply.test.ts tests/serverless-cs-gateway.test.ts
```

필수 반례: empty+hasMore·total 누락·헤더/본문 ID 불일치·다른 seller/site·고객/판매자/시스템 역할·동일 본문 다른 ID·대화 cursor 재개·FROM_EBAY 답변 불가·API 간 동일 메시지·오래된 inbound 답변.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: ASQ/Inbox/Commerce 원장·웹·전체 이력 대조와 지원 답변의 관측, 케이스/분쟁 요구까지 닫혀야 채널 전체 완료다.

## 결과 보고 형식

reports/ebay/status.md에 아래 항목을 기록한다.

- S0 ID / 작업폴더 / 변경 파일 목록 / 제출 delta의 before·after hash
- 실제 account·country/shop·kind 범위. 사용자 데이터/secret은 마스킹
- G1 범위·권한 / G2 로컬 / G3 실제 읽기 / G4 과거·웹 / G5 신규 / G6 답변 / G7 복구 / G8 운영
- 기간별 원격 고유 행·정규화·중복·격리·제외·미처리와 차이 원인
- 실행한 명령·종료코드·로그·소스 hash. 이전 테스트 결과는 시각을 명시
- 구현 완료 항목 / 운영 증명 대기 / 외부 권한/계약 부족 / 복구 불가 기간
- 남은 작업의 다음 한 행동과 통합 담당이 반영할 요청

## 이 채널 채팅에 붙여 넣을 시작 지시문

```text
너는 eBay CS 전담이다. 전체 SellerPilot을 다시 개발하지 말고 이 채널의 과거 CS와 신규 수신, 웹 조회, 지원되는 답변 및 원격 관측, 장애 복구를 끝까지 책임진다.

먼저 다음 파일을 읽어라.
1. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
2. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
3. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/ebay.md

전용 폴더는 /Users/kimchangheemac/dev/sellerpilot-cs-ebay, 포트는 3217로 예약돼 있다. 실제 폴더와 통합 담당의 S0 manifest 준비 여부부터 확인해라. S0가 없으면 통합 폴더를 수정하지 말고 위 기준본을 읽어 채널 계약 조사와 첫 실제 읽기 준비를 진행해라. 임의 main/HEAD만 복제해 미커밋 CS 변경을 누락시키지 마라.

준비된 S0를 검증한 뒤 자기 폴더에서 허용 파일만 수정해라. 공통 gateway·정규화 dispatch·답변·UI·OAuth·SQL·설정은 통합 담당 소유다. 변경이 필요하면 proposals/ebay/에 정확한 변경안과 시험을 제출하고 전용 개발을 계속해라. 다른 채팅의 파일·탭·서버·credential을 변경하지 마라.

현재 구현을 재사용하고 이 계획의 01부터 순서대로 진행해라. 최근 30일이나 HTTP 200/202를 과거 전체·답변 완료로 보고하지 마라. 제공하지 않는 API를 추측하거나 수동 수입을 자동연동 100%에 합산하지 마라.

기존 사용자 제한대로 커밋·푸시·배포·운영 DB 변경은 하지 말고 로컬과 읽기 검증을 먼저 끝내라. 실제 고객 메시지는 승인된 대상·문구가 있을 때만 전송하며 테스트에서 자동 전송하지 마라. 준비된 판매자 로그인은 재사용하고 계정·app·shop만 정확히 확인해라. 비밀번호·토큰은 문서/로그에 기록하지 마라.

첫 제출물을 먼저 만들고, 이후 G1~G8과 실제 분모로 보고해라. 전체 테스트 반복이나 문서 숫자 갱신만으로 개발 완료를 대신하지 마라.
```

