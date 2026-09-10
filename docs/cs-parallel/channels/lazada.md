# Lazada CS 독립 개발 계획

이 문서는 [공통 분업 계획](../README.md)과 [소유권 목록](../ownership.json)을 따른다. 전용 채팅 하나의 범위는 Lazada CS 전체다. 다른 채널이나 상품등록 개발을 맡지 않는다. 현재 문서는 2026-09-08 로컬 소스와 이전 운영 관측을 바탕으로 작성했으며, 이번 계획 작성 중 실제 provider 상태를 새로 조회하지 않았다.

## 현재 구현과 완료 범위

IM bootstrap·Push·답변과 rich/card 투영, raw inbox·격리·재처리·첨부 메타데이터 경로가 있다. 앞선 개발자 화면의 CS Bot Online/Active는 실제 Vault token grant를 입증하지 않는다. 현재 inventory는 IM과 카드 2행뿐이라 리뷰/사후지원 범위를 추가 조사해야 한다.

필수 조사 범위: 국가/seller/CS Bot 앱별 IM / 상품·주문·쿠폰 카드 / 수정·회수·system 이벤트 / 리뷰·사후지원 존재와 연동 범위. Commerce 앱과 CS Bot token을 구분한다.

## 순서가 고정된 실행 작업

1. **LAZADA-01** — 실제 seller/country/app ID, CS Bot permission과 저장 token fingerprint/만료를 대조한다. Commerce token에 IM 권한이 있다고 가정하지 않는다.
2. **LAZADA-02** — 준비된 앱에서 IM 세션 목록·이력 read-only 1회로 grant를 확인한다. 401/403의 app/token/seller 원인을 분해하고 무작정 재동의·로그아웃을 반복하지 않는다.
3. **LAZADA-03** — 한 세션의 페이지·메시지 전체를 원격 ID와 대조한다. session/message 순회 상한 뒤 continuation, 역순·시각 미상·unknown template은 보존하고 처리 상태를 구분한다.
4. **LAZADA-04** — webhook 서명·app binding·timestamp/재전달을 fixture로 검증한다. 원문 저장 성공 전 ACK 금지, ACK 뒤 중단해도 raw worker가 같은 receipt로 재처리하도록 한다.
5. **LAZADA-05** — bootstrap과 Push의 같은 ID/revision 중복, 본문/첨부 수정, 공식 회수 target, seller/system/customer 역할을 대조한다. 미확정 status를 문의 해결로 바꾸지 않는다.
6. **LAZADA-06** — 웹의 원문/격리/재처리/대화·카드·첨부 만료 화면을 격리 DB로 검증한다. 저장 정책상 복구 불가 사유를 표시하고 raw 용량/TTL 경계를 시험한다.
7. **LAZADA-07** — 승인된 reply와 원격 session echo를 대조하고 새 고객 메시지가 오면 이전 답변으로 해결하지 않는다. 리뷰·사후지원 API/권한을 별도로 조사해 inventory와 구현 요청을 추가한다.

## 첫 제출물

첫 제출물은 실제 CS Bot token의 IM 읽기 결과와 한 세션의 원격/DB/웹 메시지 대조다. UI Online만 보고 연동 성공이라고 하지 않는다.

처음부터 채널 전체 재설계·리팩터링·전 저장소 테스트를 반복하지 않는다. 실제 첫 읽기를 막는 값과 권한, 현재 구현 경로의 누락을 우선 확인한다. 완료한 단계와 남은 단계를 G1~G8로 제출한다.

## 수정할 수 있는 기존 파일

- lib/channels/lazada-inquiries.ts
- lib/channels/lazada-im.ts
- lib/channels/lazada-im-webhook.ts
- lib/channels/lazada-im-bootstrap.ts
- lib/channels/lazada-raw-reprocess.ts
- lib/cs/lazada-quarantine.ts
- lib/cs/lazada-raw-inbox.ts
- app/api/webhooks/lazada-im/route.ts
- app/api/admin/cs/lazada-quarantine/route.ts
- app/api/admin/cs/lazada-raw-inbox/route.ts
- app/api/admin/cs/lazada-raw-inbox/health/route.ts
- app/api/admin/cs/lazada-raw-inbox/reprocess/route.ts
- app/api/admin/cs/lazada-reply/route.ts
- app/cs/lazada-quarantine.tsx
- app/cs/lazada-quarantine.module.css
- app/cs/lazada-raw-inbox.tsx
- tests/lazada-im.test.ts
- tests/lazada-im-webhook.test.ts
- tests/lazada-im-bootstrap.test.ts
- tests/lazada-im-app-binding.test.ts
- tests/lazada-inquiry-sync.test.ts
- tests/lazada-history-completeness.test.ts
- tests/lazada-history-pagination.test.ts
- tests/lazada-unordered-quarantine.test.ts
- tests/lazada-raw-reprocess.test.ts
- tests/lazada-quarantine-route.test.ts
- tests/lazada-quarantine-read-db.test.mjs
- tests/lazada-im-raw-inbox-db.test.mjs
- tests/lazada-im-raw-reprocess-db.test.mjs
- tests/lazada-undated-buyer-db.test.mjs

위 기존 파일에 더해 다음 채널 전용 위치만 새로 작성할 수 있다.

- lib/channels/cs/lazada/ — 채널 정규화·날짜/페이지 계획·답변 검증·readback 함수
- lib/cs/channels/lazada/ — 채널 전용 import·표현 계약
- app/cs/channels/lazada/ 및 app/api/admin/cs/channels/lazada/ — 꼭 필요한 전용 컴포넌트/route
- tests/cs-lazada-*.test.ts, tests/cs-lazada-*.test.mjs, tests/fixtures/cs/lazada/
- scripts/cs-lazada-*.mjs, scripts/cs-lazada-*.ts — scope 고정, 기본 dry-run인 진단/검증 도구
- docs/cs-parallel/reports/lazada/ — 진행·증거·제출 manifest
- docs/cs-parallel/proposals/lazada/ — 공통 코드 요청·DB 초안

scripts나 fixture에 비밀번호·API 키·실고객 원문을 기록하지 않는다. 채널명이 붙은 listing/OAuth/배송 파일까지 수정 허용된 것은 아니다. 기존 전용 adapter를 재사용하고 같은 기능의 두 구현을 만들지 않는다.

## 통합 담당에 맡길 변경

공통 webhook 공개 주소·token 저장/refresh·serverless raw worker 진입점·공통 타임라인·history coverage/retention RPC와 SQL. lazada-oauth-exact.ts는 상품 인증과 공유하므로 통합 소유다.

공통 변경 요청에는 S0 ID, 현재 파일 hash, 위치/함수, 기존 입력/출력, 새 입력/출력, 최소 변경안, 회귀 시험과 적용 선후관계를 적는다. 공유 파일을 자기 worktree에서 먼저 수정한 뒤 통째로 덮어쓰지 않는다. SQL은 proposals/lazada/에만 초안으로 제출하고 실제 migration 번호는 통합 담당이 배정한다.

## 검증

채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

```sh
node --import tsx --test tests/lazada-im.test.ts tests/lazada-im-webhook.test.ts tests/lazada-im-bootstrap.test.ts tests/lazada-im-app-binding.test.ts tests/lazada-inquiry-sync.test.ts tests/lazada-history-completeness.test.ts tests/lazada-history-pagination.test.ts tests/lazada-unordered-quarantine.test.ts tests/lazada-raw-reprocess.test.ts tests/lazada-quarantine-route.test.ts tests/lazada-quarantine-read-db.test.mjs tests/lazada-im-raw-inbox-db.test.mjs tests/lazada-im-raw-reprocess-db.test.mjs tests/lazada-undated-buyer-db.test.mjs tests/cs-history-coverage-db.test.mjs tests/cs-attachment-retention-db.test.mjs tests/cs-reply-observation-db.test.mjs
```

필수 반례: 세션/메시지 실제 상한 초과 continuation·빈 페이지+next·ACK 전 저장 실패·ACK 후 중단·중복/수정/회수·시각 미상·unknown type·원문 5,000행/TTL 경계·다른 app 서명·첨부 URL 만료.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: 실제 seller/country별 bootstrap+Push+답변 관측·카드/수정/회수/첨부·raw 복구를 닫고 추가 CS 표면 조사 결과까지 반영해야 완료다.

## 결과 보고 형식

reports/lazada/status.md에 아래 항목을 기록한다.

- S0 ID / 작업폴더 / 변경 파일 목록 / 제출 delta의 before·after hash
- 실제 account·country/shop·kind 범위. 사용자 데이터/secret은 마스킹
- G1 범위·권한 / G2 로컬 / G3 실제 읽기 / G4 과거·웹 / G5 신규 / G6 답변 / G7 복구 / G8 운영
- 기간별 원격 고유 행·정규화·중복·격리·제외·미처리와 차이 원인
- 실행한 명령·종료코드·로그·소스 hash. 이전 테스트 결과는 시각을 명시
- 구현 완료 항목 / 운영 증명 대기 / 외부 권한/계약 부족 / 복구 불가 기간
- 남은 작업의 다음 한 행동과 통합 담당이 반영할 요청

## 이 채널 채팅에 붙여 넣을 시작 지시문

```text
너는 Lazada CS 전담이다. 전체 SellerPilot을 다시 개발하지 말고 이 채널의 과거 CS와 신규 수신, 웹 조회, 지원되는 답변 및 원격 관측, 장애 복구를 끝까지 책임진다.

먼저 다음 파일을 읽어라.
1. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
2. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
3. /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/lazada.md

전용 폴더는 /Users/kimchangheemac/dev/sellerpilot-cs-lazada, 포트는 3216로 예약돼 있다. 실제 폴더와 통합 담당의 S0 manifest 준비 여부부터 확인해라. S0가 없으면 통합 폴더를 수정하지 말고 위 기준본을 읽어 채널 계약 조사와 첫 실제 읽기 준비를 진행해라. 임의 main/HEAD만 복제해 미커밋 CS 변경을 누락시키지 마라.

준비된 S0를 검증한 뒤 자기 폴더에서 허용 파일만 수정해라. 공통 gateway·정규화 dispatch·답변·UI·OAuth·SQL·설정은 통합 담당 소유다. 변경이 필요하면 proposals/lazada/에 정확한 변경안과 시험을 제출하고 전용 개발을 계속해라. 다른 채팅의 파일·탭·서버·credential을 변경하지 마라.

현재 구현을 재사용하고 이 계획의 01부터 순서대로 진행해라. 최근 30일이나 HTTP 200/202를 과거 전체·답변 완료로 보고하지 마라. 제공하지 않는 API를 추측하거나 수동 수입을 자동연동 100%에 합산하지 마라.

기존 사용자 제한대로 커밋·푸시·배포·운영 DB 변경은 하지 말고 로컬과 읽기 검증을 먼저 끝내라. 실제 고객 메시지는 승인된 대상·문구가 있을 때만 전송하며 테스트에서 자동 전송하지 마라. 준비된 판매자 로그인은 재사용하고 계정·app·shop만 정확히 확인해라. 비밀번호·토큰은 문서/로그에 기록하지 마라.

첫 제출물을 먼저 만들고, 이후 G1~G8과 실제 분모로 보고해라. 전체 테스트 반복이나 문서 숫자 갱신만으로 개발 완료를 대신하지 마라.
```

