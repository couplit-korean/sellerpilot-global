# 쿠팡 CS 독립 개발 계획

이 문서는 [공통 분업 계획](../README.md)과 [소유권 목록](../ownership.json)을 따른다. 전용 채팅 하나의 범위는 쿠팡 CS 전체다. 다른 채널이나 상품등록 개발을 맡지 않는다. 현재 문서는 2026-09-08 로컬 소스와 이전 운영 관측을 바탕으로 작성했으며, 이번 계획 작성 중 실제 provider 상태를 새로 조회하지 않았다.

## 현재 구현과 완료 범위

상품 문의와 콜센터 문의의 조회·답변, 반품/취소/교환 읽기 adapter 및 DB 후보가 있다. 최근 30일 복구는 6일 이하 5개 창 × 8종 초기 작업 40개로 구현돼 있다. 운영 계정·권한·실제 수집 전량·답변 관측은 완료 증거가 없다.

필수 조사 범위: 상품 문의 / 콜센터 문의의 전체 상태·재문의·이관 / 반품·취소·교환 상담 맥락. WING CS 메뉴를 대조해 후기 등 추가 필수 기능 존재를 확정한다. 클레임 조회를 환불·교환 승인으로 확대하지 않는다.

## 순서가 고정된 실행 작업

1. **COUPANG-01** — 판매자/vendor ID, 활성 credential 계보, 허용 고정 IP와 실행 출구를 대조한다. 이전 상품 등록 제한이 CS 읽기도 막는다고 추정하지 말고 상품 문의 읽기 1회로 범위를 확인한다.
2. **COUPANG-02** — 같은 기간·상태의 상품 문의, 콜센터 문의, 반품, 취소, 교환을 각각 읽는다. 0건도 scope별로 기록하고 다른 종류의 성공으로 가리지 않는다.
3. **COUPANG-03** — provider 응답의 문의 ID·주문 ID·콜센터 부모 답변 ID를 익명 fixture와 비교한다. latest inbound와 단 하나의 actionable parent가 일치할 때만 답변 대상으로 만든다.
4. **COUPANG-04** — 최근 30일 다섯 창을 먼저 완주하고, provider가 제공하는 가장 오래된 기간까지 종료일을 뒤로 이동해 반복한다. 시간대·창 경계·콜센터 네 상태·교환 nextToken 누락을 검증한다.
5. **COUPANG-05** — 격리 DB의 원장·공통 웹 화면에서 기간/종류/주문 연결/이력 역할을 대조한다. 운영 데이터는 읽기 검증과 구분한다. 공통 UI/DB 문제는 통합 요청한다.
6. **COUPANG-06** — 상품문의와 콜센터 문의 각각 외부 선답변·새 재문의·이관을 시험한다. 실제 답변이 승인되면 채널 반영을 다시 읽고 정확한 inbound를 해결한다.
7. **COUPANG-07** — 첫 핵심 완료 증거를 제출하고 추가 메뉴·보존기간 밖 export를 마무리한다. 송장·주문 상태 변경·환불 승인은 다른 업무로 유지한다.

## 첫 제출물

첫 제출물은 상품/콜센터 두 종류의 실제 읽기 결과표와 한 종류의 fixture→DB→웹 경로다. 기존 코드 전면 재작성은 하지 않는다.

처음부터 채널 전체 재설계·리팩터링·전 저장소 테스트를 반복하지 않는다. 실제 첫 읽기를 막는 값과 권한, 현재 구현 경로의 누락을 우선 확인한다. 완료한 단계와 남은 단계를 G1~G8로 제출한다.

## 수정할 수 있는 기존 파일

- lib/channels/coupang-inquiries.ts
- lib/channels/coupang-inquiry-history.ts
- tests/coupang-after-sales.test.ts

위 기존 파일에 더해 다음 채널 전용 위치만 새로 작성할 수 있다.

- lib/channels/cs/coupang/ — 채널 정규화·날짜/페이지 계획·답변 검증·readback 함수
- lib/cs/channels/coupang/ — 채널 전용 import·표현 계약
- app/cs/channels/coupang/ 및 app/api/admin/cs/channels/coupang/ — 꼭 필요한 전용 컴포넌트/route
- tests/cs-coupang-*.test.ts, tests/cs-coupang-*.test.mjs, tests/fixtures/cs/coupang/
- scripts/cs-coupang-*.mjs, scripts/cs-coupang-*.ts — scope 고정, 기본 dry-run인 진단/검증 도구
- docs/cs-parallel/reports/coupang/ — 진행·증거·제출 manifest
- docs/cs-parallel/proposals/coupang/ — 공통 코드 요청·DB 초안

scripts나 fixture에 비밀번호·API 키·실고객 원문을 기록하지 않는다. 채널명이 붙은 listing/OAuth/배송 파일까지 수정 허용된 것은 아니다. 기존 전용 adapter를 재사용하고 같은 기능의 두 구현을 만들지 않는다.

## 통합 담당에 맡길 변경

inquiry-sync/reply 분기, 30일 history RPC, 고정 egress 허용표, capability/scope-health, 공통 웹 필터. SQL 08047000·08047100은 읽기 참조만 한다.

공통 변경 요청에는 S0 ID, 현재 파일 hash, 위치/함수, 기존 입력/출력, 새 입력/출력, 최소 변경안, 회귀 시험과 적용 선후관계를 적는다. 공유 파일을 자기 worktree에서 먼저 수정한 뒤 통째로 덮어쓰지 않는다. SQL은 proposals/coupang/에만 초안으로 제출하고 실제 migration 번호는 통합 담당이 배정한다.

## 검증

채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

```sh
node --import tsx --test tests/coupang-after-sales.test.ts tests/inquiry-sync-contract.test.ts tests/inquiry-reply.test.ts tests/cs-history-channel-db.test.mjs
```

필수 반례: 콜센터 배열 역순·여러 actionable parent·새 재문의 도착·다른 vendor 주문번호·6일 경계·nextToken 반복·클레임 전화/주소 제외·같은 창 재수집·불확실 답변 재전송 0.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: 모든 조사된 필수 종류·전체 상태·조회 가능한 전체 기간의 원격 ID와 원장/웹 대조, 두 답변 유형의 원격 관측, 중복 0, 신규/복구 증거가 있어야 채널 완료다.

## 결과 보고 형식

reports/coupang/status.md에 아래 항목을 기록한다.

- S0 ID / 작업폴더 / 변경 파일 목록 / 제출 delta의 before·after hash
- 실제 account·country/shop·kind 범위. 사용자 데이터/secret은 마스킹
- G1 범위·권한 / G2 로컬 / G3 실제 읽기 / G4 과거·웹 / G5 신규 / G6 답변 / G7 복구 / G8 운영
- 기간별 원격 고유 행·정규화·중복·격리·제외·미처리와 차이 원인
- 실행한 명령·종료코드·로그·소스 hash. 이전 테스트 결과는 시각을 명시
- 구현 완료 항목 / 운영 증명 대기 / 외부 권한/계약 부족 / 복구 불가 기간
- 남은 작업의 다음 한 행동과 통합 담당이 반영할 요청

## 이 채널 채팅에 붙여 넣을 시작 지시문

```text
너는 쿠팡 CS 전담이다. 전체 SellerPilot을 다시 개발하지 말고 이 채널의 과거 CS와 신규 수신, 웹 조회, 지원되는 답변 및 원격 관측, 장애 복구를 끝까지 책임진다.

먼저 다음 파일을 읽어라.
1. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
2. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
3. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/coupang.md

전용 폴더는 /Users/kimchangheemac/dev/sellerpilot-cs-coupang, 포트는 3211로 예약돼 있다. 실제 폴더와 통합 담당의 S0 manifest 준비 여부부터 확인해라. S0가 없으면 통합 폴더를 수정하지 말고 위 기준본을 읽어 채널 계약 조사와 첫 실제 읽기 준비를 진행해라. 임의 main/HEAD만 복제해 미커밋 CS 변경을 누락시키지 마라.

준비된 S0를 검증한 뒤 자기 폴더에서 허용 파일만 수정해라. 공통 gateway·정규화 dispatch·답변·UI·OAuth·SQL·설정은 통합 담당 소유다. 변경이 필요하면 proposals/coupang/에 정확한 변경안과 시험을 제출하고 전용 개발을 계속해라. 다른 채팅의 파일·탭·서버·credential을 변경하지 마라.

현재 구현을 재사용하고 이 계획의 01부터 순서대로 진행해라. 최근 30일이나 HTTP 200/202를 과거 전체·답변 완료로 보고하지 마라. 제공하지 않는 API를 추측하거나 수동 수입을 자동연동 100%에 합산하지 마라.

기존 사용자 제한대로 커밋·푸시·배포·운영 DB 변경은 하지 말고 로컬과 읽기 검증을 먼저 끝내라. 실제 고객 메시지는 승인된 대상·문구가 있을 때만 전송하며 테스트에서 자동 전송하지 마라. 준비된 판매자 로그인은 재사용하고 계정·app·shop만 정확히 확인해라. 비밀번호·토큰은 문서/로그에 기록하지 마라.

첫 제출물을 먼저 만들고, 이후 G1~G8과 실제 분모로 보고해라. 전체 테스트 반복이나 문서 숫자 갱신만으로 개발 완료를 대신하지 마라.
```

