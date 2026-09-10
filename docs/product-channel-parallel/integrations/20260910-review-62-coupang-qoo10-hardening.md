# Review 62 — Coupang official-source and Qoo10 QSM hardening

Date: 2026-09-10 KST

## Integrated independent fixes

Applied independent patch SHA-256 `e3f5a205f523d606966d116a659d5804214801f302887ab727ba39263ebbdfd8` to the central local tree.

### Coupang

- Canonicalized the four official provider GET results for category metadata, category status, outbound place and return center.
- Bound their hashes and observed time into the readiness candidate and `sellerpilotCoupangCreateSourceRevision`.
- Added runtime verification and a five-minute provider-boundary fence in the current local migration.
- Changed an actual provider-read exception to HTTP 503 with no provider write or job creation.
- Closed the UI stale-response window by rejecting auto-fill from an earlier render generation.
- Dynamic/unit tests passed 29/29 in the combined suite; the PGlite source-revision DB fence passed 3/3.

This is an interim hardening step. Coupang 006 still owns a service-only durable official-source row and an exact current-row CAS. A hash shape, TTL and the queued payload alone cannot prove that the current official source still matches at mutation time.

### Qoo10

- Replaced the nested QSM payload denylist with exact allowed keys for dispatch and return records.
- Sorted dispatch and return records by ID before calculating the source revision and capture digest.
- Added executable counterexamples for secret-shaped/unknown nested keys and reversed record order.
- The Qoo10 focused portion of the combined suite passed 13/13.

Qoo10 CREATE remains intentionally closed until Qoo10 015 connects the service capture ledger to the real route, preflight, job payload, local/serverless worker and final mutation fence.

## Shared validation

- Combined changed suite: 42/42.
- Coupang PGlite fence: 3/3.
- Nonincremental TypeScript: pass.
- Changed-file ESLint: pass.
- Product/CS/shipping executable boundary tests: 41/41.
- No production SQL, provider write, OAuth refresh, deployment, commit or push was performed.

The strict external evidence denominator remains **19/48 = 39.6%**. Actual new CREATE plus official remote/seller-site readback remains **0/8**.
