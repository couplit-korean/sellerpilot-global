# Shopee CS 상태

- 시각: 2026-09-08 21:28 KST
- S0 ID: `S0-20260908-decaba426812a3ba`
- 전용 작업폴더: `/Users/kimchangheemac/dev/sellerpilot-cs-shopee`
- 브랜치 / 기준 HEAD: `codex/cs-shopee-v1` / `3cb72144e991626fae98a30cf51022d9a1aa6b0b`
- 비밀/실고객 원문 없는 증거: 이 문서, `delta.json`, Shopee 공식 문서와 로그인된 관리 UI의 집계/권한 메타데이터
- 판정: 실제 8개 shop의 존재는 확인했지만, 후기 provider GET→격리 DB→SellerPilot 웹 1shop 완주는 아직 아니다. 만료된 access token의 공유 refresh를 이 전용 작업에서 실행하지 않았고 운영 DB도 변경하지 않았다.

## 실제 seller/app/country/shop 범위

Shopee Seller Centre의 `Couplit.kr` / `gjrxn:main` 계정에서 아래 8개 country tab과 shop ID를 직접 확인했다. 동일 8개 ID가 활성 credential의 선언된 shop target에도 존재한다. 이는 실제 Seller Centre 가시성과 credential 선언의 일치 증거이며, 각 shop API token의 현재 성공 증거는 아니다.

| 국가 | Seller Centre shop | shop ID | Seller Centre 가시성 | access token | refresh token |
|---|---|---:|---|---|---|
| Singapore | `gjrxn.sg` | `1719148844` | 확인 | 2026-09-07 02:08 KST 만료 | 2026-10-06 22:08 KST까지 유효 메타데이터 |
| Taiwan | `gjrxnsy` | `1758392145` | 확인 | 2026-09-04 05:06 KST 만료 | 2026-10-04 01:06 KST까지 유효 메타데이터 |
| Thailand | `gjrxnbx.th` | `1758392144` | 확인 | 2026-09-04 05:06 KST 만료 | 2026-10-04 01:06 KST까지 유효 메타데이터 |
| Malaysia | `gjrxnnz.my` | `1758392135` | 확인 | 2026-09-04 05:06 KST 만료 | 2026-10-04 01:06 KST까지 유효 메타데이터 |
| Vietnam | `gjrxnpg.vn` | `1758392139` | 확인 | 2026-09-04 05:06 KST 만료 | 2026-10-04 01:06 KST까지 유효 메타데이터 |
| Philippines | `gjrxntd.ph` | `1758392137` | 확인 | 2026-09-04 05:06 KST 만료 | 2026-10-04 01:06 KST까지 유효 메타데이터 |
| Brazil | `gjrxnfs.br` | `1758392161` | 확인 | 2026-09-04 05:06 KST 만료 | 2026-10-04 01:06 KST까지 유효 메타데이터 |
| Mexico | `gjrxngp.mx` | `1758392178` | 확인 | 2026-09-04 05:06 KST 만료 | 2026-10-04 01:06 KST까지 유효 메타데이터 |

Open Platform 앱 메타데이터:

- 앱 `Couplit`, console app ID `228518`, 상태 `Online`
- live partner ID `2031489`, test partner ID `1228201`, main account ID `4940266`
- 앱 유형 `Seller In House System`, Sensitive Data access `Can access`
- live API Partner Key 만료 `2026-09-15 00:59 KST`; 원문 key는 기록하지 않음
- 활성 SellerPilot credential 외곽 레코드 만료 `2027-08-17 15:01 KST`; 개별 shop access token의 현재 유효성을 뜻하지 않음
- Live Push `OFF`; 설정을 변경하지 않음

## 첫 shop 증거 사다리

대상은 Singapore `1719148844`로 고정했다.

1. Seller Centre Review Management: 로그인/선택 shop 확인, 최근 화면 집계 `All 0`, `To Reply 0`, `Replied 0`, 평점 `0.0`, 받은 평점 없음.
2. provider GET: `scripts/shopee-comment-counts-get-only.mjs`가 활성 credential의 8개 shop을 해독 후 검사했으나 8개 모두 access token 만료를 감지해 호출 전에 중단했다. 결과는 `targetCount=8`, `readableShops=0`, `refreshRequiredShops=8`, `refreshReadyShops=8`, `failedShops=0`, `providerMutationPerformed=false`, `customerContentLogged=false`다. 따라서 0건 원격 응답으로 해석하지 않는다.
3. DB: 운영 DB에는 Shopee 후기/Returns migration `20260907200000`, `20260908045000`이 없고 Shopee CS ticket/job도 없었다. 운영 DB 변경 금지에 따라 적용하지 않았다. PGlite 격리 DB fixture의 Returns ingest/차단 시험만 통과했다.
4. SellerPilot 웹: CHANGHEE 준비 세션으로 Shopee 필터를 열었고 전체 문의 0, “구매자 채팅 수신 API 미연동”, “내부 초안만”을 표시했다. 후기/Returns 전용 shop 선택 및 과거수집 UI는 현재 노출되지 않는다. 이 0은 provider 후기 0의 DB 대조 증거가 아니다.

결론: Seller Centre 화면의 SG 후기 0과 SellerPilot 원장 0은 각각 관찰됐지만, 같은 시점의 provider `get_comment` 성공 응답 및 격리 DB 저장이 없어 원격/원장/웹 일치로 확정하지 않는다.

## 공식 계약 확인

### 상품 후기

- GET `/api/v2/product/get_comment`: shop-bound 서명 요청, `cursor`, `page_size` 1~100, 선택 `item_id`, `comment_id`. 응답에는 shop과 결속할 `comment_id`, `item_id`, `order_sn`, 평점, 수정 가능 상태, 숨김, 작성시각, 수정된 댓글 본문, `comment_reply`, 이미지/비디오 URL, `more`, `next_cursor`가 있다.
- 공식 설명에는 최대 1000개와 최대 500개라는 상충 문구가 동시에 있으며 요청에 날짜 범위가 없다. 따라서 “최근 30일”이나 “전체 기간”을 코드가 임의 확정할 수 없다. 현재 제공 가능한 범위는 provider cursor가 실제로 반환하는 corpus뿐이며, 상한 뒤 자료는 Shopee의 명시적 export/지원 답변이 필요하다.
- POST `/api/v2/product/reply_comment`: 한 요청 1~100개, 댓글당 1~500자, `result_list`의 comment별 실패를 검사해야 한다. SellerPilot 경로는 한 댓글만 전송하고 이번 delta에서 payload shop과 요청 shop/item/comment 결속을 POST 전에 재검사하도록 강화했다.

### Returns

- GET `/api/v2/returns/get_return_list`: `page_no`, `page_size<=100`, `create_time_from/to` 및 update 범위는 최대 15일.
- GET `/api/v2/returns/get_return_detail`: `return_sn`별 상세. 공식 응답에는 원래 사유/재평가 사유, 상태, 환불액/통화, 분쟁 사유, 협상, seller proof/compensation와 기한, 이미지/구매자 비디오, 역물류/검증/부분수량 상태가 있으며 주소·전화·email도 포함될 수 있다. 연락처와 주소는 저장 대상에서 제외해야 한다.
- 현재 adapter는 목록 100건, 상세 10건씩 continuation하며 return_sn mismatch를 차단한다. 격리 시험은 10+1건, 정확히 15일, 15일+1초 차단을 통과했다. 공통 normalizer가 `reassessed_request_reason`, 분쟁/금액/역물류 일부를 아직 보존하지 않는 문제는 `shopee-002`로 제출했다.

### Buyer Chat

- Seller Centre에는 Buyer Chat UI가 있고 SG 최근 30일 Chat enquiry 집계는 0이었다.
- Open Platform의 `v2.sellerchat.get_message` 공식 문서 접근은 현재 앱에서 `You have no permission of this document`였고 API Permissions에는 `No APP type can call this API`가 표시됐다. 앱의 허용 module 목록에도 SellerChat module 109가 없다.
- Live Push도 OFF다. 따라서 웹 UI 존재를 API 수신/history/reply 권한으로 간주하지 않는다. 현재 후기와 Returns 개발은 계속 가능하지만 Buyer Chat 모듈 구현은 권한·webhook event·history/reply·ack/retry/retention 계약을 Shopee가 서면으로 확인한 뒤 별도 모듈로 시작해야 한다.

## G1~G8

| 게이트 | 상태 | 증거 | 남은 행동 |
|---|---|---|---|
| G1 범위·권한 | 진행 | Seller Centre 8shop, 앱/partner/main account/만료 확인 | shared refresh CAS 후 shop별 GET 권한 실제 확인; Buyer Chat entitlement 별도 요청 |
| G2 로컬 경로 | 통과 | S0/branch/hash 일치, reply misbinding 차단, Returns allowlist/history planner, GET-only shop 실패 격리 | 공통 normalizer/UI/SQL 연결 후 재시험 |
| G3 실제 읽기 | 외부조건 대기 | 8/8 access 만료로 provider GET 미호출 | 통합 담당이 공유 credential을 target별 CAS refresh·원자 병합한 뒤 SG GET 실행 |
| G4 과거·웹 대조 | 진행 | SG Seller Centre 0, SellerPilot Shopee 원장 0이나 provider 대조 없음 | SG GET→격리 DB→인증 웹, 이후 7shop; 전용 history UI 추가 |
| G5 신규 수신 | 진행 | 주기 pull 설계 있음; Buyer Chat push OFF/권한 없음 | 후기/Returns pull 관측과 shop별 실패 표시; Chat 권한 후 webhook 별도 구현 |
| G6 답변 관측 | 진행 | exact shop/item/comment POST preflight와 provider result_list 검사 로컬 통과 | 승인된 실제 대상/문구가 있을 때만 전송하고 get_comment readback 확인 |
| G7 복구 | 진행 | 후기 cursor generation, Returns 15일/10건 continuation와 shop별 history planner 로컬 통과 | 첨부 fetch ledger, provider 상한 이후 공식 복구 경로 |
| G8 운영 적용 | 미착수 | 커밋/푸시/배포/운영 DB 변경 0 | 통합 담당 검토·migration·배포 후 실제 원격/DB/웹 재검증 |

## scope별 분모

| account/shop/kind/상태 | 기간 | 원격 고유 ID | 정상 | 중복/기존 | 격리 | 근거 있는 제외 | 미처리/gap |
|---|---|---:|---:|---:|---:|---:|---|
| main `4940266` / SG `1719148844` / review | provider cursor corpus / 현재 token 만료 | 미확인 | 0 | 0 | 0 | 0 | provider GET, 격리 DB, 웹 대조 |
| main `4940266` / 나머지 7shop / review | provider cursor corpus / 현재 token 만료 | 미확인 | 0 | 0 | 0 | 0 | SG 완주 후 동일 절차 |
| 8shop / Returns | 15일 이하 window 반복 | 미확인 | 0 | 0 | 0 | 연락처·주소·email | 실제 목록/상세/재개/웹 대조 |
| 8shop / Buyer Chat | 공식 계약 미확보 | 미확인 | 0 | 0 | 0 | 0 | app entitlement, push/webhook/history/reply 계약 |

## 소스 delta 및 검증

| 파일 | S0 SHA-256 | 현재 SHA-256 | 변경 |
|---|---|---|---|
| `lib/channels/shopee-inquiries.ts` | `166cf46aaf00da510dfd36c8a834793406db7abe9c3f9a4cbe8dca7afcb4bc0d` | `42f01cf02e697603bc7773eed21ebf21324aaa0b8b0f162a0c063955d707ae2f` | reply 대상 shop/item/comment fail-closed 결속 |
| `tests/shopee-return-refund.test.ts` | `24af77fcd532975942b11375d51fd7e664b8f6df17836d76bca1ebbb06a28e0f` | `bdde16439068d462dd0084b12ffb78c70c4839f6602cc56fc3bf6fb36b2e1f51` | 10/11, 15일 경계, 동일 comment ID 다중 shop, 오결속 reply 시험 |
| `scripts/shopee-comment-counts-get-only.mjs` | `0e99a8a1618e2f8a1070fc7fc2b6321fede64a8c6109fa326c8f2c4ed6c7f485` | `6667187c9d2f7c9f7dc0f304937a452d846d7f61278af0faeabdf29aae98756d` | 한 shop 예외를 안전 코드로 격리하고 다음 shop 계속 |
| `tests/shopee-return-refund-db.test.mjs` | `d71594ba6e04c855de1d264e5bf41b5c0299feb0a81b392e9ebe7a82d6113c2e` | 동일 | 수정 없음 |
| `lib/channels/cs/shopee/return-detail.ts` | 없음 | `f1432daeaaa2f775e55e869df6c75f4f8a4e24ff8db2c9c56e7dab793ea01e76` | 공식 Returns 상세 allowlist, PII branch 제외, revision digest |
| `lib/channels/cs/shopee/history-plan.ts` | 없음 | `ea999c70894a3f6bdfcf250fa885cefe299b46053ab3d1f093dc2f8f4697dd4d` | shop별 후기 cursor corpus와 Returns 15일 history window 계획; 실제 1초 경계 중첩 |
| `tests/cs-shopee-projection-history.test.ts` | 없음 | `844d37d6594488a6c40d19776eb4a39fda0ad64f6770cf87b466cce215feeaf0` | PII 제외, reassessed/media revision, shop/기간/엄격 경계 반례 |

검증 명령:

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test tests/shopee-return-refund.test.ts tests/shopee-return-refund-db.test.mjs tests/inquiry-sync-contract.test.ts tests/inquiry-reply.test.ts tests/channel-pagination.test.ts tests/serverless-cs-gateway.test.ts
```

- 결과: 123개 중 122 통과, 1 실패, exit 1.
- Shopee 신규/기존 관련 시험은 통과했다.
- 유일 실패는 공통 11번가 기대값 불일치다: `INQUIRY_CHANNEL_UNSUPPORTED` 기대, 실제 `INQUIRY_PAGE_INVALID:elevenst`. S0 이전 baseline에서도 같은 실패가 있었다. Shopee 파일에서 수정하지 않았다.
- Shopee 중심 묶음(`shopee-return-refund`, DB, inquiry-reply, channel-pagination)은 별도 실행에서 37/37 통과, exit 0이었다.
- 새 projector/planner와 엄격한 timestamp 경계 반례를 포함한 Shopee 중심 묶음은 43/43 통과, 수정 TypeScript ESLint 통과, 모두 exit 0이었다.
- S0 전용 폴더 GET-only 재실행(2026-09-08 19:11 KST)은 다시 `targetCount=8`, `readableShops=0`, `refreshRequiredShops=8`, `refreshReadyShops=8`, provider mutation 0을 반환했다.
- 통합 담당은 `shopee-001` 공용 gateway continuation 분기를 통합본에 반영했다. 읽기 검증한 통합 파일 SHA-256은 `9b16f3e8cd1b8c4163f45ebe8f248257cc180e35a975447ce6058b5661daa516`이다. DB 최종 wrapper/replay와 실제 경로 증거는 아직 남았다.
- 통합 담당은 최초 10-file Shopee delta를 통합본에 반영하고 8채널 최소회귀+gateway+projector/history 123/123 통과를 보고했다. 이후 history planner의 경계 리뷰 delta는 `delta-after-integration-001.json`로 별도 분리했다.

## 재개 보완 delta-002

통합 담당이 최초 Shopee delta와 1초 history 경계 보완을 반영한 뒤, 전용 폴더에서 다음 body-free 로직을 별도 보완했다. 통합본은 hash/인터페이스 읽기만 했고 수정하지 않았다.

- `lib/channels/cs/shopee/history-progress.ts`: 계획된 shop×kind scope에 page/interruption event를 결속하고, 원격 고유/정상/이벤트/중복/격리/제외/미처리, checkpoint, 알려진 detail 잔량, 남은 window를 projection한다. 같은 event replay는 다시 집계하지 않고, key 재사용 충돌·unplanned scope·빈 후기 page+next·반복 checkpoint를 차단한다.
- `lib/cs/channels/shopee/history-progress.ts`: API/UI가 projection만 수용하도록 `sellerpilot-shopee-history-progress/1` strict Zod read schema를 추가했다.
- `tests/fixtures/cs/shopee/history-resume.ts`: 고객 원문 없는 SG 후기 중단·재개, TW 403과 MY access 만료의 독립 격리, Returns 상세 10+1 중단·재개 fixture를 추가했다.
- `lib/channels/cs/shopee/detail-revision-reconciliation.ts`: stable `externalTicketId`/inbound key 검증, legacy remote revision attestation, append/duplicate/reconciliation-required 판정을 추가했다. Returns reply fence는 항상 `replySupported=false`, `ticketKind=after_sales`다.
- `docs/cs-parallel/proposals/shopee/shopee-004-history-progress-reconciliation-connection.md`: 공통 DB/API/UI, target-scoped 만료/403 격리, refresh CAS, detailRevision 조정의 정확한 preimage와 최소 연결안을 제출했다.

검증 결과:

- Node 22 focused test: 신규 progress/reconciliation 6개 + 기존 projection/planner 6개, 합계 12/12 통과, exit 0.
- 수정 TypeScript ESLint 통과, exit 0.
- 전체 TypeScript `tsc --noEmit` 통과, exit 0.
- `git diff --check` 통과.
- 운영 DB/provider/customer reply/credential refresh mutation 0. 이번 보완에서는 browser/profile action도 수행하지 않아 준비된 CHANGHEE 세션을 건드리지 않았다.

### 결과 단계 분리

| 단계 | 이번 보완 상태 | 증거와 제한 |
|---|---|---|
| 코드 | 전용 구현 완료·공통 통합 대기 | shop/kind progress, 중단 재개 fixture, strict read schema, detailRevision reconciliation, `shopee-004` |
| 실제 읽기 | 새 증거 없음 | 종전과 동일하게 8/8 access token 만료이며 refresh를 실행하지 않음 |
| 과거·웹 | projection/연결안만 완료 | provider GET→격리 DB→SellerPilot 웹 대조는 아직 0shop |
| 신규 수신 | 미증명 | 후기/Returns pull 운영 관측 없음; Buyer Chat 권한/Live Push 계약 미확보 |
| 답변 관측 | 미증명 | 승인 대상·문구가 없어 실고객 전송/readback 0; Returns action은 계속 차단 |
| 운영 | 미적용 | 커밋·푸시·배포·운영 migration/DB 변경 0 |

## 다음 행동

- 지금 가장 먼저 해야 하는 단일 행동: 통합 담당이 live partner `2031489`의 공유 Shopee credential에서 SG target만 refresh하고 credential version CAS/중복 refresh 방지/다른 7shop token 불변을 원격 저장 후 재확인한 뒤, SG `1719148844`에 대해 GET-only 스크립트를 재실행한다.
- 공통 변경 요청: `shopee-001`, `shopee-002`, `shopee-003`, `shopee-004`.
- 외부 선행조건: Buyer Chat은 Shopee 지원에 app `228518` / live partner `2031489`의 SellerChat module 109 entitlement와 webhook/history/reply 계약을 요청해야 한다. 이 외부 문의는 아직 전송하지 않았다.
- 전체 자동연동 제한: 한 shop 성공은 Shopee 완료가 아니다. 8shop 후기와 Returns, 신규 pull, 승인 답변+readback, Buyer Chat 권한/구현이 모두 실제 증거로 닫혀야 전체 완료다.
