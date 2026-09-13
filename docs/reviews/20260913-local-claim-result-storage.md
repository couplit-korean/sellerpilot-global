# 2026-09-13 Mac claim/result persistence follow-up

At 06:40 UTC production Vercel, Supabase schedules, Mac gateway and AI worker run release 49ed0b3e39f7f0ac56895ff7257edbf4a05298cd. Changes in this commit require a candidate build/canary/promotion and worker synchronization before claiming live Temu completion.

- Applied migration 20260913073000 adds the certified DB seller identity context to an owned Temu inquiry claim. The runtime must still compare the actual access-token API identity; `workerIdentityCompared` remains false in DB context.
- Applied 20260913074000 changes only the two new local claim hydrators from STABLE to VOLATILE. STABLE hid the claim's lease UPDATE in the same outer RPC and caused `TEMU_LOCAL_CLAIM_OWNERSHIP_LOST`/503. A rollback call through the actual public claim RPC failed before and returned the eligible Temu inquiry after this fix. Ownership, token, lease and account checks are unchanged.
- Applied 20260913075000 permits only `competitor_checked_at` in addition to the existing publication-fence exceptions. A rollback completion through the actual competitor RPC stored an empty observed snapshot, preserved every other product field including `updated_at`, and still rejected product name changes during in-flight publication. This is not evidence of a new live competitor snapshot.
- These three migrations bring this recovery wave to 30 forward migrations. A management API timeout during 074/075 was checked against the migration journal and live function definitions before retrying; neither had committed, then the reviewed bundle applied successfully.
- Mac Temu CS completion discarded the real provider result when constructing credential binding. It now supplies provider result and DB binding context. The HTTP schema now accepts the explicit Temu seller key and requires it to match the sole target fingerprint. The regression test failed before, and 17 focused tests plus TypeScript passed after. The same test proves a different mall fails before inquiries execute and missing/mismatched HTTP binding keys are rejected.

## Current provider evidence

- Lazada MY diagnostic 2913366a-70d9-4f3f-b6c6-3f7a79ce33ec succeeded at 06:36 UTC with completion receipt. Latest IM recovery tokens were used; active credential became 654f57c2-a0ad-4da7-9308-790c420d063a. The actual IM GET, MY seller 300872000183, durable new credential, and active inquiries.list capability binding were confirmed. No inquiries.reply grant was inferred. Bootstrap 3ea61c22-20c8-4cd1-8705-6a476eef8cf7 was accepted for MY; its collection result remains to be verified. Other country commerce grants are not IM grants.
- Mac gateway returned ready/HTTP200 after claim visibility repair.
- eBay OAuth and 21 actual system-message API parses passed earlier. DB system ledger remains one conversation at this checkpoint; the continuation is not yet completed. These are system notifications, not buyer conversations.
- Temu actual read execution still has no completion receipt on the old Mac code. Deploy this commit and verify its exact retry and DB binding/receipt; do not mark the old job successful or discard its claim.
- Static inventory: 764 source files, 664 RPC calls, 381 resolved function names, zero missing names in live DB. 38 dynamic call sites retain the prior separate classification. This does not prove every SQL dependency/signature/permission or channel end-to-end mutation.

No customer reply, new listing, or shipment mutation was sent as a test. Live publishing/reply/shipping evidence remains separate from database/name/build/readiness checks.

## 06:46 UTC follow-up

The 5c1eaf1 candidate built successfully but was not promoted: runtime logs exposed an additional eBay normalization guard still requiring a recipient for FROM_EBAY notifications. The current forward code retains a null recipient only for system notices; FROM_MEMBERS still requires one and system notices remain resolved/non-replyable. A provider-to-normalization regression failed before the fix. Afterward 31 focused tests and TypeScript passed, and all 21 actual eBay system messages passed both API parsing and CS normalization in a read-only Mac probe at 06:46:21 UTC. This is still separate from the DB ledger completing 21 messages.

The Lazada IM credential successor left the existing Mac read routes pointing at the revoked predecessor. A reviewed rollback and exact successor operation transferred only three existing read routes (inquiries, orders, diagnostic) after verifying the successful IM diagnostic receipt, same certified seller and same credential owner. All write routes remained untouched. Bootstrap admission is now true; processing is queued behind a Mac completion retry.

Latest stored reads: SmartStore product and customer inquiries, 11st Q&A and urgent notices, and the first Shopee shop completed with receipts. A later Shopee shop still has an uncertain refresh and has not been counted as a full multi-shop success.

## 06:56 UTC live Temu result and Lazada continuation repair

Release 390e93dd57791ecd2aa749ca7637d89e9820387f passed Vercel build/canary, was promoted, and is active in Supabase plus both Mac runtimes. Temu job 3357798f-d694-4c98-b988-5f7ccd4f975a succeeded with a completion receipt at 06:52:48 UTC after actual provider identity/after-sales reads. A subsequent periodic read was queued normally. eBay DB now stores the second system notice, including the absent recipient, with its real body preserved.

Lazada bootstrap reached the provider but its HTTP completion was rejected (400): the completion schema had no Lazada inquiries continuation branch, although the provider reader emits durable session/message continuations. Added pure bounded validation for both cursor forms, explicit bootstrap, session count and paired IDs/timestamps; foreign/orphan/forward cursors are rejected. Regression failed before, 35 focused tests and TypeScript passed after. The actual first-page read-only probe passes the HTTP schema; it does not store a completion or reset the consumed bootstrap. Deploy this forward change and resume the existing lineage.

## Shopee 인증 화면 연결 복구 (후속 배포)

- 활성 credential의 대표 숍 1개는 실제 GET 성공, 나머지 7개는 `invalid_acceess_token` 403을 확인했다. 대표 숍 토큰의 다른 숍 재사용은 불가능하므로 복사하지 않는다.
- `sellerpilot:shopee-exact-start` 발행만 있고 구독자가 없었던 화면을 기존 exact admin/전용 Mac 실행기에 연결했다. callback도 기존 일반 authorize로 빠지지 않고 exact bind로 전달한다.
- 브라우저 저장 세션은 관리자 actor·credential·UUID·만료·43자 state를 검증한다. 공식 origin/path/partner/callback URI를 검증하고, callback은 main_account_id를 필수로 제출하여 DB의 기존 메인 계정/8개 숍 계약과 비교한다.
- 운영 callback 스위치는 이미 `1`임을 값 노출 없이 확인했다. 환경변수를 추가하거나 변경하지 않았다. 실제 OAuth 성공과 8개 숍 재검증은 별도 증거가 필요하다.
- Shopee/Lazada 화면 및 Shopee exact 계약 39개 테스트, TypeScript 검증 통과. 기존 Lazada exact 경로 회귀 테스트도 포함한다.
- Lazada MY 첫 작업 `3ea61c22-20c8-4cd1-8705-6a476eef8cf7`과 연속 작업 `2d0e4c7f-dfff-40f7-a7c2-1f8049600e23` 모두 succeeded와 completion receipt 확인. 저장 13건은 모두 system 메시지이며 고객 문의가 아니다.

## 과거 이력 중복 예약 방지

- 운영 eBay 대기열에서 같은 31일 구간이 시간/밀리초만 달라져 반복 예약된 것을 확인했다. 기존 24시간 cooldown은 `periodicKey`가 같을 때만 작동하므로 매시간 새 날짜 문자열이 들어가는 설계가 중복 예약을 유발했다.
- `serverlessCsRepairInquiryEnqueues`의 보충 조회만 KST 당일 00:00 기준으로 고정했다. 같은 날 매시간 catch-up은 같은 key와 arguments를 재사용한다. 현재 문의 조회는 실제 시각을 유지하여 보충 기준 이후 변경을 계속 가져온다.
- eBay는 시간별 37개(하루 최대 888개) 신규 key 대신 하루 37개 key를 사용한다. 실제 API 완료·대기열 소진과 다른 수치이며, 기존 대기열은 삭제/성공 처리하지 않았다.
- 회귀 재현: 수정 전 동일 KST 날짜의 두 번째 실행에서 key/range 비교 실패. 수정 후 24시 경계·현재 조회 분리·Coupang/Qoo10/11st 범위 통합 검사 11개 및 운영 scheduler 관련 3개, 타입 검사 통과.
- Shopee 메모의 기존 메인 로그인으로 휴대폰 OTP 화면까지 진행했다. 새 권한/토큰 교환 성공은 아직 아니다. 첫 exact 세션은 코드 교환 전 만료되어 실행기가 종료됐다. OTP 이후 새 세션을 준비해야 하며 만료 세션을 연장/재사용하지 않는다.
