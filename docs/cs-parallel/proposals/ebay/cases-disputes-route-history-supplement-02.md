# eBay 케이스·분쟁 route·UI·이력 보완 통합 요청 02

요청 ID: `EBAY-SHARED-004`. 통합 담당 처리 상태: 미반영.

## 고정 기준

- S0: `S0-20260908-decaba426812a3ba`, source HEAD `3cb72144e991626fae98a30cf51022d9a1aa6b0b`.
- 첫 delta: `docs/cs-parallel/reports/ebay/delta.json` 고정 보존.
- 첫 보완 delta: `docs/cs-parallel/reports/ebay/delta-supplemental-01.json` 고정 보존.
- 이번 변경은 첫 보완 delta의 after hash를 before hash로 사용하는 `delta-supplemental-02.json`으로만 제출한다.
- 공유 `app/page.tsx`, capability inventory, 공통 auth/OAuth/reply/history migration은 이 worktree에서 수정하지 않는다.

## 실제 route·UI client 검증

`tests/cs-ebay-cases-disputes-route.test.ts`는 route source와 전체 `lib/admin-api.ts` source를 같은 격리 VM에서 실행한다. `authenticateAdminRequest`를 대체하지 않고 Supabase SDK의 Auth/RPC 경계와 provider GET만 fixture로 둔다.

검증 입력과 출력:

- Authorization 없음 → 실제 auth helper가 HTTP 401 `ADMIN_SESSION_INVALID`, privileged client/provider call 0.
- 명시적 `session_expired` → HTTP 401, account discovery/decrypt/provider call 0.
- owner RPC에 없는 credential → HTTP 404, decrypt/provider call 0.
- `provider_certified_v1`이 아닌 seller → HTTP 409, decrypt/provider call 0.
- credential의 seller account key와 decrypted provider subject 불일치 → HTTP 409, provider call 0.
- payment-dispute provider HTTP 404 정규화 → route HTTP 200 안에 `availability=not_available_or_not_found`, `total=null`, entries 0. 빈 정상 결과로 바꾸지 않음.
- resolution-case provider HTTP 403 정규화 → `availability=authorization_required`, `total=null`, next 없음. 읽기 가능 상태로 바꾸지 않음.

UI는 `readEbayCaseDisputeUiResponse`를 사용한다. 격리 시험의 `authenticatedFetch`가 실제 exported GET route를 호출해 accounts와 payment/resolution 응답 schema를 끝까지 통과한다. 이는 실제 UI 데이터 호출 경로의 로컬 통합 증거이며 실제 브라우저 세션·운영 Supabase·provider 재호출 증거로 확대하지 않는다.

## 실행 가능한 이력 SQL 초안

초안: `docs/cs-parallel/proposals/ebay/ebay-case-dispute-history-ledger.sql`

격리 시험: `tests/cs-ebay-cases-disputes-db.test.mjs`

입력:

- active eBay credential ID
- 정확히 일치하는 provider-certified seller account key
- `resolution_case | payment_dispute` native namespace
- provider native ID/status/updated time
- 전용 adapter가 이미 whitelist 정규화한 safe JSON

출력:

- append-only 상태 event ID와 SHA-256, 신규 삽입 여부
- owner/admin 전용 이력 page
- 메시지 답변·환불·수락·이의제기·종결 queue와 무관한 별도 ledger

SQL 자체가 resource별 top-level key와 amount 하위 key를 whitelist로 검사한다. buyer note·주소·raw history 같은 추가 key, provider native ID/status 불일치, 다른 seller key, 비인증 credential은 insert 전에 거절한다. 같은 native ID·상태 JSON은 idempotent하며 상태가 바뀌면 새 event가 추가된다.

권한:

- record RPC: `service_role`만 EXECUTE.
- read RPC: `authenticated`만 EXECUTE하고 `auth.uid()` owner와 `sellerpilot_is_admin()`을 모두 확인.
- private table/sequence: `anon`, `authenticated`, `service_role` 직접 권한 없음; security-definer RPC만 접근.
- 다른 owner가 credential ID를 알아도 read RPC가 `42501`로 차단.

격리 PGlite는 실제 초안 SQL 전체를 실행한다. 첫 실행에서 `pg_catalog.coalesce` 문법 오류를 발견해 일반 SQL `coalesce` 구문으로 교정했고, 재실행 후 3/3 통과했다. 운영 DB에는 적용하지 않았다.

## 공유 UI 최소 patch

`app/page.tsx`는 통합 기준본과 전용 worktree가 동일하다. capability inventory는 다른 통합 작업으로 기준본이 앞서 갔으므로 아래 값은 전용 worktree가 아니라 현재 통합 기준본에서 다시 계산했다. 통합 담당은 각 before hash를 먼저 검증한다.

`app/page.tsx` before SHA-256: `153db8ff7e77c428acefbe560f03f0d4d2be3f4e6e4a5c1dcbb4f9d65943ba96`

```diff
 import { EbayMessages } from "./cs/ebay-messages";
+import { EbayCasesDisputes } from "./cs/channels/ebay/cases-disputes";
 ...
       <EbayMessages authenticatedFetch={authenticatedFetch} />
+      <EbayCasesDisputes authenticatedFetch={authenticatedFetch} />
```

예상 after SHA-256: `c3cd23b008082769ab1d38d82f48b51a7007e0a0e735ea0ba8ed750c516b44f6`.

`lib/cs/capability-inventory.ts` current integrated before SHA-256: `4627ecd29c07121ac050ed5e45ec02f7e23031eef3a2f99ad8dc8df244f68df5`

```diff
-  {key:"case_dispute",label:"케이스·분쟁",state:"unverified",receive:false,reply:false,history:false,attachments:false,note:"ASQ/Inbox와 별도 계약"},
+  {key:"case_dispute",label:"케이스·분쟁",state:"conditional",receive:true,reply:false,history:true,attachments:false,note:"resolution case는 공식 최대 18개월 GET 조회·payment dispute는 별도 GET; 현재 case readback 완료, payment dispute 404 확인 필요, 업무 mutation 분리"},
```

예상 after SHA-256: `12eb4660e8ff1be4b318fe61acb33ddbfe5cf003ca51e42cb5f901b2032503bd`.

before hash가 다르면 통째 복사하지 말고 현재 통합 파일에서 import/render/capability의 세 위치를 다시 검토한다.

## 통합 순서

1. delta 1과 supplemental 01을 순서대로 선택 적용하고 각 after hash를 확인한다.
2. supplemental 02의 client helper/UI/tests/SQL proposal을 선택 적용한다.
3. route·UI client 격리 시험과 TypeScript/ESLint를 실행한다.
4. SQL 초안을 새 migration 번호로 옮겨 격리 DB에서 다시 실행하고 공통 worker ingest를 별도 review한다.
5. 공유 UI 두 줄과 capability 한 줄을 현재 해시가 일치할 때만 적용한다.
6. 운영 DB migration, 스케줄 활성화, 실제 provider write는 별도 승인 전까지 금지한다.

Commerce 403, payment-dispute 404, ASQ 0, Inbox 9, 웹 From eBay 21은 서로 다른 표면의 증거다. 이 보완 시험과 resolution-case 18개월 0건으로 메시지 원장·웹 대조 또는 실제 답변 완료를 주장하지 않는다.
