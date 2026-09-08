# eBay CS 전용 작업 상태

기준 시각: 2026-09-08 (Asia/Seoul). 이 문서는 코드 완료, 실제 provider 읽기, DB 저장, 답변 전송, 배포를 서로 구분한다.

## S0와 작업 경계

- S0: `S0-20260908-decaba426812a3ba`
- source HEAD: `3cb72144e991626fae98a30cf51022d9a1aa6b0b`
- worktree: `/Users/kimchangheemac/dev/sellerpilot-cs-ebay`
- branch: `codex/cs-ebay-v1`
- reserved port: `3217` (이번 작업에서 서버를 시작하지 않음)
- S0 manifest의 1,628개 파일과 삭제 기준 1개를 전용 폴더에서 SHA-256 대조: 불일치 0.
- 원본 통합 폴더 수정, commit, push, deploy, 운영 DB write, credential refresh, 실제 메시지 열기/전송: 모두 0.

## 첫 실제 읽기

민감하지 않은 전체 결과는 [first-read-evidence.json](./first-read-evidence.json)에 있다. raw provider ID와 고객 원문은 기록하지 않고 domain-separated SHA-256 fingerprint만 기록했다.

- 계정: production, `EBAY_US`, 준비된 CHANGHEE 브라우저에서 동일 seller account 확인. 계정과 app은 보고서 fingerprint로만 보존했다.
- 고정 범위: `2025-09-08T09:54:10.389Z`부터 `2026-09-08T09:54:10.389Z`, UTC, 30일 이하 13개 창.
- Trading Summary: HTTP 200, total 9, unread 9. 이는 account-wide summary이므로 같은 범위의 Inbox 총수 대용이 아니다.
- ASQ: 13개 창 모두 실제 읽기 완료, 고유 ID 0.
- Trading Inbox folder 0: 13개 창 실제 읽기 완료, 고유 ID 9, customer 1 / system 8 / seller 0 / unverified 0. 13개 창의 pagination total은 모두 누락돼 `unknown`으로 유지했다.
- Inbox header → 최대 10-ID detail readback 불일치 0. `ExternalMessageID`가 실제 존재한 행 0이므로 ASQ 공식 mapping 0. Inbox 9개를 ASQ 누락 또는 Commerce 행이라고 추정하지 않는다.
- Commerce `FROM_MEMBERS`: HTTP 403, provider code 1100 / ACCESS / REQUEST. ID set과 total은 `unavailable/null`이며 빈 집합이 아니다.
- Commerce `FROM_EBAY`: 같은 HTTP 403. ID set과 total은 `unavailable/null`이다.
- developer portal은 준비된 CHANGHEE 세션에서 sign-in이 필요해 keyset의 scope assignment를 확인하지 못했다. 저장 grant에는 `commerce.message`가 없다.
- 결제분쟁 summary: HTTP 404. `not_available_or_not_found`, total `null`; 0건 판정 금지.

## 공식 계약·보존기간

- Trading Inbox (`GetMyMessages`): 공식 reference는 메시지가 1년 뒤 만료된다고 명시한다. 따라서 이번 1년 13창은 provider가 명시한 가용기간을 실제 재조회한 것이며, 그보다 오래된 메시지의 provider 복구를 보장하지 않는다.
- ASQ (`GetMemberMessages`): 공식 계약상 active listing 질문 조회와 `StartCreationTime`/`EndCreationTime` 필터는 확인했지만, 현재 문서에서 독립적인 보존기간 보장은 찾지 못했다. 이번 1년 13창의 실제 0건만 관측값으로 기록한다.
- Commerce Message: `commerce.message` scope, `FROM_MEMBERS`/`FROM_EBAY`, 최대 conversation 10개·message 25개 페이지 계약은 확인했다. 현재 공식 guide/reference에서는 보존기간 문구를 찾지 못했고 실제 호출은 403이므로, 1년 범위의 존재 여부나 복구 완료를 주장하지 않는다.
- 메시지 지연: 공식 support 문서는 드물게 최대 24시간까지 배달이 지연될 수 있다고 설명한다. 신규 수집은 마지막 24시간을 겹쳐 다시 읽고 native ID로 dedupe해야 하며, 이는 이번 시점의 지연 메시지 존재를 뜻하지 않는다.
- resolution case: Post-Order `GET /post-order/v2/casemanagement/search`가 seller의 케이스 목록을 검색하며, 공식 계약상 검색 시작일은 현재 시점에서 최대 18개월 전이다. 한 요청 범위는 전용 구현에서 31일 이하로 제한했다. known-case GET도 지원하지만 Sandbox에서는 search/known-case read가 지원되지 않는다. Post-Order OAuth는 일반 Sell API의 `Bearer`와 달리 `Authorization: IAF <access-token>`을 사용한다.
- payment dispute: Sell Fulfillment API의 summary/detail/activity GET 계약은 확인했지만 현재 공식 문서에서 별도 보존기간 문구를 찾지 못했다. 현재 summary 실조회가 HTTP 404이므로 존재 여부와 장기 복구 범위를 `unknown`으로 유지한다.

## 케이스·분쟁 보완 실제 읽기

민감정보와 provider ID를 제외한 집계는 [case-dispute-read-evidence.json](./case-dispute-read-evidence.json)에 있다.

- 첫 transport 확인에서 Post-Order search에 Sell API 방식인 `Bearer`를 사용했을 때 HTTP 401이었다. 공식 Post-Order 계약의 `IAF`로 교정한 뒤 HTTP 200을 확인했다.
- resolution case search: `2025-03-08T12:34:15.558Z`부터 `2026-09-08T12:34:15.558Z`까지 최대 30일인 19개 창을 끝까지 읽었다. 19페이지 모두 HTTP 200, 각 창의 provider total 0, 고유 case ID 0이었다. 이는 이 seller·18개월·조회시각의 관측이며 모든 eBay 계정 또는 18개월 이전을 뜻하지 않는다.
- payment-dispute summary: 동일 production credential에서 HTTP 404, `not_available_or_not_found`, total/고유 ID 모두 `null`이다. 0건으로 계산하지 않는다.
- 조회 과정의 provider mutation, credential refresh, 운영 DB write, 고객 답변, 환불·수락·이의제기·종결은 모두 0이다.

## route·UI client·격리 이력 보완

- exported 관리자 GET route와 전체 `authenticateAdminRequest` 구현을 같은 격리 런타임에서 실행했다. Supabase Auth/RPC와 provider 응답만 fixture로 두고 익명 401, 만료 session 401, 타 소유 credential 404, 미인증 seller 409, seller key mismatch 409를 확인했다. 차단 시 decrypt/provider 호출은 각 gate 이전에서 0이었다.
- 읽기 UI가 사용하는 `readEbayCaseDisputeUiResponse`가 위 실제 GET route를 호출하도록 결속했다. payment-dispute 404는 `total=null`, resolution-case 403은 `authorization_required/total=null`로 UI schema 끝까지 유지됐다. 이는 로컬 UI 데이터 경로 증거이며 실제 브라우저·운영 Auth 재검증은 아니다.
- 실행 가능한 공통 이력 SQL 초안을 `proposals/ebay/ebay-case-dispute-history-ledger.sql`로 제출했다. PGlite에서 전체 SQL을 적용해 safe state append/dedupe, 상태 변경 이력, buyer/raw key 거절, native ID/status·seller key 결속, service record/authenticated owner read와 직접 table 접근 차단을 3/3 검증했다. 운영 DB에는 적용하지 않았다.
- 첫 delta와 supplemental 01은 고정 보존하고 이번 변경은 supplemental 02로 별도 제출한다. 공유 `app/page.tsx`와 capability inventory는 여전히 수정하지 않았다.

## provider GET→ledger→API→UI 전용 연결 보완

- 기존 payment-dispute·resolution-case GET adapter를 안전 정규화 뒤 service record RPC에 연결했다. 404/403/unavailable 첫 페이지는 `total=null`로 유지하고 기록하지 않으며, 중간 중단·반복 native ID·seller 미확인은 완료나 이력으로 승격하지 않는다.
- 명시적 관리자 POST 수집 route는 admin 인증→credential 소유권→provider가 확인한 seller key→vault decrypt→provider GET→service RPC 순서를 강제한다. Provider에는 GET만 보내며 accept/contest/refund/close/appeal 같은 분쟁 업무 action은 구현하지 않았다.
- owner history GET route와 읽기 화면을 추가했다. `(observed_at,id)` 복합 cursor로 같은 시각 이벤트도 빠뜨리지 않고, payment-dispute와 resolution-case를 메시지/답변 이력과 분리한다.
- PGlite와 fixture transport에서 production normalizer→sync POST route→service RPC→ledger→owner read v2→history GET route→UI client/schema 전체 연결을 실제 실행했다. Buyer/address/token은 ledger와 UI 응답에 없고, 404/403 fixture의 record RPC는 0회였다.
- 이 보완은 실제 eBay 재호출·운영 DB migration·운영 Auth·브라우저 확인이 아니다. 기존 실제 Commerce 403과 payment-dispute 404는 재시도하지 않았고, 공유 `app/page.tsx`와 capability inventory도 수정하지 않았다.

## 케이스·분쟁 내구성 수집기 보완 04

- resolution case 초기 18개월을 30일 이하 19개 창으로 계획하되, 하나의 root와 `windowQueue`를 사용해 한 continuation lineage에서 순차 실행하도록 구현했다. 각 창에서는 provider page cursor를 먼저 소진한다.
- 초기 lineage의 마지막 빈 queue·무continuation 성공을 확인한 뒤에만 최근 48시간 overlap을 허용한다. Payment Dispute summary는 날짜 범위 없이 별도 page cursor root로 운용한다.
- provider 결과는 일반 gateway 완료 전에 활성 worker token·claim token·lease·credential version·provider-certified seller key로 fence된 service RPC에 기록한다. 같은 root/page 재실행은 idempotent이고 다른 continuation page의 같은 native ID는 source/cursor drift로 차단한다.
- 401/403·404는 resolution case와 payment dispute를 별도 scope로 차단하고 해당 resource의 미시도 queued sibling만 취소한다. rate limit·provider unverified는 영구 차단하지 않는다. credential version 또는 seller key가 바뀌면 scope를 새 상태로 재평가한다.
- 공통 scheduler와 inquiry dispatcher에 대한 최소 patch, 실행 가능한 SQL, 통합 순서와 before hash는 `cases-disputes-durable-scheduler-supplement-04.md`에 제출했다. 현재 통합본에서 patch apply-check를 통과했고, 통합 담당의 강화된 로컬 history-ledger migration을 사용한 PGlite 시험도 4/4 통과했다.
- 이는 로컬 구현·제안 증거다. 04 patch와 durable SQL은 공유 통합본/운영 DB에 적용하지 않았고 실제 provider 재호출도 하지 않았다.

## 웹 대조

CHANGHEE 프로필을 먼저 목록 확인한 뒤 eBay Seller Hub의 대상 seller를 read-only로 대조했다. 메시지를 열거나 읽음 상태를 바꾸지 않았다.

- `From members`: 표시 행 0.
- `From eBay`: 표시 행 21, unread 18.
- UI는 날짜 필터 없는 현재 폴더 표시이고 provider remote ID mapping을 얻지 못했으므로, 21 대 9 차이만으로 어느 API가 누락했다고 분류하지 않는다.

## 구현 delta

- Commerce 페이지는 provider `next`를 같은 환경·path·filter·정확한 다음 offset으로 검증한 뒤에만 이어간다. empty+next도 계속하며, cross-origin/필터 변조/반복·건너뛰기 cursor는 차단한다.
- Commerce/웹 schema의 `total`을 nullable로 바꾸고 UI에 `전체 건수 미제공`으로 표시한다.
- ASQ empty+hasMore를 정상 continuation으로 바꿨다. total/hasMore가 모두 없고 25행이면 다음 페이지를 확인한다.
- Trading Inbox는 빈 중간 페이지를 조기 종료하지 않고, total이 없으면 full 25-header page 뒤를 계속 확인한다. Header/detail ID 불일치와 detail 누락은 계속 실패한다. Inbox 자체는 replyable로 승격하지 않았다.
- Commerce 답변은 `FROM_MEMBERS`만 허용하고, 전송 직전 전체 conversation을 다시 읽어 지정 message ID가 최신 전체 이벤트이면서 customer인지 확인한다. 더 최신 seller reply, 새 문의, 발신자 미확인, 동시각 순서 불명은 provider POST 전에 차단한다.
- 결제분쟁 summary/detail/activity와 resolution case search/known-case의 GET-only 계약, 정규화 route와 읽기 전용 화면을 추가했다. Post-Order의 IAF 인증, 18개월·31일 이하 창, seller 결속, buyer 원문 비노출을 강제한다. accept/contest/refund/close/appeal API는 구현하지 않았다.
- 공통 OAuth/reply builder/history/SQL/UI 변경은 [commerce-message-shared-integration.md](../../proposals/ebay/commerce-message-shared-integration.md)와 [cases-disputes-shared-integration.md](../../proposals/ebay/cases-disputes-shared-integration.md)로 제출했다.

첫 제출의 정확한 before/after SHA-256은 [delta.json](./delta.json), 케이스·분쟁 provider 보완은 [delta-supplemental-01.json](./delta-supplemental-01.json), 실제 auth route·UI client·격리 이력 보완은 [delta-supplemental-02.json](./delta-supplemental-02.json), provider GET→ledger→API→UI 전용 연결은 [delta-supplemental-03.json](./delta-supplemental-03.json), 내구성 scheduler·cursor·resource 격리는 [delta-supplemental-04.json](./delta-supplemental-04.json)에 있다.

## G1~G8

| Gate | 상태 | 근거 / 남은 조건 |
|---|---|---|
| G1 범위·권한 | 진행 | seller/marketplace/credential/app fingerprint와 저장 scope 확인. Commerce 실제 403, portal keyset assignment 미확인. |
| G2 로컬 | 통과 | 이전 provider GET→ledger→API→UI와 신규 durable scheduler/SQL/patch 계약을 합친 최신 집중 시험 37/37, 통합 강화 ledger 대상 4/4, TypeScript, 수정 파일 ESLint 통과. |
| G3 실제 읽기 | 부분 통과 | ASQ/Trading Inbox/summary GET 성공. resolution case search는 IAF 교정 후 18개월 19창 HTTP 200·고유 0. Commerce 2종은 403, 결제분쟁은 404라 ID 집합/total이 unavailable·unknown. |
| G4 과거·웹 | 부분 통과 | 메시지는 고정 1년 13창과 웹 폴더 대조 완료. resolution case는 공식 최대 18개월을 19창으로 조회. Commerce ID 대조와 API 보존기간 밖 자료는 미완료. |
| G5 신규 | 외부 조건 | 로컬 continuation/dedupe 계약은 시험. production Commerce 권한과 신규 실제 수신은 미관측. |
| G6 답변 관측 | 외부 조건 | ASQ lineage 및 Commerce 최신-customer readback gate 로컬 통과. 승인 티켓·문구가 없어 실제 전송/원격 readback 0. 공통 builder message ID 반영 필요. |
| G7 복구 | 부분 통과 | Inbox 공식 1년과 ASQ 동일 범위를 13창, resolution case 공식 최대 18개월을 19창으로 actual read. Commerce 403, payment dispute 404, ASQ/Commerce/payment-dispute 별도 보존기간 미확인이므로 provider 밖 범위는 복구 완료로 부르지 않음. |
| G8 운영 | 미적용 | 01→03과 UI/기본 migration은 통합 담당의 로컬 통합본에 반영됐지만 운영 적용 증거가 아니다. 04 durable migration·scheduler patch도 제안 상태이며 commit/push/deploy/운영 DB·schedule 활성화·운영 모니터링 증거 없음. |

## 검증 결과

첫 제출의 구조화된 실행 증거와 종료코드는 [test-evidence.json](./test-evidence.json), provider 보완은 [test-evidence-supplemental-01.json](./test-evidence-supplemental-01.json), route·UI client·격리 이력 보완은 [test-evidence-supplemental-02.json](./test-evidence-supplemental-02.json), provider GET→ledger→API→UI 연결 보완은 [test-evidence-supplemental-03.json](./test-evidence-supplemental-03.json), 내구성 수집기 검증은 [test-evidence-supplemental-04.json](./test-evidence-supplemental-04.json)에 기록했다.

- eBay 전용 + 신규 case/dispute + 격리 PGlite 시험: 68/68 통과, exit 0.
- TypeScript: `pnpm exec tsc --noEmit`, exit 0.
- 수정 파일 ESLint: exit 0.
- 케이스·분쟁 보완 정규화·route·UI 집중 시험: 13/13 통과, exit 0. 보완 뒤 TypeScript와 보완 파일 ESLint도 exit 0.
- 실제 auth route·UI client·실행 SQL을 포함한 두 번째 보완 집중 시험: 20/20 통과, exit 0. TypeScript와 두 번째 보완 파일 ESLint도 exit 0.
- production normalizer·sync/history route·service/owner RPC·PGlite·UI client를 잇는 세 번째 보완 집중 시험: 25/25 통과, exit 0. TypeScript와 세 번째 보완 파일 ESLint도 exit 0.
- 기존 25개와 scheduler plan·순차 창·cursor·claim fence·dedupe·resource별 403·ACL·공유 patch 계약 12개를 합친 네 번째 집중 시험: 37/37 통과, exit 0. 현재 통합 담당 강화 ledger migration 대상 durable SQL 시험 4/4, patch apply-check, TypeScript, 네 번째 보완 파일 ESLint도 exit 0.
- 정본 필수 묶음 + 신규 case/dispute 시험: 183개 중 182개 통과, exit 1. 실패 1개는 eBay가 아닌 공통 read-only `tests/inquiry-sync-contract.test.ts`의 11st 기대 오류 불일치다. 기대 `INQUIRY_CHANNEL_UNSUPPORTED`, 실제 `INQUIRY_PAGE_INVALID:elevenst`. 이 worktree에서 공통/11st 파일은 수정하지 않았다.
- 격리 PGlite의 `ebay-commerce-message-db.test.mjs`는 위 182개 통과에 포함된다. 운영 DB에는 쓰지 않았다.

## 미완료와 다음 한 행동

1. 권한: 동일 app/seller의 Authorization Code Grant에 `commerce.message`를 포함해 재동의하고, 저장 readback 후 `FROM_MEMBERS`와 `FROM_EBAY`를 각각 다시 GET한다.
2. 공통 코드: reply builder가 최신 `messageId`를 adapter argument로 보존하도록 제안서를 반영한다. 반영 전 Commerce 답변은 안전하게 실행 불가다.
3. 공식 계약/계정: payment dispute summary 404의 account/app 가용 조건을 developer support 또는 portal에서 확인한다. 404를 0건으로 바꾸지 않는다.
4. 공통 통합: 통합 담당의 로컬 통합본에 반영된 supplemental 01→02→03과 이력/UI를 보존하면서, supplemental 04 durable SQL에 다음 migration 번호를 배정하고 scheduler patch를 현재 hash 기준으로 적용한다. 전체 gateway·migration 회귀 전에는 운영 schedule로 승격하지 않는다.
5. 복구 운영: 신규 수집은 공식 지연 가능성을 반영해 최근 24시간을 겹쳐 재조회하고 native ID로 중복 제거한다. 더 오래된 복구 가능성은 API별 공식 보존기간과 실제 가용성으로 따로 표시한다.
6. 운영 적용: 통합 담당이 delta를 선택 적용하고 전체 공통 회귀를 통과한 뒤 별도 commit/deploy/DB migration 승인을 받아야 한다.

실제 고객 답변, 환불, 분쟁 수락/이의제기/종결은 수행하지 않았다.

## 케이스·분쟁 내구성 수집기 보완 05

- supplemental 04는 manifest SHA-256 `0d5a6cf154b05e9194eb03009d8d21c713bcf783f77f3c51f9d738dfb2b5feed`로 고정했다.
- 중앙 재현의 두 결함을 05에서 분리 교정했다. 전용 strict arguments가 공통 depth/epoch/trail을 수용하고 exact next cursor를 검증하며, 전용 `ebay-case-dispute-history-page`는 generic inquiry normalizer로 보내지 않는다.
- in-process serverless와 external completion POST actual entrypoint를 격리 복제본에서 실행해 `전용 검증 → claim-fenced v2 ledger → generic completion/continuation child` 순서를 각각 확인했다. 전용 응답은 `inquiries-normalized/0`으로 대체되지 않았다.
- initial completion은 root와 모든 page ledger/parent/next-arguments hash가 이어진 전체 lineage만 인정한다. 마지막 창 추가 page 실패, partial failure, orphan, synthetic succeeded child를 완료로 승격하지 않았고 새 root 재개를 확인했다.
- Payment Dispute 130 continuation과 resolution initial 128단계 초과 전체 lineage를 실행했다. 재귀 상한은 8,192로 두었고 현재 공통 50-depth epoch rotation과 digest trail도 SQL에서 검증한다.
- 05 집중 시험 17/17, 제안 공유 트리의 기존 gateway 회귀 100/100, TypeScript, ESLint, 최신 통합본 patch apply-check가 통과했다. 성공 page뿐 아니라 404/unknown 실패 evidence도 두 완료 진입점에서 전용 원장 뒤 일반 failed completion으로 보존했다.
- 이번 보완에서 실제 provider/API/브라우저 재호출은 0이다. 기존 Commerce 양쪽 403, ASQ 0, Inbox 9, resolution 0, Payment Dispute 404는 마지막 관측 상태이며 현재 재확인으로 부르지 않는다.
- 운영 DB, scheduler 활성화, customer reply, case/dispute business action, credential refresh, commit/push/deploy는 수행하지 않았다.
