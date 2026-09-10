# 공통 변경 요청 lazada-005

- 목적: 이미 연결된 bootstrap, Push, raw 재처리 세 경로가 `system/official`과 동일 native ID의 recall revision을 손실 없이 같은 DB 계약으로 처리하도록 `lazada_ingest_v3`를 추가한다. `lazada-003`의 실제 호출 경로 보완안이다.
- 요청 채널: lazada
- S0 ID / 현재 인터페이스 버전: `S0-20260908-decaba426812a3ba` / parser `lazada-im-parser/2`, DB `lazada_ingest_v2`
- 실제 연결 확인:
  - 수동 bootstrap: `app/api/operations/sync/route.ts`가 `sellerpilot_service_consume_lazada_im_bootstrap`을 소비한 뒤 `inquiries.list`를 gateway에 넣는다. `lib/channels/operations.ts`는 Lazada continuation을 결과에 유지하고 공통 completion SQL이 다음 page를 enqueue한다.
  - history page: `app/api/channel-gateway/worker/complete/route.ts`와 `lib/channels/serverless-gateway.ts`가 normalization 전에 raw page를 저장하고 V2 ingest 후에만 raw receipt를 normalized로 표시한다.
  - Push: `app/api/webhooks/lazada-im/route.ts`가 서명/app binding을 고른 뒤 raw 저장 성공 전에는 200 ACK하지 않으며, parse 가능한 event는 V2 ingest 완료 뒤 receipt를 normalized로 표시한다.
  - 재처리: admin route `app/api/admin/cs/lazada-raw-inbox/reprocess/route.ts`와 자동 maintenance `app/api/internal/maintenance/route.ts`가 모두 `reprocessPendingLazadaRawReceipts`를 호출한다.
- 현재 공통 파일 SHA-256: `worker complete=41435b65a23dc4d12a9c47a37f8ac20d572a81afe8af1fb9171d004edb0f7e64`, `serverless-gateway=07b99bea1c41a7d2cad259a06302f49f4654d599b1f4fb7197bc9f4ffb49896a`, `webhook=195573905df95ac6305d89507b4735898ed2fb59f7a28b74951158bd85b0f8b1`, `maintenance=dd1abc81df3eb282e54d8547f22425accf0d419004d6f4af0c265a4d26f6592f`, `V2 migration=48ad520707b79c740fba3f846974fc979302d6efefa8c66e7ab86fd0c67675f1`.
- 재현되는 계약 차이: V2는 `senderRole`을 `customer|seller`만 허용한다. parser/2가 official session의 undocumented template `200016`을 `system`으로 투영하면 V2는 `pendingCount`를 올리고 `partial`을 반환한다. Push는 503, bootstrap completion도 503이 되며 raw reprocessor는 최대 재시도 후 terminal failed가 된다. 이 상태는 token/permission/Push 설정 문제가 아니라 로컬 parser와 공통 DB 계약의 불일치다.
- recall 차이: 같은 `(externalTicketId, remoteMessageId)`의 정상 본문 뒤 `providerContext.eventKind=recalled` revision은 원문 관측 두 건을 보존하면서 timeline/card 상태만 recalled로 갱신해야 한다. 현재 V2 body/role digest 충돌 검사는 이를 일반 conflict로 다룰 수 있다. 본문 또는 attachment identity가 달라진 같은 ID는 계속 quarantine이어야 한다.
- 원하는 V3 동작:
  1. `senderRole=system`은 timeline event로 저장하되 customer generation, `latest_inbound_key`, waiting/replyable/resolve 분모를 변경하지 않는다.
  2. explicit seller event도 customer generation을 덮지 않는다.
  3. same-ID recall은 append-only raw revision ledger에 기록하고 현재 projection만 recalled로 바꾼다.
  4. same-ID body/attachment 변경은 recall로 우회시키지 않고 conflict/quarantine한다.
  5. `normal|system|seller|recall|quarantine|pending` 개수를 반환하며 일부만 반영됐을 때는 계속 `partial`을 반환한다.
  6. V3 readiness RPC가 통과하기 전에는 gateway/webhook/reprocessor를 V3로 전환하지 않는다.
- 실행 가능한 SQL 초안: `docs/cs-parallel/proposals/lazada/lazada-005-ingest-v3.sql`. 실제 migration 파일이 아니며 migration 번호는 통합 담당이 배정한다. 이 초안은 append-only revision ledger, credential별 readiness RPC, direct V3 ingest, gateway V3 wrapper를 포함한다.
- 실제 전환 patch: `docs/cs-parallel/proposals/lazada/lazada-005-runtime-v3.patch`. 현재 parser/2 preimage에 `git apply --check`가 통과하며, worker/serverless/webhook/reprocessor가 credential별 readiness를 먼저 확인한 뒤 V3를 호출하도록 바꾼다. 기존 V2와 raw/lease/TTL ABI는 rollback 창 동안 유지한다.
- 보안/ACL: 모든 mutation 함수는 `security definer set search_path=''`, `public/anon/authenticated` revoke, `service_role`만 execute. owner는 credential의 `created_by`, account는 `provider_certified_v1` binding으로 고정하며 요청 body의 seller/country 값으로 scope를 넓히지 않는다.
- 격리 DB 회귀시험과 현재 결과:
  1. official/system 1건이 timeline에는 존재하고 customer waiting/latest inbound는 불변.
  2. customer 1건 뒤 seller echo 1건이어도 최신 customer generation은 유지.
  3. 같은 ID `status:0 -> recalled`이 raw revision 2개/현재 projection recalled 1개로 수렴.
  4. 같은 ID의 다른 body 또는 attachment digest는 quarantine.
  5. 새 customer message 뒤 과거 seller reply echo가 들어와도 새 generation이 resolved가 되지 않음.
  6. 다른 app signature 및 다른 seller credential로 ingest 불가.
  7. V3 batch 500행/1MB, 기존 raw 256KB/5,000행/TTL/lease 경계 유지.
- `tests/cs-lazada-ingest-v3-db.test.mjs`: 실제 SQL 초안을 PGlite에 적용했고 readiness/ACL, system 불변성, seller echo, normal→recall 두 revision, body/attachment conflict, seller boundary, gateway claim을 7/7 통과했다.
- `tests/cs-lazada-runtime-v3-patch.test.mjs`: 다섯 preimage SHA-256을 고정하고 `git apply --check`, 네 ingest entrypoint의 readiness/V3 전환을 2/2 통과했다.
- parser/2 관련 6개 TS 시험은 50/50 통과했다. 전환 patch를 별도 APFS 복제본에 적용한 `tsc --noEmit --incremental false`도 exit 0이었다.
- 공통 통합 회귀 시 기존 `tests/lazada-im-raw-reprocess-db.test.mjs`, `tests/lazada-undated-buyer-db.test.mjs`, `tests/cs-reply-observation-db.test.mjs`를 함께 실행해야 한다.
- 다른 채널 영향: 없음. Lazada credential과 `channel_key='lazada'`로 한정한다.
- 상품/주문/배송/환불 mutation 영향: 없음.
- 적용 순서: V3 SQL을 격리 DB에 적용 → readiness가 false인 상태와 ACL 확인 → provider-certified binding/capability가 정확히 하나인 fixture로 readiness true 확인 → runtime patch 적용 → 위 회귀시험 → parser/2 + V3를 같은 release로 승격한다. parser/2만 V2에 연결하거나 runtime만 먼저 V3로 바꾸지 않는다.
- 통합 담당 처리 상태: 전환 가능한 SQL/patch/fixture까지 제출했으나 통합 source와 운영 DB에는 아직 미반영이다. 운영 DB 적용, 공개 webhook 설정, token 저장/refresh 변경, 실제 고객 reply를 이 작업폴더에서는 하지 않았다.
