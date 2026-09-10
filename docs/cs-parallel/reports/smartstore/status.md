# 스마트스토어 CS 상태

- 시각: 2026-09-08 22:05:32 KST
- S0 ID: `S0-20260908-decaba426812a3ba`
- 전용 작업폴더: `/Users/kimchangheemac/dev/sellerpilot-cs-smartstore`
- 예약 브랜치/포트: `codex/cs-smartstore-v1` / `3212`
- 소스 변경분 manifest: 최초 `delta.json`, 배열 보완 `delta-supplement-001.json`, 재시작 보완 `delta-supplement-002.json`
- 실제 seller/app/country/shop 범위: `zrl***@naver.com` / `SellerPilot Couplet` (`client_id=a8UTRFG2t6lIow0Smj6ha`, secret 미열람) / KR / `Couplet Seoul` / 통합 매니저
- credential/소유자 증거: 활성 credential 1개, version 1, sellerAccountKey 결속, credential ID SHA-256 `808e5f7041a54cce81d99a2b2056a68784a76b2a3a6509ebdedcec339ef5cc1a`
- 허용 IP 대조: 앱 허용 `3.36.92.188`, `3.39.243.106`, `112.172.127.206`; 실제 읽기 egress `112.172.127.206`; 일치
- 비밀/실고객 원문 없는 증거 경로: `docs/cs-parallel/reports/smartstore/live-denominator.json`, `docs/cs-parallel/reports/smartstore/test-evidence.md`
- 이번에 닫은 정확한 기능: 상품문의와 네이버페이 고객문의의 실계정 첫 GET, 2022-11-30~2026-09-08 공통 검증 하한 전체 30일 창 분모, 원격/운영 원장/판매자센터 0건 대조, ID namespace·날짜 경계·주문 참조 fail-closed 계약
- 완료 판정: **첫 제출물 통과**. 핵심 2종의 실제 읽기·요청 기간 분모는 완료했으나 실문의가 없어 신규 수신·실답변·원격 답변 readback은 미완료다. 톡톡·리뷰가 미연결이므로 **스마트스토어 CS 전체 완료가 아니다**.

| 게이트 | 상태 | 증거 | 남은 행동 |
|---|---|---|---|
| G1 범위·권한 | 통과 | CHANGHEE에서 seller `Couplet Seoul`, API센터 개발자 `커플릿`, 앱/문의·주문·상품·판매자정보 권한, 허용 IP를 확인했다. JEONGHUN에서는 SellerPilot 운영 CS 화면만 읽었다. token HTTP 200, seller account HTTP 200. | 앱 인증 유효기간 만료 전 운영 담당이 갱신일을 관리한다. |
| G2 로컬 경로 | 통과 | SmartStore 전용 계약·복구 11/11과 proposal SQL PGlite 2/2, 타입검사 0, 수정파일 린트 0. questionId/inquiryNo, 30일 창, seller 답변 분리, 주문 참조 7상태와 malformed 배열 보존, TalkTalk/review 위장을 고정했다. 통합 담당의 이전 최소회귀 136/136 뒤 배열 보완도 반영됐다. | 실제 SQL migration과 공용 연결 patch를 검토·반영한 뒤 공용 최소회귀와 route/UI 실제 응답을 재실행한다. |
| G3 실제 읽기 | 통과 | 같은 종료일 기준 상품 Q&A와 고객문의 GET가 모두 HTTP 200/0건. seller account HTTP 200. provider/DB mutation 0. | 실제 문의가 생기면 원격 ID와 원장 row를 즉시 1:1 대조한다. |
| G4 과거·웹 대조 | 진행 | 2022-11-30~2026-09-08을 종류별로 46개 고정 창으로 모두 HTTP 200/0건, 운영 원장·판매자센터도 0건. v2 fixture는 live evidence hash와 동일 seller/credential/shop/environment, 동일 kind 기간의 원격/원장/웹 0건을 재현했다. snapshot의 auth 200/401/401은 주장으로만 보존하고 실제 인증 증거로 승격하지 않는다. 운영 관리자 화면 read와 자동화 route auth 시험은 별도다. 톡톡·리뷰 1년 0. | 상품문의 공식 보존 하한과 톡톡·리뷰 1년 이전 자료는 unknown. nonzero 표본이 생기면 같은 계정·기간의 ID digest로 다시 대조한다. 운영 비로그인·만료세션 UI auth boundary는 별도 관측한다. |
| G5 신규 수신 | 외부조건 대기 | 신규 경쟁·재수집 계약은 로컬 시험 통과. 현재 원격 신규 문의가 0이라 실제 수신 지연·중복·새 문의 경쟁은 관측할 표본이 없다. | 승인된 테스트 문의를 상품/고객 종류별로 생성해 first-seen→원장→웹 표시 시각을 관측한다. |
| G6 답변 관측 | 외부조건 대기 | 신규/수정 endpoint 분리와 과거 seller 답변 보존 시험은 통과. 실제 고객 ticket/승인 문구가 없어 provider write와 readback은 실행하지 않았다. | 승인된 테스트 ticket/문구로 1회 답변 후 같은 native ID를 GET하여 상태·본문을 재확인한다. |
| G7 복구 | 진행 | 고정 30일 boundary/continuation, 46창 deterministic planner, 중단 checkpoint 재개, 완료 key 중복, 원격 ID 중복/원장·웹 누락을 시험했다. 004 SQL은 실제 run UUID scope와 credential seller owner를 묶고 product/customer 둘 다 완료될 때만 이동하며 PGlite에서 철회 credential·다른 seller를 거부했다. | SQL/공용 route patch 반영 후 실제 429/프로세스 중단 drill과 UI 다음 창 표시를 관측한다. 임의 floor의 최종 1~6일 조각은 exact-window enqueue v5가 필요하다. |
| G8 운영 적용 | 외부조건 대기 | 사용자 제한에 따라 commit/push/deploy/운영 DB write를 하지 않았다. | 통합 담당 검토·승인 후 전용 delta만 병합하고 운영 적용은 별도 승인으로 진행한다. |

## 계정·앱·계약 대조

- 판매자센터 로그인은 `zrl***@naver.com`, 스토어 `Couplet Seoul`, 권한 `통합 매니저`로 확인했다. 브라우저 로그인만으로 API 가능 판정을 하지 않았다.
- Commerce API 앱 `SellerPilot Couplet`은 활성 상태였고 문의/주문 판매자/상품·N배송/판매자정보의 모든 리소스 권한을 보였다. 앱 secret은 끝까지 마스킹 상태로 두었다.
- 운영 active credential은 1개뿐이며 앱 client_id·sellerAccountKey와 결속됐다. 실제 egress가 허용 IP 목록에 포함된 상태에서 token/seller account/문의 GET가 성공했다.
- 현재 [Commerce API 문의 문서](https://apicenter.commerce.naver.com/docs/commerce-api/current)는 상품문의와 네이버페이 고객문의 목록·답변을 제공한다. 고객문의는 `inquiryNo`, 상품문의는 `questionId` 계보로 분리한다.
- 공식 고객문의 구조체의 `productOrderIdList`는 상품주문번호 목록이고 `orderId`는 부모 주문번호다. SellerPilot 주문 원장은 SmartStore `productOrderId`를 외부키로 쓰므로 정확히 한 상품주문번호일 때만 연결한다.
- 상품 Q&A는 공식 답변상 작성자 식별/주문 연결 정보가 제공되지 않으므로 주문에 자동 연결하지 않는다: [Naver Commerce API discussion #3547](https://github.com/commerce-api-naver/commerce-api/discussions/3547).

## scope별 분모

| account/shop/kind/상태/폴더 | from/to·timezone | 원격 고유 ID 수 | 정상 | 중복/기존 | 격리 | 근거 있는 제외 | 미처리/gap |
|---|---|---:|---:|---:|---:|---:|---|
| active credential / Couplet Seoul / product_qna / answered 전체 | 2022-11-30~2026-09-08, Asia/Seoul, 46×30일 이하 창 | 0 | 0 | 0 | 0 | 0 | 공식 상품문의 보존 하한이 문서화되지 않아 2022-11-30 이전 unknown |
| active credential / Couplet Seoul / customer_inquiry / 상품·배송·반품·교환·환불·기타·answered 전체 | 2022-11-30~2026-09-08, Asia/Seoul, 46×30일 이하 창 | 0 | 0 | 0 | 0 | 0 | 2022-11-30은 공식 고객문의 API 도입일 기준 공통 하한; 실제 행이 없어 category별 0을 별도 합산하지 않음 |
| zrl*** / Couplet Seoul / TalkTalk / 전체·대기·진행·보류 | 2025-09-09~2026-09-08, Asia/Seoul, seller-center 웹 | 0 | 0 | 0 | 0 | 0 | Commerce 앱 scope 없음, 실시간 adapter/history/reply 없음, 1년 이전 unknown |
| zrl*** / Couplet Seoul / review / 전체 | 2025-09-09~2026-09-08, Asia/Seoul, seller-center 웹 | 0 | 0 | 0 | 0 | 0 | Commerce API 미제공, 자동 adapter/history/reply 없음, 1년 이전 unknown; 엑셀다운 control만 관측 |

원격 0건은 같은 credential/shop/기간에서 API와 판매자센터, 운영 원장을 교차 확인했다. 상품/고객 최근 3개월은 seller-center도 0건이었다. 따라서 현재 대조 가능한 범위의 차이는 0이지만, 0건을 신규 수신·답변 성공으로 확대 해석하지 않는다.

## 톡톡·리뷰 조사

- 실제 Commerce API 앱 권한 목록에는 TalkTalk·리뷰 전용 그룹이 없었다. 현재 Commerce 문의 API 목차에도 두 표면의 endpoint가 없다.
- 네이버 공식 답변은 현재 Commerce API에서 리뷰 조회·답글 API를 제공하지 않는다고 확인한다: [discussion #3564](https://github.com/commerce-api-naver/commerce-api/discussions/3564). 실제 판매자센터에는 리뷰 `엑셀다운` control이 있으므로 공식 파일을 사용한 검증형 import 후보는 존재하지만, 0건 계정에서 원본 header를 확보하지 못해 parser를 만들지 않았다.
- TalkTalk는 Commerce API와 다른 제품이다. 과거 공식 답변에는 외부 사용자 API가 비즈니스 톡톡의 에이전시 계약 범위라고 되어 있으므로 현재 계약/자격을 재확인해야 한다: [discussion #1542](https://github.com/commerce-api-naver/commerce-api/discussions/1542). 현 앱/계정에서 계약을 확인하지 못했으므로 “네이버 전체에서 불가능”이라고 단정하지 않고 미연결로 남긴다.
- TalkTalk와 리뷰를 고객문의 kind로 위장 수집하는 경로는 전용 계약 시험에서 거부된다.

## 코드 delta

| 파일 | S0 SHA-256 | 현재 SHA-256 | 변경 |
|---|---|---|---|
| `lib/channels/smartstore-inquiries.ts` | `50d82b6422259c1b07e728fceca51c344969901fef0e97fae65211e5509ada6c` | `88ea36c7cf4a73fe4dea6e1033ff4ff9f6e324a73402890274b42ba09d22fc13` | product/customer 30일 경계, 정확한 query whitelist/continuation, ID 형식·kind 오염 차단 |
| `lib/channels/smartstore-inquiry-history.ts` | `e6d708c04326cca9e84d4f9ebc307a1e560737c73f40cb192e49dfa4fade3f91` | `b8219f965d73ec1890190efcebdf689b76125b2deaed97cc42070318e9c1bc31` | customer는 정확히 한 productOrderId만 연결, parent orderId·복수/오류 목록 fail-closed, 배열 1개/복수/빈 배열 계약 명시, product Q&A 미결속 |
| `tests/cs-smartstore-contract.test.ts` | 없음 | `8573463f686452e4b4739f4c0415d5abd80e5076131f75a89e90a38fb2267c8d` | SmartStore 필수 반례 5개와 배열형 productOrderIdList 세부 반례 |

재시작 보완 002는 리뷰 결함 수정까지 포함한 다음 전용 경로를 추가했다. 정확한 hash는 `delta-supplement-002.json`에 기록한다.

- `lib/channels/cs/smartstore/history-recovery.ts`: 전체 기간 30일 창·plan digest·중단 재개
- `lib/cs/channels/smartstore/order-binding-projection.ts`: provider/ledger 결합 UI 상태 7종, malformed 배열 원소 보존
- `lib/cs/channels/smartstore/reconciliation.ts`: 동일 seller/credential/shop/environment·기간의 원격/원장/웹 digest 대조, auth snapshot claim 분리
- `tests/cs-smartstore-recovery.test.ts`: 경계·재개·중복·누락·상태·provenance 반례
- `tests/fixtures/cs/smartstore/live-zero-reconciliation-v2.json`: live evidence hash와 계정 scope를 묶은 고객 원문 없는 실제 0건 분모 재현
- `scripts/cs-smartstore-reconcile-snapshot.mjs`: 기본 dry-run 안전 검증기
- `tests/cs-smartstore-common-proposals.test.mjs`: 003/004 SQL PGlite 실행·ACL·shared admin·다른 seller·철회 credential·2종 checkpoint 시험
- `docs/cs-parallel/proposals/smartstore/smartstore-003-order-binding-health-v2.sql`: SmartStore 7상태 body-free 집계 SQL draft
- `docs/cs-parallel/proposals/smartstore/smartstore-004-next-history-window-v1.sql`: 정확한 실제 scope/owner/credential 기반 다음 창 SQL draft
- `docs/cs-parallel/proposals/smartstore/smartstore-003-004-common-integration.patch`: v1 타 채널 보존, SmartStore v2 합성, 다음 창 route의 검토용 공용 patch

## 검증

| 명령 | source hash | 환경 | exit code | 통과/실패 | 로그 |
|---|---|---|---:|---|---|
| `node --import tsx --test tests/cs-smartstore-contract.test.ts` | `8573463f…` | Node 22.23.2, 전용 worktree | 0 | 5/5 통과 | `test-evidence.md` |
| 필수 3-file 공통 suite | S0+전용 delta | Node 22.23.2 | 1 | 44/45, SmartStore 통과; Elevenst 공통 기대값 1건 불일치 | `test-evidence.md` |
| pagination/protocol/maintenance/reply/determinism | S0+전용 delta | Node 22.23.2 | 1 | 106/107; 안전한 order binding으로 바뀐 공통 fixture 1건 불일치 | `test-evidence.md`, `smartstore-001` |
| archive/history route | S0+전용 delta | Node 22.23.2 | 0 | 9/9 통과 | `test-evidence.md` |
| `tsc --noEmit --pretty false` | S0+전용 delta | Node 22.23.2 | 0 | 통과 | `test-evidence.md` |
| 수정 파일 ESLint | 위 3개 현재 hash | Node 22.23.2 | 0 | 통과 | `test-evidence.md` |
| actual GET `--history` | helper `565abb94…` | read-only prod/API | 0 | 양쪽 46/46 창 + DB read 통과 | `live-denominator.json`, `test-evidence.md` |
| SmartStore contract+recovery | 보완 002 hash | Node 22.23.2 | 0 | 11/11 통과 | `test-evidence.md` |
| v2 snapshot verifier | 보완 002 hash | Node 22.23.2 | 0 | 46/46 plan·두 kind·동일 scope 원장·웹 data 대조 통과; auth verified는 false | `recovery-reconciliation-procedure.md` |
| 003/004 SQL draft | 보완 002 hash | PGlite | 0 | 2/2 통과; malformed ID, shared admin, 다른 seller, 철회 credential, 두 kind checkpoint | `test-evidence.md` |
| 공용 연결 patch | 보완 002 hash | `git apply --check` | 0 | 적용 가능 형식 확인; 실제 반영·route/UI 증거 아님 | `smartstore-003-004-common-integration.patch` |
| 공용 history/backfill DB | 현재 통합본 | PGlite | 0 | 10/10 통과 | `test-evidence.md` |
| 공용 history coverage DB | 현재 통합본 | PGlite | 0 | 6/6 통과 | `test-evidence.md` |
| 공용 commerce boundary DB | 현재 통합본 | PGlite | 0 | 12/12 통과 | `test-evidence.md` |

## 구현 완료·대기·제한

- 구현 완료: native ID 분리, 최신 고객 본문/판매자 답변 observation 분리, 고정 30일 query/continuation, productOrderId exact binding, product Q&A 주문 미결속, TalkTalk/review kind 위장 차단.
- 운영 증명 대기: 신규 문의 first-seen, 주기 수집, 실제 답변 신규/수정, 외부 선답변, 새 문의 경쟁, provider 답변 readback.
- 외부 권한/계약 부족: TalkTalk 별도 공식 API 계약/자격. 리뷰는 Commerce API 미제공이며 seller-center export만 관측.
- 복구 불가/unknown 기간: 상품문의의 문서화된 보존 하한 이전, TalkTalk·리뷰 seller-center 1년 이전. 자료를 확보하기 전 0이나 완료로 처리하지 않는다.
- 운영 제한: commit/push/deploy/운영 DB mutation/실고객 답변은 모두 0회.

## 다음 행동

- 지금 가장 먼저 해야 하는 단일 행동: `Couplet Seoul`의 승인된 테스트 상품문의 1건과 네이버페이 고객문의 1건을 준비해 poll→원장→웹 표시→승인 답변→provider 재조회까지 native ID별로 관측한다.
- 공통 변경 요청 ID: `smartstore-001`, `smartstore-002`, `smartstore-003`, `smartstore-004`
- 외부 선행조건과 필요한 사실/자료: 답변 가능한 승인 ticket/문구; TalkTalk 현행 Business TalkTalk API 계약/에이전시 자격; 개인정보 제거가 확인된 실제 리뷰 엑셀 export 원본 1개.
- 전체 자동연동 제한: 상품/고객문의 실답변 왕복이 닫히지 않았고 TalkTalk·리뷰가 미연결이므로 전체 완료율 또는 자동연동 100%로 합산하지 않는다.
