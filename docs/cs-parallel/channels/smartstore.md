# 스마트스토어 CS 독립 개발 계획

이 문서는 [공통 분업 계획](../README.md)과 [소유권 목록](../ownership.json)을 따른다. 전용 채팅 하나의 범위는 스마트스토어 CS 전체다. 다른 채널이나 상품등록 개발을 맡지 않는다. 현재 문서는 2026-09-08 로컬 소스와 이전 운영 관측을 바탕으로 작성했으며, 이번 계획 작성 중 실제 provider 상태를 새로 조회하지 않았다.

## 현재 구현과 완료 범위

상품 문의와 네이버페이 고객 문의 수신·답변 및 과거 정규화가 있다. 고객 문의는 상품·배송·반품·교환·환불·기타 분류를 포함한다. 날짜 지정 30일 복구 UI가 있다. 톡톡과 리뷰는 현재 별도 미연결이다.

필수 조사 범위: 상품 문의 / 네이버페이 고객 문의 / 톡톡 / 상품 리뷰·답글. 클레임 관련 고객 문의는 기존 customer API 분류로 처리하고, 실제 주문 클레임 승인 업무와 구분한다.

## 순서가 고정된 실행 작업

1. **SMARTSTORE-01** — 실제 스마트스토어 계정과 credential의 판매자/애플리케이션/허용 IP를 대조한다. 브라우저 로그인 성공을 API 허용으로 보지 않는다.
2. **SMARTSTORE-02** — 상품 문의와 고객 문의를 같은 종료일로 각각 조회해 questionId와 inquiryNo를 구분한다. 주문 연결은 원격 주문 참조와 소유자가 모두 맞을 때만 한다.
3. **SMARTSTORE-03** — 두 종류의 전체 상태·조회 가능 최초일을 기록하고 30일 고정 창을 뒤로 이동한다. 과거 판매자 답변은 최신 고객 문의 본문을 덮어쓰지 않게 보존한다.
4. **SMARTSTORE-04** — 웹 검색·종류/기간 필터·대화 새로고침·주문 맥락과 원격 ID를 대조한다. 공통 history UI가 실제 scan 완료와 일치하는지 확인한다.
5. **SMARTSTORE-05** — 답변 신규/수정/이미 외부 답변/새 고객 문의를 재현한다. 승인된 실제 답변 후 대상 문의의 provider 상태·본문을 다시 읽어 확인한다.
6. **SMARTSTORE-06** — 톡톡·리뷰는 공식 해당 제품 문서와 실제 판매자 계정의 제공 권한을 별도로 조사한다. Commerce 문의 API 목록 부재만으로 네이버 모든 공식 제품에서 불가능하다고 결론내리지 않는다.
7. **SMARTSTORE-07** — 공식 계약과 자격이 있으면 전용 adapter·이력·답변 verifier를 구현한다. 없으면 실제 공식 export 원본/이동 경로를 제공하되 실시간 자동연동 미완료로 남긴다.

## 첫 제출물

첫 제출물은 상품/고객문의 각각 실제 API 읽기와 과거 기간 분모다. 톡톡/리뷰 조사 때문에 기존 두 기능 완주를 미루지 않는다.

처음부터 채널 전체 재설계·리팩터링·전 저장소 테스트를 반복하지 않는다. 실제 첫 읽기를 막는 값과 권한, 현재 구현 경로의 누락을 우선 확인한다. 완료한 단계와 남은 단계를 G1~G8로 제출한다.

## 수정할 수 있는 기존 파일

- lib/channels/smartstore-inquiries.ts
- lib/channels/smartstore-inquiry-history.ts

위 기존 파일에 더해 다음 채널 전용 위치만 새로 작성할 수 있다.

- lib/channels/cs/smartstore/ — 채널 정규화·날짜/페이지 계획·답변 검증·readback 함수
- lib/cs/channels/smartstore/ — 채널 전용 import·표현 계약
- app/cs/channels/smartstore/ 및 app/api/admin/cs/channels/smartstore/ — 꼭 필요한 전용 컴포넌트/route
- tests/cs-smartstore-*.test.ts, tests/cs-smartstore-*.test.mjs, tests/fixtures/cs/smartstore/
- scripts/cs-smartstore-*.mjs, scripts/cs-smartstore-*.ts — scope 고정, 기본 dry-run인 진단/검증 도구
- docs/cs-parallel/reports/smartstore/ — 진행·증거·제출 manifest
- docs/cs-parallel/proposals/smartstore/ — 공통 코드 요청·DB 초안

scripts나 fixture에 비밀번호·API 키·실고객 원문을 기록하지 않는다. 채널명이 붙은 listing/OAuth/배송 파일까지 수정 허용된 것은 아니다. 기존 전용 adapter를 재사용하고 같은 기능의 두 구현을 만들지 않는다.

## 통합 담당에 맡길 변경

상품/customer reply builder·normalizer, 기존 history RPC, capability 표, 공통 기간/종류 UI. OAuth·허용 IP·credential 저장 및 상품등록 스마트스토어 파일은 통합 담당 소유다.

공통 변경 요청에는 S0 ID, 현재 파일 hash, 위치/함수, 기존 입력/출력, 새 입력/출력, 최소 변경안, 회귀 시험과 적용 선후관계를 적는다. 공유 파일을 자기 worktree에서 먼저 수정한 뒤 통째로 덮어쓰지 않는다. SQL은 proposals/smartstore/에만 초안으로 제출하고 실제 migration 번호는 통합 담당이 배정한다.

## 검증

채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

```sh
node --import tsx --test tests/inquiry-sync-contract.test.ts tests/inquiry-reply.test.ts tests/cs-history-channel-db.test.mjs
```

필수 반례: questionId/inquiryNo 충돌·기존 판매자 이력 보존·날짜 창 경계·외부 답변 수정·새 문의와 답변 경쟁·다른 판매자 동일 주문번호·같은 창 중복·톡톡을 고객문의로 위장 금지.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: 상품·고객 문의의 이력과 답변을 각각 닫고 톡톡·리뷰까지 요청 범위대로 연결되어야 채널 전체 완료다. 두 API만 통과하면 핵심 2종 완료로 보고한다.

## 결과 보고 형식

reports/smartstore/status.md에 아래 항목을 기록한다.

- S0 ID / 작업폴더 / 변경 파일 목록 / 제출 delta의 before·after hash
- 실제 account·country/shop·kind 범위. 사용자 데이터/secret은 마스킹
- G1 범위·권한 / G2 로컬 / G3 실제 읽기 / G4 과거·웹 / G5 신규 / G6 답변 / G7 복구 / G8 운영
- 기간별 원격 고유 행·정규화·중복·격리·제외·미처리와 차이 원인
- 실행한 명령·종료코드·로그·소스 hash. 이전 테스트 결과는 시각을 명시
- 구현 완료 항목 / 운영 증명 대기 / 외부 권한/계약 부족 / 복구 불가 기간
- 남은 작업의 다음 한 행동과 통합 담당이 반영할 요청

## 이 채널 채팅에 붙여 넣을 시작 지시문

```text
너는 스마트스토어 CS 전담이다. 전체 SellerPilot을 다시 개발하지 말고 이 채널의 과거 CS와 신규 수신, 웹 조회, 지원되는 답변 및 원격 관측, 장애 복구를 끝까지 책임진다.

먼저 다음 파일을 읽어라.
1. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
2. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
3. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/smartstore.md

전용 폴더는 /Users/kimchangheemac/dev/sellerpilot-cs-smartstore, 포트는 3212로 예약돼 있다. 실제 폴더와 통합 담당의 S0 manifest 준비 여부부터 확인해라. S0가 없으면 통합 폴더를 수정하지 말고 위 기준본을 읽어 채널 계약 조사와 첫 실제 읽기 준비를 진행해라. 임의 main/HEAD만 복제해 미커밋 CS 변경을 누락시키지 마라.

준비된 S0를 검증한 뒤 자기 폴더에서 허용 파일만 수정해라. 공통 gateway·정규화 dispatch·답변·UI·OAuth·SQL·설정은 통합 담당 소유다. 변경이 필요하면 proposals/smartstore/에 정확한 변경안과 시험을 제출하고 전용 개발을 계속해라. 다른 채팅의 파일·탭·서버·credential을 변경하지 마라.

현재 구현을 재사용하고 이 계획의 01부터 순서대로 진행해라. 최근 30일이나 HTTP 200/202를 과거 전체·답변 완료로 보고하지 마라. 제공하지 않는 API를 추측하거나 수동 수입을 자동연동 100%에 합산하지 마라.

기존 사용자 제한대로 커밋·푸시·배포·운영 DB 변경은 하지 말고 로컬과 읽기 검증을 먼저 끝내라. 실제 고객 메시지는 승인된 대상·문구가 있을 때만 전송하며 테스트에서 자동 전송하지 마라. 준비된 판매자 로그인은 재사용하고 계정·app·shop만 정확히 확인해라. 비밀번호·토큰은 문서/로그에 기록하지 마라.

첫 제출물을 먼저 만들고, 이후 G1~G8과 실제 분모로 보고해라. 전체 테스트 반복이나 문서 숫자 갱신만으로 개발 완료를 대신하지 마라.
```

