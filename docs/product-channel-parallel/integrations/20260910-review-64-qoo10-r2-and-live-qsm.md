# Review 64 — Qoo10 durable fulfillment r2 and live QSM evidence

Date: 2026-09-10 KST

## Live read-only account evidence

The `CHANGHEE` Chrome profile was selected explicitly before QSM access. Qoo10 QSM login succeeded for seller ID `zrlawjdgns`, seller display `Couplet Seoul`, and seller shop `CoupletSeoul`.

The authenticated dashboard showed 11 currently selling items and 52 registered items. The Product menu exposed the actual product-list, individual registration, bulk registration, and delivery-fee management routes. No product, delivery, return, credential, or account value was changed. The exact existing-item and fulfillment-policy capture still has to be read from the authenticated management pages and appended through the service-owned source path.

## Centrally applied local code

Applied Qoo10 r2 patch SHA-256 `65caae9d24179c69d09b7318db4be2233906291dc0be20221b41e930a0f2bcec`.

- Added migration `20260910023500_qoo10_fulfillment_evidence.sql` with private, service-only QSM fulfillment capture and consumption ledgers.
- Bound the exact owner, product, active credential version, seller, JP target, test item, dispatch place, return policy, source revision and capture digest.
- Consumed the source before request fingerprint, claim and enqueue.
- Added a final current-source CAS immediately before `ItemsBasic.SetNewGoods` in the actual executor.
- Connected the serverless mutation hook to both the QSM current-source CAS and the common provider-mutation fence.

Central focused tests passed 48/48 plus route/order tests 2/2. Nonincremental TypeScript and scoped ESLint passed. Migration inventory contains 449 files and zero duplicate versions.

## P1 hold

The synchronous local admin route currently calls only the QSM current-source CAS in its delayed mutation hook. It does not persist a provider-mutation boundary before `SetNewGoods`. If the provider accepts the write and the HTTP response is lost, the route catch completes the attempt as `failed` instead of preserving `reconciliation_required` or `manual_required` state. The current tests prove call order but do not inject response loss after `SetNewGoods` through the actual route.

Qoo10 r3 must atomically bind the current QSM source and the local attempt's provider boundary, preserve every post-boundary timeout or lost response as reconciliation, block provider replay, and recover only through official readback. Until that passes, Qoo10 is not ready for a real CREATE.

## External progress

The QSM login and seller/dashboard inspection confirm account access, but the six-stage external denominator does not increase because this stage was already counted and no new CREATE/readback stage completed. External evidence remains **19/48 = 39.6%**; actual new CREATE plus official remote/seller-site readback remains **0/8**.

No production migration, provider mutation, deployment, commit or push was performed.
