# Shopee CS 독립 개발 계획

이 문서는 [공통 분업 계획](../README.md)과 [소유권 목록](../ownership.json)을 따른다. 전용 채팅 하나의 범위는 Shopee CS 전체다. 다른 채널이나 상품등록 개발을 맡지 않는다. 현재 문서는 2026-09-08 로컬 소스와 이전 운영 관측을 바탕으로 작성했으며, 이번 계획 작성 중 실제 provider 상태를 새로 조회하지 않았다.

## 현재 구현과 완료 범위

shop별 상품 후기 get_comment/reply_comment와 첨부, Returns 목록·상세·15일 창·상세 10건 continuation이 있다. Buyer Chat 전용 공개 계약/권한·수신·답변 경로는 확보되지 않았다. 코드의 최대 8shop 처리와 실제 활성 shop 수는 별도다.

필수 조사 범위: 실제 연결된 국가/shop 전수 × 상품 후기·답글 / 반품·환불 작업함 / Buyer Chat. 새로운/해제 shop도 상태 목록에 반영한다.

## 순서가 고정된 실행 작업

1. **SHOPEE-01** — 현재 실제 shop 목록·국가·app/partner ID·활성 credential 및 만료를 먼저 고정한다. 8개가 로그인됐다고 추정하지 않는다. refresh를 여러 프로세스에서 동시에 실행하지 않는다.
2. **SHOPEE-02** — 한 shop의 후기 목록 실제 읽기→정규화→격리 DB→웹을 먼저 완주한 다음 나머지 실제 shop으로 확장한다. 한 shop 권한 실패가 다른 shop 완료를 가리지 않게 한다.
3. **SHOPEE-03** — 후기 전체 기간·item/comment/shop 식별자·첨부·수정본을 대조한다. 페이지 상한 초과 후 재개, 한 job의 부분 저장과 continuation을 검증한다.
4. **SHOPEE-04** — Returns의 15일 이하 구간과 상세 10건 continuation을 실제 데이터로 확인한다. 모든 shop의 상태·사유·협상·기한·첨부 및 원격 ID를 대조하고 연락처·주소를 제외한다.
5. **SHOPEE-05** — 최근 30일 이후 전체 제공기간 복구 계획 및 shop 선택/진행률을 공통 history UI에 연결 요청한다. 후기와 Returns의 cursor/분모를 공유하지 않는다.
6. **SHOPEE-06** — 후기 답변은 같은 shop/item/comment/최신 고객 세대에서만 실행되게 하고 실제 답변 관측을 검증한다. Returns의 환불/승인 action은 답변 경로로 열지 않는다.
7. **SHOPEE-07** — Buyer Chat은 실제 앱에서 이용 가능한 공식 제품/파트너 권한과 webhook/history/reply 계약을 조사한다. 확보되면 전용 모듈과 주문/대화/수신자 계보를 구현한다. 미확보 시 정확한 다음 권한 절차를 기록하며 후기 완주는 계속한다.

## 첫 제출물

첫 제출물은 실제 shop 목록과 1shop 후기 전체 흐름이다. 다른 shop 장애로 전체를 pending 하나로 표시하지 않는다.

처음부터 채널 전체 재설계·리팩터링·전 저장소 테스트를 반복하지 않는다. 실제 첫 읽기를 막는 값과 권한, 현재 구현 경로의 누락을 우선 확인한다. 완료한 단계와 남은 단계를 G1~G8로 제출한다.

## 수정할 수 있는 기존 파일

- lib/channels/shopee-inquiries.ts
- tests/shopee-return-refund.test.ts
- tests/shopee-return-refund-db.test.mjs
- scripts/shopee-comment-counts-get-only.mjs

위 기존 파일에 더해 다음 채널 전용 위치만 새로 작성할 수 있다.

- lib/channels/cs/shopee/ — 채널 정규화·날짜/페이지 계획·답변 검증·readback 함수
- lib/cs/channels/shopee/ — 채널 전용 import·표현 계약
- app/cs/channels/shopee/ 및 app/api/admin/cs/channels/shopee/ — 꼭 필요한 전용 컴포넌트/route
- tests/cs-shopee-*.test.ts, tests/cs-shopee-*.test.mjs, tests/fixtures/cs/shopee/
- scripts/cs-shopee-*.mjs, scripts/cs-shopee-*.ts — scope 고정, 기본 dry-run인 진단/검증 도구
- docs/cs-parallel/reports/shopee/ — 진행·증거·제출 manifest
- docs/cs-parallel/proposals/shopee/ — 공통 코드 요청·DB 초안

scripts나 fixture에 비밀번호·API 키·실고객 원문을 기록하지 않는다. 채널명이 붙은 listing/OAuth/배송 파일까지 수정 허용된 것은 아니다. 기존 전용 adapter를 재사용하고 같은 기능의 두 구현을 만들지 않는다.

## 통합 담당에 맡길 변경

정규화·reply·history·scope health·credential grant. shopee-oauth-exact.ts 및 모든 listing/상품·주문 OAuth 코드, SQL 20260907200000/08045000은 통합 담당 소유다.

공통 변경 요청에는 S0 ID, 현재 파일 hash, 위치/함수, 기존 입력/출력, 새 입력/출력, 최소 변경안, 회귀 시험과 적용 선후관계를 적는다. 공유 파일을 자기 worktree에서 먼저 수정한 뒤 통째로 덮어쓰지 않는다. SQL은 proposals/shopee/에만 초안으로 제출하고 실제 migration 번호는 통합 담당이 배정한다.

## 검증

채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

```sh
node --import tsx --test tests/shopee-return-refund.test.ts tests/shopee-return-refund-db.test.mjs tests/inquiry-sync-contract.test.ts tests/inquiry-reply.test.ts tests/channel-pagination.test.ts tests/serverless-cs-gateway.test.ts
```

필수 반례: 다중 shop·같은 comment ID·1shop 403·토큰 회전 CAS·20페이지 초과 재개·상세 10/11건·15일 경계·빈 페이지+다음 cursor·후기 수정/첨부 만료·미결속 shop 답변 차단.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: 모든 실제 shop의 후기/Returns 범위와 신규 수신·후기 답변을 닫고 Buyer Chat까지 요구 범위대로 구현·검증해야 채널 전체 완료다.

## 결과 보고 형식

reports/shopee/status.md에 아래 항목을 기록한다.

- S0 ID / 작업폴더 / 변경 파일 목록 / 제출 delta의 before·after hash
- 실제 account·country/shop·kind 범위. 사용자 데이터/secret은 마스킹
- G1 범위·권한 / G2 로컬 / G3 실제 읽기 / G4 과거·웹 / G5 신규 / G6 답변 / G7 복구 / G8 운영
- 기간별 원격 고유 행·정규화·중복·격리·제외·미처리와 차이 원인
- 실행한 명령·종료코드·로그·소스 hash. 이전 테스트 결과는 시각을 명시
- 구현 완료 항목 / 운영 증명 대기 / 외부 권한/계약 부족 / 복구 불가 기간
- 남은 작업의 다음 한 행동과 통합 담당이 반영할 요청

## 이 채널 채팅에 붙여 넣을 시작 지시문

```text
너는 Shopee CS 전담이다. 전체 SellerPilot을 다시 개발하지 말고 이 채널의 과거 CS와 신규 수신, 웹 조회, 지원되는 답변 및 원격 관측, 장애 복구를 끝까지 책임진다.

먼저 다음 파일을 읽어라.
1. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
2. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
3. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/shopee.md

전용 폴더는 /Users/kimchangheemac/dev/sellerpilot-cs-shopee, 포트는 3215로 예약돼 있다. 실제 폴더와 통합 담당의 S0 manifest 준비 여부부터 확인해라. S0가 없으면 통합 폴더를 수정하지 말고 위 기준본을 읽어 채널 계약 조사와 첫 실제 읽기 준비를 진행해라. 임의 main/HEAD만 복제해 미커밋 CS 변경을 누락시키지 마라.

준비된 S0를 검증한 뒤 자기 폴더에서 허용 파일만 수정해라. 공통 gateway·정규화 dispatch·답변·UI·OAuth·SQL·설정은 통합 담당 소유다. 변경이 필요하면 proposals/shopee/에 정확한 변경안과 시험을 제출하고 전용 개발을 계속해라. 다른 채팅의 파일·탭·서버·credential을 변경하지 마라.

현재 구현을 재사용하고 이 계획의 01부터 순서대로 진행해라. 최근 30일이나 HTTP 200/202를 과거 전체·답변 완료로 보고하지 마라. 제공하지 않는 API를 추측하거나 수동 수입을 자동연동 100%에 합산하지 마라.

기존 사용자 제한대로 커밋·푸시·배포·운영 DB 변경은 하지 말고 로컬과 읽기 검증을 먼저 끝내라. 실제 고객 메시지는 승인된 대상·문구가 있을 때만 전송하며 테스트에서 자동 전송하지 마라. 준비된 판매자 로그인은 재사용하고 계정·app·shop만 정확히 확인해라. 비밀번호·토큰은 문서/로그에 기록하지 마라.

첫 제출물을 먼저 만들고, 이후 G1~G8과 실제 분모로 보고해라. 전체 테스트 반복이나 문서 숫자 갱신만으로 개발 완료를 대신하지 마라.
```

