# 11번가 CS 독립 개발 계획

이 문서는 [공통 분업 계획](../README.md)과 [소유권 목록](../ownership.json)을 따른다. 전용 채팅 하나의 범위는 11번가 CS 전체다. 다른 채널이나 상품등록 개발을 맡지 않는다. 현재 문서는 2026-09-08 로컬 소스와 이전 운영 관측을 바탕으로 작성했으며, 이번 계획 작성 중 실제 provider 상태를 새로 조회하지 않았다.

## 현재 구현과 완료 범위

올바른 couplit/커플릿 Seller Office와 인증된 상품 Q&A 계약을 앞선 작업에서 확인했다. 전용 GET/PUT adapter, XML 정규화, 30일 다섯 구간, DB/UI/serverless 연결과 집중 회귀가 있다. 실제 운영 Key Q&A 읽기·과거 원장·답변 관측은 미완료다.

필수 조사 범위: 상품 Q&A / 셀러톡 / 긴급알리미 / 리뷰·답글. 긴급알리미가 고객 상담인지 시스템 알림인지 실제 메뉴·원격 ID·공식 계약으로 분류한다.

## 순서가 고정된 실행 작업

1. **ELEVENST-01** — 11번가 판매자 ID는 couplit, 판매자명은 커플릿이다. CHANGHEE Chrome 계정 이메일과 판매자 ID를 혼동하지 않는다. 준비된 Seller Office 세션을 재사용하고 Key는 기존 보안 경로에서만 참조한다.
2. **ELEVENST-02** — 같은 seller/key/IP로 최대 7일 prodqnalist 실제 GET을 수행한다. 전체/답변/미답변 상태 00/01/02와 판매자센터 동일 기간을 대조한다. 최근 미답변 0건을 과거 전량으로 보지 않는다.
3. **ELEVENST-03** — brdInfoNo·brdInfoClfNo(상품 번호)·질문 시각·답변 본문/날짜의 fixture→DB→웹 경로를 확인한다. memID는 보관하지 않고 날짜만 있는 답변의 시간 순서를 추측하지 않는다.
4. **ELEVENST-04** — 30일 다섯 구간을 첫 단위로 완주하고 허용되는 최초 기간까지 종료일을 뒤로 옮긴다. 창별 원격 ID/원장/웹 수량과 gap, 이미 외부에서 답변된 문의를 대조한다.
5. **ELEVENST-05** — 기존 credential_incarnation_v1 또는 provider_certified_v1의 정확한 활성 계보를 유지한다. 상품/문의/credential/latest inbound가 어긋나는 답변은 DB와 provider 전 단계에서 거절한다.
6. **ELEVENST-06** — 승인된 상품 Q&A 답변을 PUT prodqnaanswer/brdInfoNo/prdNo로 보내는 경로를 검증한다. resultCode 200과 두 ID 일치는 접수이며 재조회로 동일 답변이 보여야 관측 완료다.
7. **ELEVENST-07** — 셀러톡·긴급알리미·리뷰는 별도 공식 계약·권한·보존기간을 확보한다. 계약이 있으면 전용 수신/이력/답변/관측 모듈, 없으면 실제 자료 수입 경로와 제한을 남긴다.

## 첫 제출물

첫 제출물은 couplit 계정 Key의 7일 실제 Q&A 읽기와 판매자센터 대조다. 앞서 통과한 로컬 기능을 처음부터 다시 만들지 않는다.

처음부터 채널 전체 재설계·리팩터링·전 저장소 테스트를 반복하지 않는다. 실제 첫 읽기를 막는 값과 권한, 현재 구현 경로의 누락을 우선 확인한다. 완료한 단계와 남은 단계를 G1~G8로 제출한다.

## 수정할 수 있는 기존 파일

- lib/channels/elevenst-inquiries.ts
- tests/elevenst-product-qna.test.ts
- tests/elevenst-product-qna-db.test.mjs
- tests/elevenst-product-qna-db-dynamic.test.mjs

위 기존 파일에 더해 다음 채널 전용 위치만 새로 작성할 수 있다.

- lib/channels/cs/elevenst/ — 채널 정규화·날짜/페이지 계획·답변 검증·readback 함수
- lib/cs/channels/elevenst/ — 채널 전용 import·표현 계약
- app/cs/channels/elevenst/ 및 app/api/admin/cs/channels/elevenst/ — 꼭 필요한 전용 컴포넌트/route
- tests/cs-elevenst-*.test.ts, tests/cs-elevenst-*.test.mjs, tests/fixtures/cs/elevenst/
- scripts/cs-elevenst-*.mjs, scripts/cs-elevenst-*.ts — scope 고정, 기본 dry-run인 진단/검증 도구
- docs/cs-parallel/reports/elevenst/ — 진행·증거·제출 manifest
- docs/cs-parallel/proposals/elevenst/ — 공통 코드 요청·DB 초안

scripts나 fixture에 비밀번호·API 키·실고객 원문을 기록하지 않는다. 채널명이 붙은 listing/OAuth/배송 파일까지 수정 허용된 것은 아니다. 기존 전용 adapter를 재사용하고 같은 기능의 두 구현을 만들지 않는다.

## 통합 담당에 맡길 변경

protocols XML parser, inquiry-sync, inquiry-reply, reply-verification, fixed egress/serverless 허용표, history v4, SQL 08049000. 전부 통합 소유이므로 전용 함수 변경안과 회귀를 제출한다.

공통 변경 요청에는 S0 ID, 현재 파일 hash, 위치/함수, 기존 입력/출력, 새 입력/출력, 최소 변경안, 회귀 시험과 적용 선후관계를 적는다. 공유 파일을 자기 worktree에서 먼저 수정한 뒤 통째로 덮어쓰지 않는다. SQL은 proposals/elevenst/에만 초안으로 제출하고 실제 migration 번호는 통합 담당이 배정한다.

## 검증

채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

```sh
node --import tsx --test tests/elevenst-product-qna.test.ts tests/elevenst-product-qna-db.test.mjs tests/elevenst-product-qna-db-dynamic.test.mjs tests/channel-protocols.test.ts tests/serverless-cs-gateway.test.ts tests/cs-history-channel-db.test.mjs tests/inquiry-reply.test.ts
```

필수 반례: 7일 초과·00/01/02 상태·XML escape·answerYn=Y 본문/날짜 누락·날짜만 있는 답변·상품 번호 불일치·legacy 미검증 계보·실행 경로 allowlist·ACK 유실/원격 echo 지연·중복 클릭.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: 상품 Q&A 실수신·과거 전체·답변 관측을 먼저 닫는다. 셀러톡·긴급알리미·리뷰까지 필수 범위를 해결하기 전 11번가 전체 완료라고 보고하지 않는다.

## 결과 보고 형식

reports/elevenst/status.md에 아래 항목을 기록한다.

- S0 ID / 작업폴더 / 변경 파일 목록 / 제출 delta의 before·after hash
- 실제 account·country/shop·kind 범위. 사용자 데이터/secret은 마스킹
- G1 범위·권한 / G2 로컬 / G3 실제 읽기 / G4 과거·웹 / G5 신규 / G6 답변 / G7 복구 / G8 운영
- 기간별 원격 고유 행·정규화·중복·격리·제외·미처리와 차이 원인
- 실행한 명령·종료코드·로그·소스 hash. 이전 테스트 결과는 시각을 명시
- 구현 완료 항목 / 운영 증명 대기 / 외부 권한/계약 부족 / 복구 불가 기간
- 남은 작업의 다음 한 행동과 통합 담당이 반영할 요청

## 이 채널 채팅에 붙여 넣을 시작 지시문

```text
너는 11번가 CS 전담이다. 전체 SellerPilot을 다시 개발하지 말고 이 채널의 과거 CS와 신규 수신, 웹 조회, 지원되는 답변 및 원격 관측, 장애 복구를 끝까지 책임진다.

먼저 다음 파일을 읽어라.
1. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
2. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
3. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/elevenst.md

전용 폴더는 /Users/kimchangheemac/dev/sellerpilot-cs-elevenst, 포트는 3214로 예약돼 있다. 실제 폴더와 통합 담당의 S0 manifest 준비 여부부터 확인해라. S0가 없으면 통합 폴더를 수정하지 말고 위 기준본을 읽어 채널 계약 조사와 첫 실제 읽기 준비를 진행해라. 임의 main/HEAD만 복제해 미커밋 CS 변경을 누락시키지 마라.

준비된 S0를 검증한 뒤 자기 폴더에서 허용 파일만 수정해라. 공통 gateway·정규화 dispatch·답변·UI·OAuth·SQL·설정은 통합 담당 소유다. 변경이 필요하면 proposals/elevenst/에 정확한 변경안과 시험을 제출하고 전용 개발을 계속해라. 다른 채팅의 파일·탭·서버·credential을 변경하지 마라.

현재 구현을 재사용하고 이 계획의 01부터 순서대로 진행해라. 최근 30일이나 HTTP 200/202를 과거 전체·답변 완료로 보고하지 마라. 제공하지 않는 API를 추측하거나 수동 수입을 자동연동 100%에 합산하지 마라.

기존 사용자 제한대로 커밋·푸시·배포·운영 DB 변경은 하지 말고 로컬과 읽기 검증을 먼저 끝내라. 실제 고객 메시지는 승인된 대상·문구가 있을 때만 전송하며 테스트에서 자동 전송하지 마라. 준비된 판매자 로그인은 재사용하고 계정·app·shop만 정확히 확인해라. 비밀번호·토큰은 문서/로그에 기록하지 마라.

첫 제출물을 먼저 만들고, 이후 G1~G8과 실제 분모로 보고해라. 전체 테스트 반복이나 문서 숫자 갱신만으로 개발 완료를 대신하지 마라.
```

