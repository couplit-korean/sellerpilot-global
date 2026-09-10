# Lazada 009 — 일반 CS 화면·초안·답변 회수 경계

## 결론

중앙 008은 대화 타임라인과 보관함을 고쳤지만 일반 CS 화면의 데이터 원천은 별도다.
`app/api/operations/snapshot/route.ts`는 `sellerpilot_get_operations_snapshot`의 티켓에
`sellerpilot_get_cs_workspace_snapshot` 결과를 병합한다. 현재 workspace 함수가
`message`, `translatedMessage`, `replyDraft`를 반환하지 않아, 병합 뒤에도 기존
`support_tickets.message`, 번역, 저장 초안이 남는다. `app/page.tsx`는 이 값을 목록
preview와 통합 검색에 사용한다.

AI 초안 RPC도 현재 inbound key만 확인한 뒤 기존 함수에 위임하고, 기존 함수는
`support_tickets.message`를 worker request의 `message`로 직렬화한다. 따라서 회수된
최신 메시지의 저장 본문을 일반 CS 목록에서 다시 보거나 AI 초안 입력으로 다시 쓸 수
있다. 답변 enqueue RPC에도 V3 recall/conflict 원장 검사가 없어 UI preflight 뒤 회수가
도착하는 경쟁 조건을 원자적으로 막지 못한다.

## 제안

1. 중앙 008의 `lazada_im_projection_state_v1`만 판단 근거로 재사용한다.
2. 티켓 ID에서 exact owner, source credential, certified seller key, external session,
   latest inbound remote ID, native content fingerprint를 다시 결합하는 private helper를
   추가한다.
3. 기존 workspace 함수를 rename한 뒤 wrapper로 보존하고, Lazada 티켓만 다음 값을
   overlay한다.
   - confirmed recall: 본문은 `Lazada 메시지가 회수되었습니다.`, 번역/저장 초안은 null,
     `latestMessageState=recalled`, `replyAllowed=false`
   - conflict: 최초 승인 본문은 유지하되 번역/저장 초안은 null,
     `latestMessageState=conflict_review_required`, `replyAllowed=false`
   - normal: 기존 본문/번역/초안을 그대로 유지, `replyAllowed=true`
4. reply-context에도 같은 상태를 노출해 일반 reply route가 명시적인 409를 반환하게 한다.
5. `sellerpilot_update_ticket`, `sellerpilot_create_support_reply_job`,
   `sellerpilot_enqueue_inquiry_reply_gateway_job`을 wrapper로 감싼다. 저장 초안/완료,
   AI 초안 생성, 실제 답변 enqueue는 recall/conflict에서 DB가 거절한다. 특히 enqueue는
   티켓 row lock 뒤 판단해 UI 조회와 실제 접수 사이의 회수 경쟁도 차단한다.
6. 공통 UI는 상태를 타입에 보존하고 목록 표식, composer 잠금 사유, 검토 모달의 최신
   state/key 재검사를 추가한다. 일반 CS GET 병합 순서는 그대로 쓴다.

## 통합 전제와 preimage

- 선행 migration:
  `supabase/migrations/20260908145831_cs_lazada_v3_conversation_projection.sql`
- 선행 migration SHA-256:
  `834e098b9509360d9b3286b34237cb8c086ab5627896488cfa61c523425942cb`
- 2026-09-09 00:28:41 KST 공통 patch preimage:
  - `app/use-operations-snapshot.ts`: `b4c9c4eb5f44fad2600cf37b70e95d6859dbf2f63aaa4f5f516ca531bf95fd61`
  - `app/page.tsx`: `7413dc062691f0f0dbb78e15568dc8ca9707ed449dedccacba1fcc9a16d81f4e`
  - `app/api/ai/support-reply/route.ts`: `193eb0ae3b15f3688abd3d2d45de12b878b4fd15aa59162b2a6e1aa87fa44e3e`
  - `app/api/operations/snapshot/route.ts`: `26a9479e21a788fee3ad09d4778d5fedc790b0a40e4e84dba322297645c622bd`
  - `app/api/admin/cs/reply/route.ts`: `b10b33b5fda7054ab55b76c107cd2491fc28e804e7c4be6bfbed8d7c9c763259`
  - `lib/channels/gateway.ts`: `2071e526fcdfd8b284c1ddf51f73870ec68e4e887f1063efcfe6d4fe354a4981`

통합 담당은 SQL을 새 forward migration 번호로 배정하고 patch를 같은 묶음으로 반영해야
한다. rename wrapper 방식은 008 뒤 현재까지 누적된 공유 함수 필드를 잃지 않기 위한
것이다. migration 적용 전에 함수 signature와 위 preimage를 다시 확인한다.

## 격리 회귀

`tests/cs-lazada-v3-normalizer-ordinary-workspace-get.test.mjs`는 합성 메시지만 사용한다.
production normalizer의 실제 출력을 V3 ingest RPC에 넣고, 같은 PGlite에서 중앙 008
정본 conversation GET과 009 workspace/초안/답변 경계를 실행한다.

- message-before-recall과 recall-before-message가 모두 confirmed recall로 수렴
- 동일 ID changed body가 `conflict_review_required`이며 changed body를 최신으로 선택하지 않음
- 동일 normalized message replay가 inbound/revision 행을 늘리지 않음
- 일반 workspace JSON에서 recalled body, 번역, stale draft가 사라짐
- conflict는 최초 승인 본문만 보이고 번역/stale draft는 사라짐
- recall/conflict AI job은 생성되지 않음
- recall/conflict reply enqueue는 gateway job 생성 전에 거절됨
- normal message의 AI payload와 enqueue는 유지됨

## 범위 밖

- 운영 DB 적용, 배포, 운영 webhook/token/credential 변경은 하지 않았다.
- 실고객 원문·비밀은 fixture나 보고서에 넣지 않았다.
- 실제 CS Bot token grant와 원격 session readback은 이 제안의 로컬 성공으로 대체하지
  않는다.
- confirmed recall/conflict 원장은 보존한다. raw/revision 삭제나 본문 원본 변경은 하지
  않는다.
