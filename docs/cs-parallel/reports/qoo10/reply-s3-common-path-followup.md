# Qoo10 reply S3 공통 경로 실행안 후속 결과

- 시각: 2026-09-08 KST
- S0: `S0-20260908-decaba426812a3ba`
- 작업폴더/브랜치: `/Users/kimchangheemac/dev/sellerpilot-cs-qoo10` / `codex/cs-qoo10-v1`
- 통합 기준본: `/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908`, 읽기 전용
- 동결 산출물: qoo10-007/qoo10-008 SQL과 기존 delta/test를 수정하지 않음
- 운영 변경: common 원본 write, production DB, provider mutation, 고객 답변, commit, push, deploy 모두 없음

## 결론

qoo10-006의 답변 guard 이후 남아 있던 세 실행 연결을 코드/SQL patch와 격리 시험으로 제출했다.

1. 검증된 `SetInquiryMessage` provider ACK receipt가 새로 insert되는 같은 transaction에서만 delivery-bound S3 `inquiries.list` 자식을 만든다.
2. remote worker와 serverless completion 모두 S3 결과를 PII 없는 frozen-007 호환 envelope로 저장한 뒤, 공통 completion 성공 이후에만 qoo10-007 status RPC를 호출한다.
3. 공통 운영 snapshot/UI가 status-only 관측과 pending/incomplete를 실제 필드로 읽고 표시하며, 답변 본문 관측 또는 자동 재송신을 주장하지 않는다.

기존 receipt는 소급 enqueue/seal하지 않는다. failed/reconciliation reply completion도 S3 자식을 만들지 않는다.

## 저장 응답 shape 대조

통합본의 두 completion 경로는 서로 다른 저장 결과를 만들 수 있었다.

| 경로 | 현재 저장 동작 | frozen-007과의 관계 | 009 처리 |
|---|---|---|---|
| remote worker completion | worker의 provider result 전체를 completion payload로 저장 | `steps[0].data`가 남아 있으면 판정 가능하지만 고객 원문 등 불필요 필드가 함께 남을 수 있음 | marker가 있는 S3 child만 정확한 identity/status 필드로 축소 |
| serverless completion | `inquiries.list`를 generic `normalized_inquiries_v1`로 치환 | `GetInquiryMessage`, `ResultCode`, `ResultObject`가 사라져 frozen-007의 `steps[0].data` 판정 불가 | marker가 있는 S3 child는 generic normalizer를 건너뛰고 동일한 축소 envelope 저장 |

009 helper의 저장 envelope는 marker `sellerpilot-qoo10-s3-stored-evidence/1`과 원래 provider step 위치인 `steps[0].data`를 유지한다. data에는 `ResultCode`, `ResultObject[].INQ_TYPE`, `QUESTION_NO`, `SEQ_NO`, `STATUS`만 남긴다. 고객 문의/답변 본문, 구매자 ID, 주소, 연락처는 저장하지 않는다.

빈 성공 결과는 `pending`, provider 거부/잘못된 envelope는 `incomplete`, transport 또는 completion result 부재는 `provider_transport_or_contract_failed`로 닫힌다. 오순번 evidence도 본문 없이 보존하지만 성공으로 승격하지 않는다.

## 제출 산출물과 적용 순서

1. `009-reply-s3-helper.patch`
   - Qoo10 전용 helper `lib/channels/cs/qoo10/reply-readback-completion.ts` 추가.
   - remote context와 serverless job arguments에서 같은 marker를 검증.
   - PII-free stored response, frozen-007 exact status, RPC arguments 생성.
2. qoo10-007과 qoo10-008 적용 후 `009-reply-s3-common-paths.sql`
   - private immutable enqueue ledger와 새 receipt 전용 trigger 추가.
   - ACK operation/channel/step/result/binding digest를 다시 검증.
   - 승인 시각이 아니라 승인된 최신 고객 문의 `received_at`의 JST calendar day를 고정 조회 창으로 사용.
   - delivery, reply, credential, environment, owner, seller account 계보를 그대로 묶음.
   - completion context에 S3 marker만 제한적으로 노출.
   - 실제 delivery 조회 RPC와 workspace snapshot current/blocking delivery 필드 확장.
3. `009-reply-s3-common-paths.patch`
   - remote worker/serverless completion 저장과 qoo10-007 호출 연결.
   - status RPC는 공통 completion이 `completed`를 반환한 뒤에만 호출.
   - UI에 `Qoo10 S3 상태 확인` 또는 `채널 접수 · S3 상태 재확인 필요`를 노출하고 본문 미확인/자동 재송신 차단을 명시.

patch 적용 순서는 helper patch → qoo10-007 → qoo10-008 → qoo10-009 SQL → common paths patch다. SQL은 qoo10-007/qoo10-008 함수와 seal 계약을 전제로 한다.

## 통합 기준본 preimage와 적용 가능성

| 파일 | SHA-256 |
|---|---|
| `app/api/channel-gateway/worker/complete/route.ts` | `5dd9777403d145791fba116152837a3b53c95059985d9d9eab542b73ab4e57ef` |
| `lib/channels/serverless-gateway.ts` | `bbfd8b122b6dcf3f0d16f760ccd75f7a2db34fd14252c4d2ce1fec3a259d5286` |
| `app/use-operations-snapshot.ts` | `3176a281ab994d1e259591e2d53633329ff414e7b51972dd48bb6c846228704a` |
| `app/page.tsx` | `a4feed2c14ea2199b690182f8706443306032265b6440d3ff03a2a045cd34cd8` |

위 최신 통합본에서 helper patch와 common paths patch 모두 `git apply --check` exit 0이었다. 통합 원본에는 실제 patch를 적용하지 않았다.

## 검증

| 범위 | exit | 결과 |
|---|---:|---|
| qoo10-007 + qoo10-008 + qoo10-009 격리 PGlite 및 helper 집중 시험 | 0 | 25/25 통과 |
| history/runtime/ledger/claim/reply 포함 전체 Qoo10 회귀 | 0 | 63/63 통과 |
| Qoo10 전용 branch strict TypeScript | 0 | 출력 없음 |
| Qoo10 전용 branch ESLint | 0 | 출력 없음 |
| patched common 5파일 임시 overlay TypeScript | 0 | 출력 없음 |
| 최신 통합본 대상 helper/common patch apply check | 0 | 두 patch 모두 적용 가능 |
| 정본 지정 5파일 공통 회귀 | 1 | 69개 중 68 통과; Qoo10 7개는 전부 통과, 기존 11st 예외명 기대 불일치 1개 재현 |

009 격리 DB 시험은 다음 반례까지 포함한다.

- qoo10-009 적용 전에 존재한 receipt는 child를 만들지 않음.
- 정상 ACK의 receipt와 S3 child가 같은 transaction에서 생성됨.
- 잘못된 binding digest는 receipt와 child를 함께 rollback함.
- failed/reconciliation reply receipt는 보존하되 child를 만들지 않음.
- 고정 JST day window와 credential/environment/owner/seller account lineage가 일치함.
- PII-free `steps[0].data`가 qoo10-008로 봉인되고 qoo10-007 exact status 판정에 사용됨.
- delivery 직접 조회와 workspace snapshot에 실제 Qoo10 S3 필드가 노출됨.

common patch 타입 검사는 통합 원본을 복제한 `/tmp/sellerpilot-qoo10-009-patch-20260908` overlay에서 수행했다. 첫 시도는 임시 경로가 bare module을 찾지 못해 source와 무관한 해석 오류가 발생했으며, 통합 `node_modules`를 읽기 전용으로 연결한 뒤 같은 5개 patched 파일이 exit 0으로 통과했다.

정본 지정 5파일 회귀의 단일 실패는 `tests/inquiry-sync-contract.test.ts`가 elevenst 빈 입력에 `INQUIRY_CHANNEL_UNSUPPORTED`를 기대하지만 공통 `inquiry-sync.ts`가 `INQUIRY_PAGE_INVALID:elevenst`를 반환하는 기존 불일치다. 변경 전 67개 중 66 통과 때와 같은 공통 소유 실패이며, 이번 최종 실행에서는 69개 중 68 통과였다. Qoo10 claim/S1·S2·S3/reply 시험은 모두 통과했고, 해당 공통 파일은 수정하지 않았다.

## 안전 경계와 남은 운영 전제

- provider ACK는 답변 본문 원격 관측이 아니다. S3는 질문 identity와 terminal status만 확인한다.
- `qoo10_s3_status_observed=true`여도 generic `remote_observed`로 올리지 않는다.
- pending/incomplete/transport failure는 모두 자동 재송신을 허용하지 않는다.
- 실고객 대상·승인 문구가 없으므로 이번 작업에서 `SetInquiryMessage`를 호출하지 않았다.
- 운영 적용 전 실제 Supabase catalog의 함수 정의, trigger order, grants를 read-only로 재확인해야 한다.
- qoo10-007/008/009와 common patch가 통합·배포되고 remote/serverless completion을 실제로 거쳐야 운영 완료다. 로컬 시험과 patch 적용 가능성은 그 운영 완료 증거가 아니다.
- 과거 receipt를 backfill하지 않으므로 기존 답변 상태는 별도 승인된 reconcile 절차 없이는 자동으로 S3 관측되지 않는다.

## 산출물 SHA-256

- `lib/channels/cs/qoo10/reply-readback-completion.ts`: `580e3f67b05dfba6bc030364817e5c08518edab93f44aeb8bbfcdce928a227d2`
- `docs/cs-parallel/proposals/qoo10/009-reply-s3-common-paths.sql`: `a595454731d119f2608e19354a7972a44ea9a50e30fd7f87012821b9fb126889`
- `docs/cs-parallel/proposals/qoo10/009-reply-s3-helper.patch`: `62a4c7b9eb00a5b79b35e841949f5d58d0a9f4895ffbcf6df9e04480f01fdf15`
- `docs/cs-parallel/proposals/qoo10/009-reply-s3-common-paths.patch`: `d674ade75d68e293219c21703cc86858147b9aa7b228d9ecc5bb5e6aa9ef23da`
- `tests/cs-qoo10-reply-s3-completion.test.ts`: `2c99d6653e10d06d288ad8bae80e53e0d8569e8cebaa37b8af15120675d62946`
- `tests/cs-qoo10-reply-s3-common-path-db.test.mjs`: `c274e66854cec60e32efa4a887b84a63cf371e04fd3c2d96e63a01158691285d`

동결 확인:

- qoo10-007 SQL: `89a51d43800ea1621c646f7ed213f5ffdc32dcde4bcef2d5d08755925ed7e182`
- qoo10-008 SQL: `f31954baa26c91d8e20c07432fabdb77c021557b4d374d781d074fb7dec4672c`
- 기존 NULL/evidence/ACL delta: `7eeb35259e3b130a87474ba2e881dcfb7318ff61c19c9b6e9d3e561bbd32b207`
- 기존 qoo10-007 test: `b9b9e82900377309b522d94f5663fcb3a126055127292fd695038a2a0d8e733b`
- 기존 qoo10-008 test: `88def740462db73e50cccb4428fa29fef9988f960cd7119f67327a1de769474b`

`lib/channels/qoo10-inquiries.ts`는 통합본과 동일한 SHA-256 `87b92edadf85c04359ea56fa10020eeefcfb593635ea9029e4a3dbe1b1c995ac`이며 이번 후속의 잔여 변경이 없다.
