# Review 63 — SmartStore durable category source and Temu authoritative-read hardening

Date: 2026-09-10 KST

## Integrated local changes

### SmartStore 011

Applied frozen patch SHA-256 `63d38285dd6126bbd8254ab7e689fce82671f41defa1eb281ea04d032424b046`.

- Added migration `20260910031000_smartstore_create_category_attribute_source.sql` with a private append-only current source ledger.
- Bound owner, product microsecond revision, active production credential version/account, approved detail revision/digest, confirmed category assignment and the canonical official category/attribute readback.
- Exposed service-role-only append/read/retire RPCs while revoking direct table access.
- Extended the existing SmartStore create snapshot with `categoryAttributeSource`; a missing or stale row stays null and the route fails before claim or provider work.
- Rechecked the exact current row from both local and serverless provider-mutation begin paths under row locks.
- Replaced locale-dependent key/record ordering with deterministic code-point ordering so TypeScript and SQL hashes agree.

Central verification passed the new and adjacent category mapping/source tests `15/15`, the existing local/serverless source-fence tests `9/9`, migration filename collision check, nonincremental TypeScript and scoped ESLint.

This does not yet produce the source row. The official Naver category/attributes/values/units reader and service append call must be connected before the current snapshot can become ready. SmartStore 012 owns that producer path.

### Temu r16-r2

Applied frozen patch SHA-256 `3707c3e928b64b9b6259676b53902284fd7e55c059dda5030b5c0b53347e4cc3`. The initial r16 patch remains superseded.

- Added all nine preparation GET methods to the shared read-only Temu transport allowlist and executed each through the actual transport fence.
- Used one monotonic server clock across the app, token, preparation and duplicate-read collectors; timestamps are recorded after awaited responses.
- Bound an immutable, structured-cloned category plan to the exact product revision and canonical request/response digests.
- Rejected malformed or unrelated category, property, size, specification, certificate and freight rows, including malformed optional sibling rows.
- Bound the Partner app subject to the signed token subject, mall, region and product revision through readiness and prewrite.
- Rebuilt app/provider snapshots from allowlisted fields instead of retaining raw payloads or credential-shaped extras.

Independent review found no remaining P0/P1 in this patch. Central focused verification passed `102/102`, nonincremental TypeScript and scoped ESLint. The report's owner task UUID is a documentation-only typo and was returned for correction.

Temu r17 still must add the service-owned authoritative source ledger, actual source producer, route integration and local/serverless final current-row CAS. The current external state remains App information Approved, Compliance Reviewing, application Inactive and no operating production key, so no CREATE was attempted.

## Current holds and next work

- Shopee r2 is held because its stage RPC definitions and local runtime hook are absent; its current focused run fails 6 of 17 tests.
- eBay r2 is held because the current code has mock stage hooks without actual local/serverless wiring and does not yet provide safe response-loss resume across Inventory, Offer and Publish.
- Qoo10 015 r1 is being rebased on the current central route and gateway hashes; the first frozen patch did not apply cleanly over concurrent central changes.
- Lazada r3, Coupang 006 and Elevenst 012 continue in their channel tasks.

No production migration, provider mutation, OAuth refresh, deployment, commit or push was performed. Strict external evidence remains **19/48 = 39.6%** and actual new CREATE plus official remote/seller-site readback remains **0/8**.
