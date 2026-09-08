# Qoo10 reply legacy 호환 및 S3 readback 공통 연동 제안 qoo10-006

## 결론

Qoo10 답변은 `SetInquiryMessage`의 성공 응답을 전달 완료로 간주하지 않는다. 승인된 최신 고객 inbound와 정확히 일치하는 일반 문의만 enqueue하고, 같은 `INQ_TYPE + QUESTION_NO + SEQ_NO`가 고정 기간의 S3 조회에서 다시 관측될 때 `status observed`로만 검증한다. S3 응답이 답변 본문을 주지 않으므로 본문 일치 증거로 승격하지 않는다. 미관측·오순번·provider 오류는 모두 자동 재송신 금지다.

- S0: `S0-20260908-decaba426812a3ba`
- 전용 export: `resolveQoo10ReplyLineage`, `prepareQoo10Reply`, `prepareQoo10GatewayReply`, `buildQoo10S3ReadbackArguments`, `verifyQoo10S3Readback`, `executeQoo10ReplyS3Readback`
- claim/refund/exchange/상품/주문/배송 mutation: 모두 범위 밖이며 reply 대상으로 허용하지 않는다.

## 통합본 preimage

| 공통 파일 | SHA-256 |
|---|---|
| `app/api/admin/cs/reply/route.ts` | `fc458b2225c7c8a28994152bdf68056f41226424e14f2108521828c7489492f1` |
| `lib/channels/inquiry-reply.ts` | `5149a66737b7b174279c336e1b77e72861bdefd22fa84a7c2becd4782f3e87c0` |
| `lib/channels/inquiry-sync.ts` | `c8d1caa1365246db9fbd500a9af97efdd82c630c40d098da13075aa81c24b464` |
| `lib/channels/reply-verification.ts` | `80c67ac824fc065b8b69ffdbcd75a5bc327e08d49c7f5404b1267c809314808c` |
| `app/api/channel-gateway/worker/complete/route.ts` | `41435b65a23dc4d12a9c47a37f8ac20d572a81afe8af1fb9171d004edb0f7e64` |
| `app/use-operations-snapshot.ts` | `3176a281ab994d1e259591e2d53633329ff414e7b51972dd48bb6c846228704a` |
| `app/page.tsx` | `153db8ff7e77c428acefbe560f03f0d4d2be3f4e6e4a5c1dcbb4f9d65943ba96` |
| `supabase/migrations/20260907232000_add_cs_reply_remote_observation.sql` | `b1079308ccc2a01fc4985c98e62e3f3437cf8ebda1e9c405b5abe9c778a3acb5` |

## Before / after

| 경계 | Before | After |
|---|---|---|
| legacy ticket | `qoo10:TYPE:question:sequence` 파싱만 함 | 기존 ID 완전 호환 + provider/reply context exact match |
| thread v2 | 미지원 | 실제 다중 sequence 증거와 alias 원장이 있을 때만 `qoo10:v2:TYPE:question` 허용 |
| stale reply | route의 최신 inbound 검사와 builder가 분리 | builder도 selected/latest/approval/context를 fail closed 검증 |
| provider ACK | `provider_accepted` | 그대로 유지하되 delivery proof 아님 |
| remote readback | 일반 normalization/본문 observation에 의존 | Qoo10 전용 S3 exact-identity 상태 관측을 별도 저장 |
| 불확실 결과 | generic retry 가능성 | absent/wrong sequence/nonterminal/transport error 모두 `resendAllowed=false` |

## 정확한 공통 reply patch

`app/api/admin/cs/reply/route.ts`에서 Qoo10 분기만 전용 guard로 보낸다. 다른 채널 builder는 그대로 둔다.

```diff
diff --git a/app/api/admin/cs/reply/route.ts b/app/api/admin/cs/reply/route.ts
--- a/app/api/admin/cs/reply/route.ts
+++ b/app/api/admin/cs/reply/route.ts
@@
 import { buildInquiryReplyArguments, supportsInquiryReply } from "../../../../../lib/channels/inquiry-reply";
+import { prepareQoo10GatewayReply } from "../../../../../lib/channels/cs/qoo10/reply-guard";
@@
   const externalTicketId = typeof ticket?.external_ticket_id === "string" ? ticket.external_ticket_id : "";
   const providerContext = objectRecord(ticket?.provider_context) ?? {};
+  const replyContext = objectRecord(ticket?.reply_context) ?? providerContext;
@@
-    const replyArguments = buildInquiryReplyArguments(channel, externalTicketId, parsed.data.reply, providerContext);
+    const replyArguments = channel === "qoo10"
+      ? prepareQoo10GatewayReply({
+          externalTicketId,
+          replyText: parsed.data.reply,
+          replyContext,
+          providerContext,
+          selectedInboundKey: parsed.data.expectedInboundKey,
+          latestInboundKey: String(ticket.latest_inbound_key),
+          approved: true,
+        }).arguments
+      : buildInquiryReplyArguments(channel, externalTicketId, parsed.data.reply, providerContext);
```

`prepareQoo10Reply(...).params`를 직접 넘기면 실제 gateway payload가 `arguments={inq_type,...}`가 되어 adapter가 요구하는 `arguments.params`가 사라진다. 반드시 `prepareQoo10GatewayReply(...).arguments`, 즉 `{params:{inq_type,question_no,seq_no,contents}}`를 넘긴다. 이 envelope는 전용 회귀에서 route helper → `enqueueInquiryReplyViaChannelGateway` RPC payload → `executeQoo10Inquiry`/`SetInquiryMessage`까지 재생한다.

`failureMessage`에는 Qoo10 guard 오류를 고객 원문이나 ID 없이 같은 fail-closed 안내로 매핑한다.

```diff
+  if (/QOO10_REPLY_(?:APPROVAL_REQUIRED|STALE_TARGET|TARGET_INVALID)/u.test(message)) {
+    return "Qoo10의 최신 고객 문의와 답변 대상을 다시 확인해 주세요. 답변은 접수하지 않았습니다.";
+  }
```

`lib/channels/inquiry-reply.ts`의 기존 legacy 파서는 호환 fallback으로 남기되, admin reply route에서 Qoo10이 이 fallback에 도달하지 않는 테스트를 추가한다. `inquiry-sync.ts`의 ticket ID는 실제 다중 sequence 표본이 없으므로 지금 바꾸지 않는다.

## v2 alias 활성화 조건

`qoo10:v2:TYPE:question`은 다음 조건을 모두 만족할 때만 허용한다.

1. `providerContext.ticketIdentityVersion === 'qoo10-thread-v2'`.
2. 최신 inbound의 `replyContext.legacyExternalTicketId`가 실제 `TYPE/question/sequence`에서 계산한 legacy ID와 일치.
3. DB가 제공한 `providerContext.legacyExternalTicketIds` 배열에 그 legacy ID가 포함.
4. type/question은 v2 root와 정확히 일치.
5. sequence는 숫자형 문자열이고 현재 provider 상태가 S3/ANSWER/COMPLETE가 아님.

실제 QAPI/QSM 표본으로 같은 question의 여러 sequence가 한 대화임이 증명되기 전에는 DB가 1~3의 attestation을 생성하지 않는다. 따라서 현재 운영 동작은 legacy만 허용한다.

## S3 readback enqueue/complete 계약

공급자 ACK를 기록한 같은 transaction에서 다음 read-only job을 새로 enqueue한다.

```json
{
  "periodicKey": "inquiries:reply-readback:qoo10:<delivery-id>",
  "arguments": {
    "params": {
      "search_start_dt": "<approved inbound의 고정 JST 시작>",
      "search_end_dt": "<동일 고정 JST 종료>",
      "proc_status": "S3"
    },
    "sellerpilotQoo10ReplyReadback": {
      "contractVersion": "sellerpilot-qoo10-reply-readback/1",
      "deliveryId": "<uuid>",
      "inquiryType": "MSG|HELP|ITEM",
      "questionNo": "<digits>",
      "sequenceNo": "<digits>"
    }
  }
}
```

공통 worker 실행은 기존 `inquiries.list` 경로만 사용한다. metadata가 있는 Qoo10 readback job의 completion 순서는 다음과 같이 고정한다.

1. worker가 보낸 전체 `ChannelOperationResult`를 기존 schema로 검증한다.
2. 기존 `sellerpilot_service_complete_gateway_transaction`을 먼저 호출한다. 이 transaction이 동일 claim의 `channel_gateway_jobs.response_payload`와 `gateway_completion_receipts`를 함께 저장해야 한다.
3. 그 transaction의 성공 또는 exact replay를 확인한 뒤에만 아래 Qoo10 RPC를 호출한다. RPC 호출 인자의 `state/reason/matchingRows`는 저장 명령이 아니라 애플리케이션 측 예상값이다.
4. Qoo10 RPC가 DB에 이미 저장된 `response_payload.steps[0].data`를 다시 읽고 `ResultCode`, 결과 배열, `INQ_TYPE + QUESTION_NO + SEQ_NO`, terminal status를 독립적으로 판정한다. 호출 인자와 DB 판정이 하나라도 다르면 `QOO10_REPLY_S3_READBACK_EVIDENCE_MISMATCH`로 delivery를 전혀 변경하지 않는다.

따라서 `verifyQoo10S3Readback`만 호출한 뒤 아직 저장되지 않은 결과를 RPC 인자로 넘기는 순서는 금지한다. completion receipt가 없거나, receipt의 claim/worker가 다르거나, 저장된 결과가 다른 행인데 호출자가 `verified`를 주장하면 모두 실패해야 한다.

```ts
const verification = verifyQoo10S3Readback({
  target: { inquiryType, questionNo, sequenceNo },
  data: inquiryResult.steps[0]!.data,
});
const completion = await serviceClient.rpc("sellerpilot_service_complete_gateway_transaction", {
  // 기존 공통 completion 인자. p_response_payload에는 inquiryResult 전체를 저장한다.
});
if (completion.error || completion.data?.status !== "completed") {
  // status-only 기록을 시도하지 않는다.
}
await serviceClient.rpc("sellerpilot_service_record_qoo10_reply_s3_readback_v1", {
  p_token_hash: tokenHash,
  p_job_id: parsed.data.jobId,
  p_claim_token: parsed.data.claimToken,
  p_delivery_id: deliveryId,
  p_state: verification.state,
  p_reason: verification.reason,
  p_matching_rows: verification.matchingRows,
  p_reply_content_observed: false,
  p_resend_allowed: false,
});
```

### 저장 결과 신뢰경계와 변조 차단

- 상태 판정의 정본은 HTTP body나 두 번째 RPC의 `p_state`가 아니라, 기존 atomic completion transaction이 저장한 `channel_gateway_jobs.response_payload`다.
- receipt의 `job_id + claim_token + worker_token_id`와 active `gateway|legacy_combined` worker token을 다시 대조한다. `public`, `anon`, `authenticated`는 이 `SECURITY DEFINER` 함수를 실행할 수 없고 `service_role`만 실행한다.
- readback job, reply job, ticket, delivery, credential은 channel, environment, owner, seller account key, credential ID, latest inbound까지 동일해야 한다. 다른 채널·credential·owner lineage는 저장 전에 거부한다.
- 이 제안은 기존 공통 completion RPC가 response와 receipt를 같은 transaction에 기록하고, private gateway table에 대한 임의 post-completion write를 허용하지 않는다는 계약을 신뢰한다. 공통 경로가 terminal `response_payload` 직접 수정을 허용한다면 receipt fingerprint만으로는 response 부분을 독립 재계산할 수 없으므로, 통합 전에 terminal response 불변 trigger 또는 completion transaction 내부의 별도 response SHA seal이 선행되어야 한다. 그 조건 없이 S3 상태 증거를 운영 활성화해서는 안 된다.

## DB 후속 migration 계약

실제 SQL 초안은 `docs/cs-parallel/proposals/qoo10/007-reply-s3-status-rpc.sql`이다. `tests/cs-qoo10-reply-s3-status-db.test.mjs`가 이 파일을 격리 PGlite에 그대로 적용하며 exact/pending/오순번/replay를 검증한다. 핵심 불변식은 다음과 같다.

- `qoo10_s3_status_observed`와 `qoo10_s3_status_observed_at`은 S3 exact identity 상태 증거만 표시한다.
- `qoo10_reply_content_observed`는 항상 false다.
- `qoo10_automatic_resend_allowed`는 항상 false다.
- 기존 generic `verification_status`와 `verification_contract`는 이 RPC가 갱신하지 않는다.
- 따라서 S3 exact identity라도 `verification_status='remote_observed'`로 승격하지 않는다. 그 상태명은 같은 문의·수신자·본문의 seller message가 실제 재관측된 기존 계약에만 남긴다.

`sellerpilot_service_record_qoo10_reply_s3_readback_v1`은 다음을 같은 transaction에서 `FOR UPDATE`로 대조한다.

- active worker token + completion receipt + readback job claim.
- readback job이 `inquiries.list`, channel `qoo10`, credential이 delivery/ticket과 동일.
- reply/read job과 credential의 environment, owner, seller account key가 ticket과 동일.
- delivery job의 `sellerpilotInboundKey`가 ticket의 현재 `latest_inbound_key`와 동일.
- delivery request의 type/question/sequence가 readback metadata와 동일.
- 저장된 `response_payload`에서 exact S3 행을 다시 판정하고 RPC의 예상 state/reason/count와 일치.
- state/reason/count와 boolean guard는 `NULL`까지 명시적으로 거부하며, CHECK도 SQL `unknown`을 성공으로 취급하지 않도록 상태별 완전한 boolean 식을 사용.
- claim/after-sales ticket가 아님.
- exact S3이면 `qoo10_s3_status_observed=true`, contract=`sellerpilot-qoo10-s3-status/1`만 기록한다. generic `verification_status`는 기존 `provider_accepted`를 유지한다.
- pending/incomplete/error이면 delivery를 재큐잉하지 않고 `provider_accepted` 또는 `reconciliation_required`로 보존.

새 함수는 `security definer set search_path=''`, `public/anon/authenticated` revoke, `service_role` execute만 허용한다. 사용자 조회 함수는 기존 admin ACL을 유지한다.

## 읽기 API와 UI 계약

`sellerpilot_get_inquiry_reply_delivery`와 workspace snapshot의 delivery JSON에 다음 필드를 추가한다. 기존 generic 필드는 삭제하거나 의미를 바꾸지 않는다.

```diff
       'verificationStatus',d.verification_status,'verificationContract',d.verification_contract,
+      'qoo10S3StatusObserved',d.qoo10_s3_status_observed,
+      'qoo10S3StatusObservedAt',d.qoo10_s3_status_observed_at,
+      'qoo10S3ReadbackState',d.qoo10_s3_readback_state,
+      'qoo10S3ReadbackReason',d.qoo10_s3_readback_reason,
+      'qoo10ReplyContentObserved',d.qoo10_reply_content_observed,
+      'qoo10AutomaticResendAllowed',d.qoo10_automatic_resend_allowed,
```

`app/use-operations-snapshot.ts`:

```diff
 export type OperationTicketDelivery = {
@@
+  qoo10S3StatusObserved?: boolean;
+  qoo10S3StatusObservedAt?: string | null;
+  qoo10S3ReadbackState?: "verified" | "pending" | "incomplete" | null;
+  qoo10S3ReadbackReason?: string | null;
+  qoo10ReplyContentObserved?: false;
+  qoo10AutomaticResendAllowed?: false;
 };
```

`app/page.tsx`의 `replyDeliveryPresentation`은 generic `remote_observed`보다 먼저 status-only 분기를 표시한다.

```diff
 function replyDeliveryPresentation(delivery: OperationTicketDelivery) {
+  if (delivery.channel === "qoo10" && delivery.qoo10S3StatusObserved) return {
+    label: "Qoo10 S3 상태 확인",
+    detail: "같은 문의번호와 순번이 S3 조회에 나타났습니다. 답변 본문 일치는 확인되지 않았습니다.",
+    tone: "succeeded" as const,
+  };
   if (delivery.verificationStatus === "remote_observed") return {
```

pending/incomplete인 경우 `채널 접수 · S3 상태 재확인 필요 · 자동 재전송 차단`으로 표시하고, 어떤 경우에도 `원격 반영 확인` 또는 `본문 확인` 문구를 사용하지 않는다.

## 필수 통합 테스트

```bash
node --import tsx --test \
  tests/cs-qoo10-history-runtime.test.ts \
  tests/cs-qoo10-reply-s3-status-db.test.mjs \
  tests/inquiry-reply.test.ts \
  tests/cs-reply-observation-db.test.mjs \
  tests/qoo10-claims.test.ts
```

필수 assertion:

- legacy ticket는 정확한 provider/reply context에서만 통과.
- v2 root는 attested legacy alias가 없으면 거부.
- selected inbound != latest inbound면 enqueue 0건.
- 이미 S3/ANSWER/COMPLETE인 target은 enqueue 0건.
- claim ticket는 reply enqueue 0건.
- S3 exact identity만 status observed, 다른 sequence는 incomplete.
- 빈 S3 결과와 transport/provider 오류는 모두 자동 재송신 0건.
- 같은 readback job replay는 delivery 상태/관측 시각을 중복 생성하지 않음.
- S3 응답에 본문이 없으면 generic body fingerprint verification으로 승격하지 않음.
- `verification_status`는 S3 exact/pending/replay 뒤에도 `provider_accepted` 유지.
- route helper가 만든 `{params:{...}}`가 enqueue RPC payload와 Qoo10 adapter까지 형태 손실 없이 도달.
- `verified + NULL reason`, `NULL state`, `pending + NULL reason`는 delivery 불변으로 거부.
- 저장된 provider 결과가 다른 sequence인데 호출자가 `verified`를 주장하면 delivery 불변으로 거부.
- 다른 channel/credential/owner, wrong worker scope, revoked/expired worker는 모두 lineage 거부.
- `public`/`anon`/`authenticated` execute 없음, `service_role`만 execute.

## 통합 상태

- 공통 반영: 미적용
- 운영 DB: 미적용
- 실고객 답변: 미전송
- S3 원격 readback: 미실행(로컬 fixture 검증만 완료)
- SQL proposal PGlite replay: 8/8 통과
