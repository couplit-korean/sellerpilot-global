# 공통 변경 요청 coupang-003

- 목적: 쿠팡 콜센터 답변의 provider acceptance 뒤 동일 inquiry를 단건 GET하고, 공통 `sellerpilot-reply-observation/1` 검증기로 동일 parent와 본문이 관측될 때만 `remote_observed`로 닫는다.
- 요청 채널: coupang
- S0 ID / 현재 인터페이스 버전: `S0-20260908-decaba426812a3ba`
- 채널 전용 구현: `lib/channels/coupang-inquiries.ts`의 `call-center-detail`; `lib/channels/coupang-inquiry-history.ts`; `lib/channels/cs/coupang/contact-center.ts`
- 채널 전용 현재 SHA-256: inquiry history `18960e8afbb9588723b687432668ecbe7b65279ff77ecccaa0ea28789f5aff50`
- 수정할 공통 파일과 현재 SHA-256: `lib/channels/reply-verification.ts` `80c67ac824fc065b8b69ffdbcd75a5bc327e08d49c7f5404b1267c809314808c`; `lib/channels/serverless-gateway.ts` `07b99bea1c41a7d2cad259a06302f49f4654d599b1f4fb7197bc9f4ffb49896a`; `app/api/channel-gateway/worker/complete/route.ts` `41435b65a23dc4d12a9c47a37f8ac20d572a81afe8af1fb9171d004edb0f7e64`; 후보 SQL `supabase/migrations/20260907232000_add_cs_reply_remote_observation.sql` `b1079308ccc2a01fc4985c98e62e3f3437cf8ebda1e9c405b5abe9c778a3acb5`.
- 현재 닫힌 부분: 단건 응답 정규화 후 공통 `inquiryReplyObservations`가 `kind=call-center`, 동일 `inquiryId`, provider가 직접 준 `parentAnswerId`, seller `answerId`, 본문 fingerprint를 생성한다. 과거 seller event는 현재 ticket의 최신 parent를 상속하지 않는다. provider가 parent를 주지 않으면 관측값도 parent 미결속이므로 SQL exact match를 통과할 수 없다.
- 현재 열린 부분: 성공한 `inquiries.reply`가 검증용 `inquiries.list/call-center-detail`을 자동 enqueue하지 않는다. 주기 조회가 우연히 다시 읽어야만 공통 관측 RPC가 실행된다.
- 실행 가능한 SQL 초안: `docs/cs-parallel/proposals/coupang/patches/003-coupang-call-center-reply-readback.sql`
- 격리 DB 시험: `tests/cs-coupang-reply-readback-db.test.mjs`

## 최소 통합 변경

1. `inquiries.reply` 완료 트랜잭션에서 provider acceptance marker를 검증한 쿠팡 `kind=call-center`에 한해 검증 read job 하나를 원자적으로 enqueue한다.
2. child request는 같은 `credential_id`, owner, seller account, environment를 상속하고 payload를 아래처럼 제한한다. 자유 입력 본문이나 credential 원문은 복제하지 않는다.

```json
{
  "arguments": { "kind": "call-center-detail", "inquiryId": "<same inquiryId>" },
  "sellerpilotReplyReadback": {
    "contract": "sellerpilot-coupang-reply-readback/1",
    "sourceJobId": "<reply job uuid>",
    "expectedInboundKey": "<same latest inbound key>",
    "expectedReplyFingerprint": "<delivery fingerprint>",
    "expectedParentAnswerId": "<same parentAnswerId>"
  }
}
```

3. `sourceJobId`에 unique 제약을 두어 완료 webhook 재전송·중복 클릭이 readback job을 하나만 만들게 한다. readback job 실패나 timeout은 원 reply를 재전송하지 않고 delivery를 `reconciliation_required`로 유지한다.
4. 두 공통 completion 경로는 현재처럼 성공한 `inquiries.list`를 정규화한 뒤 `inquiryReplyObservations`를 호출한다. 관측 RPC는 기존 exact 조건인 credential, ticket, body fingerprint, inquiryId, parentAnswerId, mutation 시각을 모두 만족하는 delivery 한 건만 `remote_observed`로 바꾼다.
5. seller reply event를 일반 customer inbound ingestion에서 제외하는 현재 필터는 유지한다. 관측 ledger에만 저장한다.
6. source request의 `arguments.kind`가 NULL이면 SQL의 3값 비교로 통과시키지 않고 completion 전체를 rollback한다. `product`는 기존처럼 이 콜센터 trigger의 대상이 아니다.
7. ticket `source_credential_id`, source job credential, active production credential이 정확히 같아야 한다. source/ticket/credential seller key는 모두 64자리 해시이고 서로 같아야 하며, credential은 `provider_certified_v1`, 검증 시각 존재, 미만료여야 한다.

## 반례와 시험

- provider 배열 역순, 새 재문의 뒤 과거 seller 답변, 다중 actionable parent, provider parent 누락, 응답 시간 미확정은 모두 fail-closed 또는 미결속 관측이어야 한다.
- 최소 회귀: `node --import tsx --test tests/cs-coupang-contact-center.test.ts tests/reply-verification.test.ts tests/cs-reply-observation-db.test.mjs`
- 채널 전용 fixture는 단건 readback에서 exact parent `4103`을 관측하고, 과거 답변 parent `4101`이 최신 parent `4103`으로 오염되지 않으며, parent 없는 관측은 결속되지 않음을 검증한다.
- 상품/주문/배송/환불 mutation 영향: 없음. 이 제안은 기존에 승인·전송된 콜센터 답변의 GET 검증만 추가한다.
- 통합 담당 처리 상태: 미반영

## 격리 검증 결과

- provider acceptance와 같은 트랜잭션의 delivery trigger가 동일 credential·seller lineage를 복제한 `call-center-detail` child 한 건을 생성한다.
- source job primary key link로 동일 ACK 재처리 시 child 수는 유지된다.
- readback child가 실패한 뒤 ACK가 다시 관측돼도 reply job은 재생성되지 않는다.
- 상품문의 reply는 이 콜센터 전용 trigger가 건드리지 않는다.
- acceptance marker 누락은 source-invalid로 전체 insert를 rollback한다.
- API 역할은 private link table을 직접 읽을 수 없다.
- 공통 worker completion route는 `inquiries.reply` 성공 결과를 `parsed.data.result` 그대로 `p_response_payload`에 넘긴다. serverless completion도 원 응답을 먼저 저장하고 sanitizer는 `orders.list`와 `inquiries.list`에만 적용한다. 따라서 `steps[0].data.sellerpilotReplyAcceptance` 위치는 두 경로에서 보존된다.
- 실제 공통 delivery trigger를 합성 DB에 재현해 source job `running`에서 completion update를 실행했다. 저장된 acceptance marker, delivery `succeeded/provider_accepted`, 동일 credential의 child 한 건이 한 트랜잭션으로 이어졌다.
- NULL kind, acceptance marker 누락, ticket credential 불일치, source/ticket 양쪽 NULL seller key, credential seller key 불일치, source environment 불일치, source/ticket owner 불일치는 completion을 rollback하고 child를 0건으로 유지한다.
- 격리 시험: `tests/cs-coupang-reply-readback-db.test.mjs` 7/7, `tests/cs-coupang-reply-completion-storage.test.mjs` 2/2.
