# 공통 변경 요청 shopee-004

## 목적과 범위

- 목적: 실제 Shopee shop × `product_review`/`return_refund`별 과거수집 계획, page 관측, 중단 checkpoint, 남은 범위와 원격/정규화/중복/격리/제외/미처리를 DB/API/UI에 연결한다.
- 추가 목적: 새 Returns `detailRevision` 도입이 기존 `support_tickets.id`/`external_ticket_id`를 바꾸거나 같은 revision을 중복 append하지 않도록 사전 조정한다.
- S0: `S0-20260908-decaba426812a3ba`
- 통합 소스: `/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908`는 읽기 전용으로만 대조했다.
- 운영 변경: 이 제안에서는 migration 생성·적용, 운영 DB 쓰기, token refresh, provider mutation을 하지 않는다.

## 통합본 현재 preimage

| 공통 파일 | SHA-256 | 확인한 현재 동작 |
|---|---|---|
| `lib/channels/gateway-contract.ts` | `9b16f3e8cd1b8c4163f45ebe8f248257cc180e35a975447ce6058b5661daa516` | Shopee 후기/Returns continuation shape 수용 |
| `lib/channels/inquiry-sync.ts` | `c8d1caa1365246db9fbd500a9af97efdd82c630c40d098da13075aa81c24b464` | `projectShopeeReturnDetail`/`shopeeReturnDetailRevision` 연결 완료 |
| `lib/channels/sync-arguments.ts` | `17a7670bc5ed8ca6237c412aa80a30b36af337585d3a34f22cb540735424a7a2` | Shopee Returns 시간창만 생성; shop/review corpus 없음, 창 경계 중첩 없음 |
| `lib/channels/serverless-gateway-provider.ts` | `ad651326e01f0c993adbb390def46e3ca8153a8aba5645caa1ee747b41de1b90` | 한 job에서 target index 순회; 현재 shop `ok=false` 또는 refresh 예외면 뒤 shop 중단 |
| `lib/channels/inquiry-coverage.ts` | `c2dcb994c2852d7701f357a8f622eaa1541e574d638b5b49d1a4b0c89b8988fe` | `/1`은 provider count와 projected event digest만 기록; Shopee는 row/event 비비교 채널 |
| `app/api/channel-gateway/worker/complete/route.ts` | `41435b65a23dc4d12a9c47a37f8ac20d572a81afe8af1fb9171d004edb0f7e64` | `/1` coverage RPC만 호출 |
| `lib/cs/history-coverage.ts` | `601f486f4918cf61491a7dd3e7488b1e9763f24dfe1e431ff1c2bbe4893f9387` | generic scan/gap read schema; shop/checkpoint/remainder 없음 |
| `app/api/admin/cs/history-coverage/route.ts` | `a8faac8ced853a877ec4dcb15fcf5a6f4940d2c5879697e508b709473be2a6fd` | authenticated generic coverage read만 제공 |
| `app/cs/history-coverage.tsx` | `b3f629103e301aa488c50b9547732bc61b5cf14caa7dfc1eca751f3cce2435f1` | shop/kind와 cursor/window 잔량을 표시하지 않음 |
| `supabase/migrations/20260907231000_add_cs_history_coverage_ledger.sql` | `cf1f0941c7cc21b0604ca20d3b817914cb62c07659858d648e7e3e37fbc02c19` | `root_job_id unique`인 한 scan으로 target 8개가 합쳐질 수 있음 |
| `supabase/migrations/20260908045000_enable_shopee_return_refund_cs.sql` | `75a4239e9d2c388894276e4ce3ca1341e2d3c29e258e97f05df21a13bd33da60` | exact return identity/read-only reply fence 유지 |

전용 통합본 hash도 재확인했다: `history-plan.ts` `ea999c70894a3f6bdfcf250fa885cefe299b46053ab3d1f093dc2f8f4697dd4d`, `return-detail.ts` `f1432daeaaa2f775e55e869df6c75f4f8a4e24ff8db2c9c56e7dab793ea01e76`.

## 전용 구현 계약

통합 담당이 그대로 import할 경로와 export:

```ts
import {
  projectShopeeHistoryProgress,
  shopeeHistoryRecordDigest,
  type ShopeeHistoryEvent,
} from "./cs/shopee/history-progress.ts";
import {
  reconcileShopeeReturnDetailRevision,
  shopeeReturnInboundKey,
  shopeeReturnLegacyRemoteMessageId,
} from "./cs/shopee/detail-revision-reconciliation.ts";
import { shopeeHistoryProgressSchema } from "../cs/channels/shopee/history-progress.ts";
```

- projection 출력 계약: `sellerpilot-shopee-history-progress/1`
- revision 조정 출력 계약: `sellerpilot-shopee-return-revision-reconciliation/1`
- 고객 본문·전화·주소·email은 입력/출력하지 않는다. 원격 identity와 cursor는 shop/kind를 포함한 SHA-256 digest만 원장/API에 남긴다.
- 동일 `eventKey`+동일 payload replay는 집계에서 한 번만 반영하고 `replayedEventCount`만 올린다. 같은 key의 다른 payload, unplanned scope, outcome 충돌, 빈 후기 page+next, 반복 checkpoint는 fail closed다.
- Returns checkpoint는 `pendingDetailCount`, `nextListPageNo`, epoch/depth를 분리한다. 후기 cursor corpus에는 가짜 전체 건수나 가짜 날짜 분모를 만들지 않는다.

## 최소 공통 연결 patch

### 1. 실제 shop 계획을 page 실행 전에 고정

`lib/channels/sync-arguments.ts`의 Shopee 분기는 다음 두 논리 요청을 모두 만들어야 한다.

1. 후기: `kind=product_review`, `cursor=""`, `pageSize=100`, coverage=`provider_cursor_corpus`.
2. Returns: 전용 `planShopeeReturnHistory`와 동일한 최대 15일 및 실제 1초 중첩 규칙. 현재 `end=15일-1초`, 다음 `end+1초` 방식은 엄격한 endpoint 제외 provider에서 경계 1초를 잃을 수 있으므로 사용하지 않는다.

실제 shop ID는 복호화된 credential target을 가진 `executeAllShopeeShopInquiries`에서만 확정한다. provider 호출 전에 아래 body-free 계획을 service-role plan RPC에 1회 idempotent 기록한다.

```ts
const plannedScopes = [
  ...planShopeeReviewHistory(actualShops),
  ...planShopeeReturnHistory(actualShops, requestedRange),
];
```

plan RPC의 idempotency key는 `(owner_id, credential_id, history_run_id, scope_key)`다. 선언된 최대 8shop이 아니라 실제 decrypt/validation을 통과한 target만 계획에 포함한다. target 수가 0, 중복 shop ID, country/shop 불일치면 provider 호출 전에 실패한다.

### 2. `/1`을 보존하고 Shopee body-free `/2` page event 추가

`lib/channels/inquiry-coverage.ts`에 Shopee 분기만 additive로 추가한다. 기존 채널 `/1` 반환은 바꾸지 않는다.

```ts
type ShopeeInquiryCoverageV2 = InquiryCoverageEvidence & {
  contractVersion: "sellerpilot-inquiry-coverage/2";
  shopeeHistoryEvent: ShopeeHistoryEvent;
};
```

- `scopeKey`는 `shopee:${shopId}:product_review:cursor-corpus` 또는 `shopee:${shopId}:return_refund:${from}-${to}` exact match만 허용한다.
- review remote digest는 `(shopId, product_review, comment_id)`, Returns remote digest는 `(shopId, return_refund, return_sn)`을 `shopeeHistoryRecordDigest`로 생성한다.
- `normalizedRecordDigests`는 실제 정상 정규화된 remote identity만, `projectedEventDigests`는 현행 `inboundKey` digest를 기록한다. 한 후기의 buyer+observed seller reply가 2 event가 될 수 있으므로 두 분모를 합치지 않는다.
- `isolatedRecordDigests`/`excludedRecordDigests`는 실제 격리/정책 제외가 발생했을 때만 기록한다. 예외로 page 전체가 rollback된 경우 정상 0으로 꾸미지 않고 interruption event로 남긴다.
- raw cursor/return_sn/comment_id는 DB event payload에 기록하지 않는다. cursor/queue를 포함한 continuation의 canonical digest와 UI용 안전 잔량만 기록한다.

`app/api/channel-gateway/worker/complete/route.ts`는 `/2`일 때 새 service-role event RPC를 호출한다. completion receipt, claim token, active worker token 검증을 현행 `/1`과 동일하게 선행하고, event의 shop ID가 해당 실행 target과 일치하지 않으면 전체 transaction을 거부한다.

### 3. 한 shop 만료/403이 뒤 shop을 막지 않는 안전한 continuation

이 항목은 `shopee-003`의 공통 blocker와 같은 원인이다. 최소 안전 계약은 실패를 성공으로 바꾸지 않는 target-scoped fan-out이다.

- root history plan에서 shop×kind×window별 독립 child job을 생성한다. 각 child request에는 서버가 고정한 `shopId`, `scopeKey`, `historyRunId`와 credential version을 넣는다.
- child 실행 시 credential target `shop_id`와 request `shopId`가 exact match해야 한다. 임의 request shop 선택은 금지한다.
- 한 child의 token 만료/401/403은 그 scope에 `authorization_required` interruption을 append하고 그 child만 terminal 처리한다. 다른 shop child는 계속 claim 가능하다.
- refresh는 `(credential_id, base_version, shop_id)` CAS 단일 writer로 시작하고 최신 payload에 그 shop target만 merge한다. 같은 target 동시 refresh는 한 번만 provider 호출하고, 다른 target token은 byte-for-byte 불변 readback을 요구한다.
- 현재 `if (!shopResult.ok) return shopResult` 뒤에 단순 `continue`를 넣는 방식은 실패 원장/credential CAS가 없으므로 금지한다.

fan-out을 한 migration에서 끝낼 수 없다면 임시 partial continuation을 허용할 수 있지만, `ok=false` job과 failed scope event를 먼저 원자 저장한 뒤 다음 target child가 생성되어야 한다. 실패를 `ok=true` synthetic step으로 바꾸면 안 된다.

### 4. DB는 append-only plan/event, API는 projection만 반환

통합 담당이 번호를 배정한 새 migration에서 다음 private 객체를 추가한다. 기존 migration 파일을 수정하지 않는다.

- `sellerpilot_private.cs_shopee_history_scopes`: owner/credential/history run/scope/shop/country/kind/coverage/range, unique `(owner_id,credential_id,history_run_id,scope_key)`.
- `sellerpilot_private.cs_shopee_history_events`: scope FK, `event_key`, sequence, type, body-free digest/count/checkpoint JSON, event digest. unique `(scope_id,event_key)`이며 동일 key/다른 digest는 거부한다.
- raw customer body와 raw cursor를 저장하는 column은 만들지 않는다.
- service write RPC는 plan과 event를 별도 함수로 두고 completion receipt/claim token/worker token/credential owner/target shop을 다시 대조한다.
- authenticated read RPC는 `auth.uid()=owner_id`인 plan/event만 반환한다. API route가 `projectShopeeHistoryProgress`를 호출한 뒤 `shopeeHistoryProgressSchema.parse`한 projection만 browser로 보낸다.

권한은 명시적으로 다음을 지킨다.

```sql
alter table sellerpilot_private.cs_shopee_history_scopes enable row level security;
alter table sellerpilot_private.cs_shopee_history_events enable row level security;
revoke all on sellerpilot_private.cs_shopee_history_scopes,
  sellerpilot_private.cs_shopee_history_events
  from public, anon, authenticated, service_role;
revoke all on function public.<write_plan_rpc>(...) from public, anon, authenticated, service_role;
grant execute on function public.<write_plan_rpc>(...) to service_role;
revoke all on function public.<write_event_rpc>(...) from public, anon, authenticated, service_role;
grant execute on function public.<write_event_rpc>(...) to service_role;
revoke all on function public.<read_rpc>() from public, anon, service_role;
grant execute on function public.<read_rpc>() to authenticated;
```

모든 public RPC는 `security definer set search_path=''`, owner=`postgres`, argument size/count/digest regex 제한을 가져야 한다. private schema 비노출 기본값이나 Data API 기본 설정에 의존하지 않고 table grant와 function execute를 모두 명시한다. service-role key를 client bundle에 넣지 않는다.

### 5. API/UI additive 연결

- 권장 API: Shopee 소유 경로 `app/api/admin/cs/channels/shopee/history-progress/route.ts`. 현행 `authenticateAdminRequest`의 authenticated `userClient`로 read RPC만 호출하고 `cache-control: private, no-store`를 유지한다.
- 공통 `app/api/admin/cs/history-coverage/route.ts`를 수정해야 한다면 기존 응답을 깨지 말고 optional `channelProgress.shopee`만 추가한다.
- 권장 UI: Shopee 소유 경로 `app/cs/channels/shopee/history-progress.tsx`; 공통 `app/cs/history-coverage.tsx`에는 component mount만 추가한다.
- shop/kind 카드마다 status, 계획/완료 scope 수, 원격 고유, 정상, 중복, 격리, 제외, 미처리, 남은 window keys, checkpoint 존재, 알려진 detail 잔량, provider remainder unknown을 각각 표시한다.
- 후기 `pending`/`partial`은 “전체 N건 중”으로 표시하지 않는다. `provider cursor corpus · 남은 분모 미공개`로 표시한다.
- 한 shop `authorization_required` 배너는 다른 shop의 complete 카드를 가리지 않는다.

### 6. `detailRevision` 기존 원장 조정

`lib/channels/inquiry-sync.ts::normalizeShopeeReturn`에서 새 outer revision을 만들기 직전에 전용 `shopeeReturnLegacyRemoteMessageId`로 예전 알고리즘의 remote ID를 같은 raw response에서 계산한다. 이 값은 providerContext의 body-free `revisionReconciliation.legacyRemoteMessageId`로 service ingest에만 전달하고 고객 본문과 섞지 않는다.

ingest wrapper는 append 전에 같은 `(owner, shopee, externalTicketId)` 원장의 metadata만 읽어 `reconcileShopeeReturnDetailRevision`과 동일하게 판정한다.

1. 기존 원장 없음: 새 ticket.
2. 같은 inbound/remote/detail revision 있음: duplicate, append 0.
3. 기존에 `detailRevision` 있음 + 새 detail revision: 같은 ticket에 inbound revision 1건 append.
4. 기존 legacy message에 새로 계산한 `legacyRemoteMessageId`가 exact match: 같은 ticket에 새 detail revision 1건 append.
5. legacy match를 입증할 수 없음 또는 shop/return identity mismatch: append하지 말고 `reconciliation_required` 격리.

`externalTicketId=shopee:return:${shopId}:${returnSn}`와 기존 `support_tickets.id`는 유지한다. 삭제/overwrite/re-key하지 않는다. 새 `remoteMessageId`로 계산한 `inboundKey`만 append할 수 있다. `ticketKind=after_sales`, `replySupported=false`, `replyContext={}` fence는 모든 분기에서 유지한다.

## 필요한 시험

통합 담당은 전체 회귀를 반복하기 전에 아래 최소 묶음을 실행한다.

1. 전용 `tests/cs-shopee-history-progress.test.ts`: 중단 후 exact checkpoint 재개, 10+1 detail, replay append 0, 같은 comment ID 다중 shop, 403/만료 shop과 성공 shop 분리, 빈 page+next, 반복 cursor.
2. generic coverage DB: 같은 root run의 2shop×2kind가 4개 독립 scope로 읽히고 한 scope 실패가 다른 complete를 바꾸지 않음.
3. interruption transaction: failed page/event 저장 후 다음 shop child 생성이 원자적이며 재실행 시 child 중복 0.
4. refresh: 같은 shop 동시 refresh 1회, 다른 shop 동시 refresh merge, stale version 거부, 비대상 target 불변 remote readback.
5. revision reconciliation DB: legacy exact match는 stable ticket ID에 1 append, 같은 새 revision 재실행 append 0, unattested/mismatched identity는 격리, Returns reply route 계속 차단.
6. ACL: anon/public/service-role read 거부, authenticated owner-only read, authenticated write 거부, service-role receipt-bound write만 허용.

전용 실행 명령:

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test \
  tests/cs-shopee-history-progress.test.ts \
  tests/cs-shopee-projection-history.test.ts
```

## 완료 판정 제한

이 patch와 격리 시험은 실제 provider GET, 실제 DB 적용, SellerPilot 웹 표시, 신규 수신, 승인된 후기 답변/readback, Buyer Chat 권한을 증명하지 않는다. SG 한 shop이 나중에 성공해도 다른 7shop과 Returns/Buyer Chat 완료로 확대 보고하지 않는다.
