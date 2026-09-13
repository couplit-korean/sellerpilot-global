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
