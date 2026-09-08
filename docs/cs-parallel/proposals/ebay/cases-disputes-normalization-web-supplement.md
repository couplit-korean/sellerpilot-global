# eBay 케이스·분쟁 정규화·웹·이력 보완 통합 요청

요청 ID: `EBAY-SHARED-003`. 통합 담당 처리 상태: 미반영.

## 기준과 실제 입력

- S0: `S0-20260908-decaba426812a3ba`, source HEAD `3cb72144e991626fae98a30cf51022d9a1aa6b0b`.
- 통합 기준본: `/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908` 읽기 전용.
- seller/account 입력: provider-certified eBay account key와 그 credential ID, environment, marketplace ID.
- remote 입력: payment-dispute `offset/limit`; resolution-case `offset/limit/startTime/endTime`이며 한 범위는 31일 이하.
- 공식 계약: Post-Order search/known-case는 `Authorization: IAF <token>`, production only, 검색 시작일 최대 18개월. Sell Fulfillment payment-dispute는 `Bearer <token>`.
- 실제 readback: resolution search는 18개월 19개 창 모두 HTTP 200·고유 0; payment-dispute summary는 HTTP 404라 total/ID 집합 `null`.

## 전용 파일 입력·출력

통합할 새 eBay 전용 파일은 `delta-supplemental-01.json`의 해시와 일치하는 것만 선택 적용한다.

- provider 정규화: `lib/channels/cs/ebay/cases-disputes.ts`
- client schema: `lib/cs/channels/ebay/cases-disputes.ts`
- admin GET route: `app/api/admin/cs/channels/ebay/cases-disputes/route.ts`
- 읽기 전용 UI: `app/cs/channels/ebay/cases-disputes.tsx`와 CSS
- fake fixture 5개와 집중 시험 2개
- 기본 dry-run 진단: `scripts/cs-ebay-cases-disputes-get-only.mjs`

출력은 provider native ID, 안전한 status/date/amount/order-or-transaction identity, seller 결속 상태만 포함한다. buyer username·주소·note·case history raw text·token은 반환하지 않는다. unavailable/404에서는 entries가 비어 있어도 total을 0으로 확정하지 않는다.

지원 응답은 `false`다. accept/contest/refund/close/appeal은 상담 답변이 아니라 금전·분쟁 업무 mutation이므로 route/UI/adapter에 존재하지 않는다.

## 공유 UI 최소 patch

현재 통합 기준 해시와 이 worktree의 공유 파일 해시는 같다.

- `app/page.tsx` before SHA-256: `153db8ff7e77c428acefbe560f03f0d4d2be3f4e6e4a5c1dcbb4f9d65943ba96`
- 아래 patch 단독 적용 예상 after SHA-256: `c3cd23b008082769ab1d38d82f48b51a7007e0a0e735ea0ba8ed750c516b44f6`

```diff
 import { EbayMessages } from "./cs/ebay-messages";
+import { EbayCasesDisputes } from "./cs/channels/ebay/cases-disputes";
 ...
       <EbayMessages authenticatedFetch={authenticatedFetch} />
+      <EbayCasesDisputes authenticatedFetch={authenticatedFetch} />
```

- `lib/cs/capability-inventory.ts` before SHA-256: `a0e72d200e7d7cc6ab22c47c74be31875b3c2a161672467cc53beca0b86f763e`
- 아래 patch 단독 적용 예상 after SHA-256: `56123e9b484f612669bc4022b462cd17ca3501fc55fc30f023611c1fe50689b5`

```diff
-  {key:"case_dispute",label:"케이스·분쟁",state:"unverified",receive:false,reply:false,history:false,attachments:false,note:"ASQ/Inbox와 별도 계약"},
+  {key:"case_dispute",label:"케이스·분쟁",state:"conditional",receive:true,reply:false,history:true,attachments:false,note:"resolution case는 공식 최대 18개월 GET 조회·payment dispute는 별도 GET; 현재 case readback 완료, payment dispute 404 확인 필요, 업무 mutation 분리"},
```

통합 시 before hash가 다르면 이 patch를 적용하지 말고 현재 줄을 재검토한다. 공유 파일을 전용 worktree 버전으로 통째로 덮어쓰지 않는다.

## 공통 이력 SQL 초안

실제 migration 번호는 통합 담당이 배정한다. 기존 문의·답변 테이블에 합치지 말고 전용 event ledger를 추가한다.

```sql
create table sellerpilot_private.ebay_case_dispute_history_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null,
  seller_account_key text not null check (length(seller_account_key)=64),
  environment text not null check (environment in ('production','sandbox')),
  resource_kind text not null check (resource_kind in ('resolution_case','payment_dispute')),
  provider_native_id text not null check (length(trim(provider_native_id)) between 1 and 240),
  provider_status text not null check (provider_status ~ '^[A-Z][A-Z0-9_]*$'),
  provider_updated_at timestamptz,
  normalized_safe jsonb not null check (jsonb_typeof(normalized_safe)='object'),
  observed_state_sha256 text not null check (observed_state_sha256 ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null default now(),
  unique(owner_user_id,credential_id,environment,resource_kind,provider_native_id,observed_state_sha256)
);
alter table sellerpilot_private.ebay_case_dispute_history_events enable row level security;
revoke all on sellerpilot_private.ebay_case_dispute_history_events from public,anon,authenticated;
```

공통 ingest 함수는 service-role 내부 전용으로 만들고 owner/credential/provider-certified seller key를 재검증한다. `normalized_safe` 허용 key를 resource별 whitelist로 검사하며 buyer/customer raw field가 하나라도 있으면 전체 row를 거절한다. read RPC는 인증 사용자의 owner row만 반환하고 native ID namespace를 `ebay:resolution_case:`와 `ebay:payment_dispute:`로 분리한다. 이 ledger는 reply queue 또는 금전 mutation queue의 입력이 아니다.

## 적용 선후관계와 회귀 시험

1. supplemental delta의 eBay 전용 파일 hash 확인 후 선택 적용.
2. 전용 집중 시험과 TypeScript/ESLint 통과.
3. 공유 UI 두 줄 patch 적용 후 빌드/인증된 UI에서 GET만 발생하는지 확인.
4. SQL은 별도 migration review·격리 PGlite 시험 후에만 적용. 운영 DB 적용은 별도 승인 대상.
5. payment-dispute 404의 app/account 가용 조건을 확인하기 전 capability를 `implemented`로 올리지 않는다.

필수 시험: IAF/Bearer 분리, 다른 seller key, Sandbox 차단, 18개월·31일 범위, empty+hasMore, missing total, 반복/적대 cursor, header/detail ID mismatch, 같은 본문 다른 native ID, buyer raw field 저장 거절, unavailable을 total 0으로 오인하지 않음, FROM_EBAY 및 case/dispute 업무 mutation 답변 차단, 관리자 세션 만료, 다른 owner credential 접근 차단.

공식 참고:

- <https://developer.ebay.com/devzone/post-order/post-order_v2_casemanagement_search__get.html>
- <https://www.developer.ebay.com/Devzone/post-order/concepts/MakingACall.html>
- <https://developer.ebay.com/develop/api/sell/fulfillment_api>
