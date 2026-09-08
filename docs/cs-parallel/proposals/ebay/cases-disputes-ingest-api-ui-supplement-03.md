# eBay 케이스·분쟁 ledger ingest→API→UI 통합 요청 03

요청 ID: `EBAY-SHARED-005`. 통합 담당 처리 상태: 미반영.

## 고정 버전

- S0: `S0-20260908-decaba426812a3ba`, source HEAD `3cb72144e991626fae98a30cf51022d9a1aa6b0b`.
- `delta.json`, `delta-supplemental-01.json`, `delta-supplemental-02.json`은 수정하지 않고 고정 보존한다.
- 이번 파일은 supplemental 02의 after hash를 before hash로 삼는 supplemental 03에 포함한다.

## 완성된 전용 연결

1. Provider GET·정규화
   - `lib/channels/cs/ebay/case-dispute-history-sync.ts`
   - Payment-dispute summary와 resolution-case search를 기존 strict adapter로 읽고 exact pagination을 끝까지 진행한다.
   - 404/403/unavailable은 count를 `null`로 유지하고 ledger RPC를 호출하지 않는다.
   - 다른 페이지에서 동일 native ID가 반복되거나 중간 페이지가 unavailable이면 완료로 처리하지 않는다.
2. Ledger ingest
   - `lib/channels/cs/ebay/case-dispute-history.ts`
   - Provider-normalized safe entry만 `sellerpilot_service_record_ebay_case_dispute_history_v1`로 기록한다.
   - credential UUID·seller account key·resource/native ID/status·receipt SHA-256을 재검증한다.
   - Resolution seller binding이 `not_checked`이면 DB RPC 전에 차단한다.
3. 관리자 수집 API
   - `app/api/admin/cs/channels/ebay/cases-disputes/history/sync/route.ts`
   - authenticated admin → owned credential → provider-certified seller key → vault decrypt → provider GET → service ledger RPC 순서다.
   - 요청 body는 4 KiB로 제한한다. Resolution 범위는 31일 이하이고 payment-dispute에는 날짜 범위를 허용하지 않는다.
   - POST는 provider write가 아니라 명시적 GET 수집과 내부 history insert만 수행한다. accept/contest/refund/close/appeal은 없다.
4. Owner history API
   - `app/api/admin/cs/channels/ebay/cases-disputes/history/route.ts`
   - authenticated owner-admin read RPC만 호출하며 service client·provider·decrypt를 사용하지 않는다.
   - `(observed_at,id)` 복합 cursor로 같은 timestamp의 event도 건너뛰지 않는다.
5. UI
   - `app/cs/channels/ebay/case-dispute-history.tsx`
   - `GET 수집 후 이력 저장`을 명시하고 수집 receipt 뒤 owner history API를 다시 읽는다.
   - Payment-dispute/MBG 이력을 분리 표시하며 메시지 답변·분쟁 업무 action은 제공하지 않는다.

## 실행 SQL 순서

통합 담당은 새 migration 번호 두 개를 배정하고 다음 순서로 옮긴다.

1. `docs/cs-parallel/proposals/ebay/ebay-case-dispute-history-ledger.sql`
2. `docs/cs-parallel/proposals/ebay/ebay-case-dispute-history-read-v2.sql`

첫 SQL은 safe append ledger와 service record v1을 만든다. 두 번째 SQL은 기존 v1을 확인한 뒤 owner read v2와 안정적인 복합 cursor를 추가한다. 둘 다 source drift에서는 덮어쓰지 않고 실패한다.

## 실제 격리 연결 증거

`tests/cs-ebay-cases-disputes-history-flow.test.ts`는 다음 경로를 실제 실행한다.

```text
fake eBay GET response
→ production normalizer
→ history sync adapter
→ sync POST route
→ service record RPC
→ PGlite ledger
→ owner read v2 RPC
→ history GET route
→ UI authenticatedFetch client/schema
```

Buyer/address fixture field가 production normalizer에서 제거된 뒤 ledger와 UI 응답에도 나타나지 않는지 확인한다. Local 404/403 fixture는 ledger RPC 0회이며 count `null`이다. 세 상태 event를 2+1페이지로 읽어 cursor 누락·중복이 0인지 확인한다. 이 시험은 실제 provider·운영 DB·브라우저를 호출하지 않는다.

## 공유 page 최소 patch

현재 통합 `app/page.tsx` before SHA-256: `153db8ff7e77c428acefbe560f03f0d4d2be3f4e6e4a5c1dcbb4f9d65943ba96`

```diff
 import { EbayMessages } from "./cs/ebay-messages";
+import { EbayCasesDisputes } from "./cs/channels/ebay/cases-disputes";
+import { EbayCaseDisputeHistory } from "./cs/channels/ebay/case-dispute-history";
 ...
       <EbayMessages authenticatedFetch={authenticatedFetch} />
+      <EbayCasesDisputes authenticatedFetch={authenticatedFetch} />
+      <EbayCaseDisputeHistory authenticatedFetch={authenticatedFetch} />
```

예상 after SHA-256: `30612b5384a489897c4678371f5e215931f5e2105efd248cab3f3c52ce695c6e`.

Capability inventory는 통합 기준본의 동시 변경을 보존한다.

- current integrated before: `4627ecd29c07121ac050ed5e45ec02f7e23031eef3a2f99ad8dc8df244f68df5`
- eBay `case_dispute` 한 줄만 conditional receive/history로 바꾼 expected after: `12eb4660e8ff1be4b318fe61acb33ddbfe5cf003ca51e42cb5f901b2032503bd`

공유 파일 before hash가 다르면 이 제안의 파일을 덮어쓰지 말고 import/render/capability 줄만 현재 통합본에서 다시 계산한다.

## 남은 통합 의존성과 외부 차단

통합 의존:

- 위 SQL 두 개에 실제 migration 번호 배정·격리 회귀 후 적용.
- 전용 supplemental 01→02→03 순서 적용.
- 공유 page import/render와 capability 한 줄 적용.
- 지속 수집이 필요하면 공통 scheduler가 18개월 초기 backfill을 31일 이하 창으로 enqueue하고, 이후 최근 창을 겹쳐 `syncEbayResolutionCaseHistoryWindow`와 `syncEbayPaymentDisputeHistory`를 호출하도록 연결. 전용 admin POST는 승인된 수동 복구 경로이며 자동 스케줄 증거가 아니다.

외부 차단:

- Commerce `FROM_MEMBERS`/`FROM_EBAY`: 실제 403, `commerce.message` 재동의 필요.
- Payment-dispute summary: 실제 404, app/account 가용 조건 확인 필요.
- 승인된 고객 답변과 원격 readback: 0.
- 실제 migration 적용 후 운영 ledger/API/UI buyer-visible readback: 0.

ASQ 0, Inbox 9, Commerce 403, Seller Hub From eBay 21, resolution-case 18개월 0은 서로 다른 범위와 native namespace다. 이 연결 시험으로 메시지 원장·웹 대조나 원격 답변 완료를 주장하지 않는다.
