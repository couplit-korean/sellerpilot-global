# 공통 변경 요청 coupang-008: 실제 CS 읽기 전용 실행 경로

- S0: `S0-20260908-decaba426812a3ba`
- 목적: 기존 `executeCoupangInquiry`와 공통 gateway worker를 그대로 사용하면서, `coupang:inquiries.list`만 현재 Mac의 검증된 출구로 claim할 수 있게 한다.
- 직접 수정하지 않은 공통 파일: `lib/channels/local-channel-executor.ts`, `tests/local-channel-executor.test.ts`, 통합 담당이 배정할 migration.
- 현재 통합 파일 SHA-256: `lib/channels/local-channel-executor.ts` = `6a8c92d53ea935327aa827e9ab027d70dcd20f32023a5622073c104ea95156fc`.

## 2026-09-08 운영 읽기 사실

- production Coupang active credential 1개, 만료 전, access/secret/vendor/requested-by 필드 존재, seller account key 검증됨.
- vendor mask는 WING과 같은 `A*****472`다. 비밀이나 vendor 원문은 기록하지 않았다.
- 현재 Mac egress SHA-256은 `92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01`이고, 기존 Coupang local route의 egress hash와 일치한다.
- 그러나 기존 Coupang route는 모두 만료되고 active runtime release와도 불일치한다. `inquiries.list` route는 0개다.
- DB `local_channel_executor_access('coupang','inquiries.list')`는 `NULL`이고 serverless Coupang static egress policy는 `false`다.
- serverless runtime 자체는 active/configured지만 이 사실이 Coupang의 허용 출구를 만들지는 않는다.
- 신규 CS migration `20260908000000`, `001000`, `002000`, `047000`, `047100`과 credential/history/verification RPC는 운영에 없다.

## 기존 harness 재사용

별도 credential 복사 script나 신규 provider client를 만들 필요가 없다. 기존 경로가 이미 다음을 수행한다.

1. `scripts/ai-cli-worker.mjs`가 release SHA와 egress SHA가 들어간 `local_channel_executor` attestation으로 claim한다.
2. claim route와 DB predicate가 exact owner/credential/seller key/worker token/release/egress/expiry를 검사한다.
3. 공통 worker가 기존 `executeCoupangInquiry`를 실행한다.
4. GET 결과는 기존 complete route가 정규화하고, migration 적용 후 history coverage·reply observation·ticket/message 저장을 수행한다.
5. 채널 전용 인증 route가 exact credential/kind/from/to/count를 다시 결속해 웹에 노출한다.

즉, 누락은 provider 코드가 아니라 `inquiries.list` read tuple, DB route constraint/access, 짧은 수명의 exact route row, CS migration 적용이다.

## 제출 변경안

- `patches/008-coupang-inquiries-local-executor.patch`
  - JS read tuple에 `coupang:inquiries.list` 한 줄만 추가.
  - `inquiries.reply`, 주문, 상품등록 tuple은 추가하지 않음.
  - 공통 단위시험에 read/deny 반례 추가.
  - 최신 통합본에서 `git apply --check`가 exit 0인 표준 unified diff다.
- `patches/008-coupang-inquiries-local-executor.sql`
  - 현재 운영 function/constraint MD5를 preflight로 고정.
  - route table check constraint에 Coupang `inquiries.list`만 추가.
  - SQL access 함수에서 해당 tuple만 `read` 반환.
  - 기존 job predicate/claim wrapper를 재작성하지 않고 MD5가 그대로인지 postflight 확인.
  - route row를 만들거나 활성화하지 않음.

## 적용 순서와 외부 승인 경계

1. 통합 담당이 CS migration을 현재 공통 preimage에 맞춰 통합하고 격리 DB 회귀를 다시 실행한다.
2. JS patch와 SQL patch를 같은 release에 반영한다.
3. 배포·migration은 현재 사용자 금지 범위이므로 별도 승인 뒤에만 수행한다.
4. 운영자가 current active credential, 현재 gateway worker token, active release `5e4a26367af0518d09c37266d3bb509be53952c6`, egress hash를 다시 읽어 짧은 수명의 `inquiries.list` route 한 건을 만든다. 오래된 route를 재활성화하지 않는다.
5. 최근 7일 상품 `ALL`과 콜센터 `NONE` 한 건씩 먼저 실행·완료·원격 ID/0행을 읽고, 이후 나머지 상태와 클레임을 순차 수행한다.
6. 첫 8 scope가 모두 성공한 후에만 30일 5개 창을 완주하고 provider 최초 제공일까지 cursor를 뒤로 이동한다.

route row 생성, job enqueue, 운영 migration, provider GET은 운영 DB 상태를 바꾸므로 이번 작업에서는 실행하지 않았다. 실제 답변 tuple은 이 제안에 포함하지 않는다.

## 필수 회귀

- `localChannelExecutorAccess('coupang','inquiries.list') === 'read'`.
- `inquiries.reply`, `orders.list`, `shipment.confirm`, `listing.update`는 계속 `null`.
- 잘못된 credential/seller key/token/release/egress/만료 route는 claim 0.
- `listing_id` 또는 external-detail binding이 섞인 CS read job은 거절.
- 실패·중단은 same-window replay, 성공한 complete만 cursor advance.
- provider response/customer content/credential payload를 worker log나 HTTP 응답에 노출하지 않음.
- 통합 회귀: `tests/local-channel-executor.test.ts`, `tests/local-channel-executor-migration.test.mjs`, `tests/local-channel-executor-wiring.test.mjs`, 쿠팡 전용 전체, 공통 inquiry sync/reply.

## 실제 SQL 실행 검증

- `tests/cs-coupang-read-only-runtime-db.test.mjs`는 기존 `local-channel-executor-migration` fixture와 정본 `20260907110000 → 07161000 → 07180000 → 08011500 → 08013000` 함수 wrapper 체인을 PGlite에 설치한 뒤 008 SQL 본문 전체를 실행한다.
- production SQL의 MD5 preflight 네 값은 파일에서 그대로 유지한다. PGlite의 `pg_get_functiondef`/`pg_get_constraintdef` 직렬화가 production PostgreSQL과 달라지는 네 digest는 시험 안에서 정본 함수 체인의 PGlite digest도 별도로 고정하고, 실행 복사본의 digest 상수만 1:1 치환한다. 권한/constraint/access/postflight SQL 본문은 바꾸지 않는다.
- migration 전후 route row는 0건이다. 적용 후 `coupang:inquiries.list`만 `read`이고 `inquiries.reply`, `orders.list`, `shipment.confirm`, `listing.update`, `smartstore:inquiries.list`는 NULL이다.
- 실제 최종 claim wrapper를 통해 exact seller, credential, active release, egress, gateway token, fresh enabled route가 모두 맞을 때만 `inquiries.list`가 claim된다.
- seller/credential/release/egress/token 상태 또는 만료, route 만료/disabled, listing ID, external-detail binding 중 하나라도 어긋나면 claim은 0이다. 금지 tuple 네 종류와 다른 채널 권한도 0이다.
- 결과: SQL 동작 3/3, patch/production-preimage 계약 2/2, ESLint exit 0.

## 완료 기준

이 제안이 병합됐다는 사실만으로 실제 읽기 완료가 아니다. exact route가 current이고 각 provider GET이 HTTP 200으로 끝난 뒤, completion 저장·격리/운영 DB 집계·인증 웹 readback이 같은 credential/kind/date/ID를 반환해야 한 scope가 완료다.
