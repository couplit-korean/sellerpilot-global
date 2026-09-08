# LAZADA-008 — V3 revision 상태의 대화·보관함 투영

## 판정

현재 통합본의 V3 ingest는 회수된 원문 행을 삭제하거나 덮어쓰지 않고
`support_inbound_messages.provider_context.eventKind='recalled'`와 body-free
`lazada_im_message_revisions` 근거를 남긴다. 그러나 공통
`sellerpilot_get_cs_conversation`은 `m.body`와 `nativeMedia`를 그대로 반환하고,
`sellerpilot_search_cs_archive_v2`는 `t.message`를 그대로 preview와 검색 대상으로
사용한다. 현재 Zod 계약과 UI에도 회수/충돌 상태 필드가 없다.

격리 PGlite에서 현재 실제 GET route를 실행한 재현 결과:

- 회수 후에도 대화 GET JSON에 회수 전 본문과 첨부 메타데이터가 남는다.
- 보관함 GET preview와 원문 검색에도 최신 회수 대상의 이전 본문이 남는다.
- 같은 remote ID의 본문/첨부 변경은 V3가 `conflict`로 격리하지만, 대화 화면은
  최초 승인 투영만 보여 주어 운영자가 변경 충돌의 존재를 알 수 없다.
- unknown-order revision은 현재 대화 행으로 투영되지 않으며, 이 상태를 그대로
  유지해야 한다.

따라서 raw/quarantine GET 완료만으로 대화·보관함의 최신 상태 투영이 완료된 것은
아니다. 공통 reader/contract/UI 변경이 필요하다.

## 제안 산출물

- DB 초안: `lazada-008-v3-conversation-projection.sql`
- 공통 client/UI patch: `lazada-008-v3-conversation-projection.patch`
- 격리 회귀: `tests/cs-lazada-v3-conversation-projection-get.test.mjs`

이 채널 worktree에서는 공통 SQL·reader·UI를 직접 수정하거나 운영 DB에 적용하지
않았다.

## 정확한 preimage

2026-09-08 23:54:59 KST 통합본 기준:

| 경로 | SHA-256 |
|---|---|
| `supabase/migrations/20260908140409_cs_lazada_im_ingest_v3.sql` | `b67d6901906ea6022471ba124520ae3a83a17e0708866ede8ab706dd9ddbeed7` |
| `supabase/migrations/20260907220000_complete_cs_archive_scope_and_media.sql` | `0faf36c9e609da220dbd4f162356f6b814dac00fa4e91932470d94ac3f438689` |
| `lib/cs/conversation.ts` | `4c41f31fc96977d30a3d455859d4dfdf77cb0063848d374ea5c3e1689c460128` |
| `app/cs/conversation-timeline.tsx` | `d6c18c5a5124263d4ccc421f3a7e3332de6b3d9298003baaab5b9fea27e59ee9` |
| `lib/cs/archive.ts` | `a8bbc10951b7aa96b16b2217a3b11b680604fe17f64484b8886d5db829add575` |
| `app/api/admin/cs/archive/route.ts` | `3e89f2abb8cbe6bf139b54851d1a1dbab03c29dfb80922222461a0edc79b1709` |
| `app/cs/archive.tsx` | `9989494b9d6825fb4a9d71f24eddfedd375858f1305f5ebe535632ab1a49a82a` |

통합된 V3 migration은 이전 승인 SQL 초안과 SHA-256이 동일하다.

## DB 변경 계약

`sellerpilot_private.lazada_im_projection_state_v1`은 삭제·업데이트·현재 revision
추정을 하지 않는 stable read helper다.

회수는 다음 모든 조건을 충족할 때만 `recalled`로 투영한다.

1. 현재 인증 사용자의 ticket owner와 revision owner가 같다.
2. ticket의 `source_credential_id`, `seller_account_key`, `external_ticket_id`가
   revision의 credential/seller/session과 정확히 같다.
3. message remote ID와 `nativeContentFingerprint`가 revision과 같다.
4. revision kind와 allowlisted provider metadata가 각각 `recalled`,
   `eventKind=recalled`이고 `recallTargetMessageId`가 같은 remote ID다.
5. revision이 GET snapshot의 `asOf` 이전에 실제 관측됐다.

이 근거가 있으면 대화 body는 고정 안내문으로 바꾸고 `nativeMedia`는 `null`로
투영한다. 원문 행과 body-free ledger는 보존한다. recall-before-message와
message-before-recall 모두 동일 근거 조합으로 수렴한다.

같은 lineage와 remote ID에 `conflict` revision이 있으면 body를 바꾸지 않고
`conflict_review_required`만 노출한다. changed body/attachment를 최신으로 선택하거나
회수로 해석하지 않는다. 다른 credential 또는 seller의 revision은 영향을 주지
않는다. revision만 있고 승인된 inbound row가 없는 unknown-order 이벤트는 대화에
새로 만들지 않는다.

보관함은 최신 inbound key의 증거가 `recalled`일 때만 preview를 회수 안내문으로
바꾸고 회수 전 본문 검색 일치를 제거한다. 다른 메시지가 더 최신이면 그 최신
preview를 유지한다.

두 공개 RPC는 기존처럼 `security definer set search_path=''`, admin/owner 검사,
authenticated-only EXECUTE를 유지한다. private helper는 public/anon/authenticated/
service_role에 직접 실행 권한을 주지 않는다. 이는 Supabase의 현재 security-definer
함수 지침과 일치한다.

## client/UI 변경 계약

- conversation message: `messageState = normal | recalled | conflict_review_required`
- archive ticket: `latestMessageState = normal | recalled | conflict_review_required`
- 회수는 “저장 원문과 첨부를 대화 화면에 표시하지 않음”을 명시한다.
- 충돌은 “기존 투영 유지 · 원문/격리함 검토 필요”를 명시한다.
- Zod default는 기존 채널/구버전 응답을 `normal`로 유지한다.

현재 Zod object가 알 수 없는 필드를 제거하므로 SQL만 반영하면 상태가 client에서
사라진다. SQL과 patch는 같은 통합 단위로 적용해야 한다.

## 적용 순서와 검증

1. 통합 담당이 현재 preimage와 이미 반영된 V3 migration hash를 재확인한다.
2. 새 고유 migration 번호로 SQL 초안을 옮기고 운영 적용 전 격리 DB에서 실행한다.
3. 공통 patch를 적용한다. 다른 채널 UI 추가 뒤인 23:54:59 KST 현재 통합본에도
   `git apply --check` exit 0을 다시 확인했다.
4. 새 PGlite→actual GET test와 기존 V3/raw GET 집중시험을 실행한다.
5. 실제 운영 적용은 별도 승인·migration ledger 대조 뒤 수행한다.

검증 반례는 recall before/after, edit body conflict, unknown order, 동일 revision replay,
다른 credential, 다른 seller, 비관리자, 대화/보관함 원문 비노출이다.

## 비범위

- 운영 DB migration, 배포, webhook 설정, credential/token refresh
- 실제 provider mutation 또는 실제 고객 답변
- conflict의 자동 최신 선택·자동 해결
- raw/quarantine 원문 보존 정책 변경
