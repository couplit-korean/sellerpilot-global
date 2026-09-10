# Qoo10 CS 독립 개발 계획

이 문서는 [공통 분업 계획](../README.md)과 [소유권 목록](../ownership.json)을 따른다. 전용 채팅 하나의 범위는 Qoo10 CS 전체다. 다른 채널이나 상품등록 개발을 맡지 않는다. 현재 문서는 2026-09-08 로컬 소스와 이전 운영 관측을 바탕으로 작성했으며, 이번 계획 작성 중 실제 provider 상태를 새로 조회하지 않았다.

## 현재 구현과 완료 범위

MSG·HELP·ITEM 문의 수신/답변과 S1/S2/S3 조회, GetClaimInfo_V3 클레임 읽기 및 최근 이력 복구가 있다. 긴 대화·별도 리뷰는 미확정/미지원으로 남아 있다. 일반적인 날짜 지정 과거수집 버튼은 현재 없다.

필수 조사 범위: MSG·HELP·ITEM 각각의 문의 / 취소·반품·교환·미수취·부분환불 클레임 맥락 / 판매자 채팅·긴 대화 / 리뷰·댓글.

## 순서가 고정된 실행 작업

1. **QOO10-01** — 국가/판매자 계정과 QAPI credential을 대조하고 실제 MSG·HELP·ITEM 화면의 문의번호·순번·상태 의미를 확인한다.
2. **QOO10-02** — S1/S2/S3를 각각 고정 기간으로 수집한다. 반환 상한·페이지 제공 여부·전체 건수 부재를 확인하고 날짜를 더 잘게 나누어 포화된 하루 구간도 미완료로 추적한다.
3. **QOO10-03** — 문의번호와 순번의 관계를 실제 긴 대화로 대조한다. 동일 질문의 여러 메시지인지 독립 문의인지 근거 없이 ticket ID를 변경하지 않는다. 변경이 필요하면 이전 원장 호환안을 통합 담당에 제출한다.
4. **QOO10-04** — 클레임은 GetClaimInfo_V3 요청일/상태와 주문번호 계보를 유지한다. 목록 배열과 ClaimInfo envelope, 상태 변동·반복 조회를 전량 대조한다.
5. **QOO10-05** — 현재 6일/일일 30일 복구 이외에 사용자가 고정한 과거 전체 기간을 공급자 허용 범위로 나누는 계획 함수를 제출한다. 공통 UI/DB에서 재개·gap을 보여주도록 요청한다.
6. **QOO10-06** — 일반 문의에만 답변을 허용하고 질문/순번/최신 inbound가 맞는 원격 답변을 재조회한다. 클레임을 상담 답변 endpoint로 보내지 않는다.
7. **QOO10-07** — 리뷰와 별도 채팅의 공식 QAPI/파트너 계약·판매자 화면을 대조한다. 공식 API가 없으면 실제 export 자료를 확인해 수입 adapter를 만들고 자동연동 제한을 명시한다.

## 첫 제출물

첫 제출물은 실제 문의 3종과 클레임의 범위별 수량/종료 계약표다. 상품번호나 기존 상품 게시 상태를 CS 연결 증거로 사용하지 않는다.

처음부터 채널 전체 재설계·리팩터링·전 저장소 테스트를 반복하지 않는다. 실제 첫 읽기를 막는 값과 권한, 현재 구현 경로의 누락을 우선 확인한다. 완료한 단계와 남은 단계를 G1~G8로 제출한다.

## 수정할 수 있는 기존 파일

- lib/channels/qoo10-inquiries.ts
- tests/qoo10-claims.test.ts

위 기존 파일에 더해 다음 채널 전용 위치만 새로 작성할 수 있다.

- lib/channels/cs/qoo10/ — 채널 정규화·날짜/페이지 계획·답변 검증·readback 함수
- lib/cs/channels/qoo10/ — 채널 전용 import·표현 계약
- app/cs/channels/qoo10/ 및 app/api/admin/cs/channels/qoo10/ — 꼭 필요한 전용 컴포넌트/route
- tests/cs-qoo10-*.test.ts, tests/cs-qoo10-*.test.mjs, tests/fixtures/cs/qoo10/
- scripts/cs-qoo10-*.mjs, scripts/cs-qoo10-*.ts — scope 고정, 기본 dry-run인 진단/검증 도구
- docs/cs-parallel/reports/qoo10/ — 진행·증거·제출 manifest
- docs/cs-parallel/proposals/qoo10/ — 공통 코드 요청·DB 초안

scripts나 fixture에 비밀번호·API 키·실고객 원문을 기록하지 않는다. 채널명이 붙은 listing/OAuth/배송 파일까지 수정 허용된 것은 아니다. 기존 전용 adapter를 재사용하고 같은 기능의 두 구현을 만들지 않는다.

## 통합 담당에 맡길 변경

Qoo10 정규화는 현재 inquiry-sync.ts에 있으므로 전용 추출/수정안을 제출. history UI/scan 실행·reply verifier·SQL 08048000·공용 protocols/qoo10.ts는 통합 소유다.

공통 변경 요청에는 S0 ID, 현재 파일 hash, 위치/함수, 기존 입력/출력, 새 입력/출력, 최소 변경안, 회귀 시험과 적용 선후관계를 적는다. 공유 파일을 자기 worktree에서 먼저 수정한 뒤 통째로 덮어쓰지 않는다. SQL은 proposals/qoo10/에만 초안으로 제출하고 실제 migration 번호는 통합 담당이 배정한다.

## 검증

채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

```sh
node --import tsx --test tests/qoo10-claims.test.ts tests/channel-pagination.test.ts tests/inquiry-sync-contract.test.ts tests/inquiry-reply.test.ts tests/cs-history-channel-db.test.mjs
```

필수 반례: S1/S2/S3 합집합·중복 순번·하루 반환상한 포화·배열/envelope 차이·클레임 동일 주문의 여러 요청·상태 수정·요청일 경계·수취인/주소/구매자 ID 제외·잘못된 순번 답변 차단.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: 질문 3종·클레임·긴 대화의 중복/누락을 해소하고 리뷰 요구까지 해결해야 채널 전체 완료다. 비공개 API를 추정해 호출하거나 임의 HTML parser로 완료 표시하지 않는다.

## 결과 보고 형식

reports/qoo10/status.md에 아래 항목을 기록한다.

- S0 ID / 작업폴더 / 변경 파일 목록 / 제출 delta의 before·after hash
- 실제 account·country/shop·kind 범위. 사용자 데이터/secret은 마스킹
- G1 범위·권한 / G2 로컬 / G3 실제 읽기 / G4 과거·웹 / G5 신규 / G6 답변 / G7 복구 / G8 운영
- 기간별 원격 고유 행·정규화·중복·격리·제외·미처리와 차이 원인
- 실행한 명령·종료코드·로그·소스 hash. 이전 테스트 결과는 시각을 명시
- 구현 완료 항목 / 운영 증명 대기 / 외부 권한/계약 부족 / 복구 불가 기간
- 남은 작업의 다음 한 행동과 통합 담당이 반영할 요청

## 이 채널 채팅에 붙여 넣을 시작 지시문

```text
너는 Qoo10 CS 전담이다. 전체 SellerPilot을 다시 개발하지 말고 이 채널의 과거 CS와 신규 수신, 웹 조회, 지원되는 답변 및 원격 관측, 장애 복구를 끝까지 책임진다.

먼저 다음 파일을 읽어라.
1. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
2. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
3. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/qoo10.md

전용 폴더는 /Users/kimchangheemac/dev/sellerpilot-cs-qoo10, 포트는 3213로 예약돼 있다. 실제 폴더와 통합 담당의 S0 manifest 준비 여부부터 확인해라. S0가 없으면 통합 폴더를 수정하지 말고 위 기준본을 읽어 채널 계약 조사와 첫 실제 읽기 준비를 진행해라. 임의 main/HEAD만 복제해 미커밋 CS 변경을 누락시키지 마라.

준비된 S0를 검증한 뒤 자기 폴더에서 허용 파일만 수정해라. 공통 gateway·정규화 dispatch·답변·UI·OAuth·SQL·설정은 통합 담당 소유다. 변경이 필요하면 proposals/qoo10/에 정확한 변경안과 시험을 제출하고 전용 개발을 계속해라. 다른 채팅의 파일·탭·서버·credential을 변경하지 마라.

현재 구현을 재사용하고 이 계획의 01부터 순서대로 진행해라. 최근 30일이나 HTTP 200/202를 과거 전체·답변 완료로 보고하지 마라. 제공하지 않는 API를 추측하거나 수동 수입을 자동연동 100%에 합산하지 마라.

기존 사용자 제한대로 커밋·푸시·배포·운영 DB 변경은 하지 말고 로컬과 읽기 검증을 먼저 끝내라. 실제 고객 메시지는 승인된 대상·문구가 있을 때만 전송하며 테스트에서 자동 전송하지 마라. 준비된 판매자 로그인은 재사용하고 계정·app·shop만 정확히 확인해라. 비밀번호·토큰은 문서/로그에 기록하지 마라.

첫 제출물을 먼저 만들고, 이후 G1~G8과 실제 분모로 보고해라. 전체 테스트 반복이나 문서 숫자 갱신만으로 개발 완료를 대신하지 마라.
```

