# Review 69 — RPC audit and current channel safety holds

Date: 2026-09-10 KST

## Accepted central fixes

Two PostgreSQL identifiers used through PostgREST exceeded the 63-byte catalog limit. The SmartStore category-source collector RPC is now `sellerpilot_service_smartstore_create_category_collect_ctx` (58 bytes), and the Qoo10 legacy postwrite requirement RPC is now `sellerpilot_service_record_qoo10_existing_requirement` (53 bytes). Runtime callers, migrations, tests, and the global literal/dispatched RPC identifier audit were updated together. The global audit, SmartStore focused 29/29 suite, Qoo10 historical focused 7/7 suite, nonincremental TypeScript check, and scoped diff check pass.

These identifier fixes do not increase external channel completion. They only make the intended RPCs callable after a future migration deployment.

## Lazada r5 hold

Lazada r5 remains rejected from central integration despite 374/374 owned tests passing. Independent counterexamples found:

- two 64-byte RPC names that PostgreSQL truncates, leaving the requested PostgREST RPC names unavailable;
- a completion RPC that accepts item ID and seller SKUs without complete official item/SKU visibility, provider status, verification time, remote state, or readback evidence;
- a source route that checks only bearer shape and does not bind the worker-token hash before returning Vault-backed source material;
- separate followup and generic-ledger completion transactions;
- no credential-expiry check at the immediate mutation CAS;
- incomplete 2+ result classification and order-sensitive SKU-set comparison.

Lazada r6 used valid reserved migration `20260910043500`, but the cumulative candidate is HOLD after independent executable review. The normal CreateProduct result omits the `officialEvidence` required by its own completion parser; created SKU comparison is order-sensitive; shape-only item readback with caller-supplied remote-state booleans and even a fabricated provider status can complete without image/content/locale raw evidence; current mutation CAS misses direct product status/demo/stock and listing status/remote ID drift when `updated_at` does not change; and GET-only recovery synthesizes a CreateProduct response from `/products/get`. Lazada r7 must use forward migration `20260910045000`, distinguish POST and GET-recovery receipts, bind raw request/response bytes, compare an exact SKU set, and re-read every current source field before mutation and completion.

## Temu r21 hold

Temu r21 remains rejected from central integration despite its focused suites passing. Independent Ed25519 and PGlite counterexamples found:

- a valid signature for an arbitrary different App ID can open the gate because the challenge is not bound to the intended SellerPilot App ID and key incarnation;
- no executable CHANGHEE-profile observation to canonical envelope to protected private-key signing to POST collector exists;
- a newer signed shipping/egress attestation that revokes eligibility does not close an older source permit because final CAS mixes the newest app row with older shipping evidence;
- the service-role consume RPC accepts signature-shaped data without cryptographic verification, while the repository does not yet enforce the single verified route as the only caller.

Temu r22 attempted this repair but its invalid `37500` migration and remaining trust-boundary defects make it permanently superseded.

Temu r22 was also rejected after executable counterexamples. A caller-controlled Temu path, selectors, CDP URL, and fake Chrome Local State could be signed and submitted; later-ingested blocked evidence with an older `observedAt` could be bypassed; and a rotated Vault App ID could reuse the old attestation. The Keychain CLI path lacked a scoped access-control identity, receipt verification lacked canonical DB recomputation and rotation identity, nested DB leaf schemas were open, and consume did not recheck the current credential/Vault App ID. Temu r23 used valid migrations `40500` and `40600` but is HOLD: an arbitrary 64-byte signature plus missing credential and shipping/egress fields was consumed and reached source, final CAS, and provider-begin because the DB trusted a route HMAC and the required-key predicates were not NULL-safe. Gate reads also missed current credential/Vault revalidation, blocked observations were consumed before deterministic readback, and the private key still crossed `security -w` stdout. Temu r24 owns the forward repair in `45500` with a one-time verified receipt, actual-signature fixtures, NULL-safe shapes, current-incarnation checks, deterministic blocked results, and a non-extractable Security.framework signing key.

## Frozen candidates under independent review

- The previously central-integrated SmartStore r3 and Qoo10 r4 are reopened. SmartStore accepted two materially different title/price/stock bodies from one unchanged source snapshot. Qoo10 retained active Lotte/existing-product routes, modules, worker branches, scripts, tests, and a fixed historical SKU despite the 2026-09-09 retirement decision; its final mutation boundary also ignored a post-enqueue product-status change, and response loss produced a permanent manual 409 without any official GET recovery. SmartStore r4 is direct central work in `50500`. Qoo10 r5 must remove the active legacy runtime and use `50000` for safe DB retirement, current-state CAS, the shortened fulfillment RPC successor, and durable GET-only recovery.
- Coupang cumulative r11 is HOLD. Independent PGlite counterexamples proved that a changed delivery charge and a second current confirmed category can still create a provider seal and mutation marker. Its `38000`, `38500`, and `39500` filenames are also invalid calendar timestamps. Coupang r12 must restore full stable-body CAS, exact-one current category validation, enable RLS on its private boundary tables, and use valid migrations `41500`, `42000`, and `42500`.
- eBay cumulative r4 is HOLD. Its new-file patch metadata is invalid; local OAuth refresh dereferences an undefined response; its local claim wrapper rejects nullable-attempt jobs from other channels; fresh CREATE response loss cannot reach recovery without an offer ID; mutation CAS omits current stock/USD; canonical object hashes differ from actual Inventory/Offer bytes and the empty Publish body; OAuth successors conflict with immutable stage receipts; the admin approval contract is inconsistent; and publication fingerprint evidence partly self-validates. eBay r5 must close all of these boundaries and use valid migration `40000`.
- Shopee r5 is HOLD after independent executable counterexamples. It hashes a canonical object that is not the exact JSON byte string sent by the transport; allows one matching plus one stale/conflicting current draft; leaves completed stage receipts on the old credential after OAuth successor rebinding and does not bind the Vault secret incarnation; exposes a direct warehouse transport body bypass; separates Shopee mapping from generic internal completion; and ships a red migration-chain test. Shopee r6 must use one transport byte string, exact-one full-draft cardinality, atomic credential/receipt rebinding or retirement, Vault incarnation CAS, transport-bound read-only body validation, atomic completion, and a green executable migration chain.
- Elevenst r5 is HOLD on confirmed intermediate audit findings. Two new SQL identifiers exceed 63 bytes; the recovery completion accepts insufficiently bound synthetic observations; and a fresh CREATE can find an existing SellerPrdCd and enter the normal completion path without POST. Elevenst r6 must shorten every SQL identifier, bind raw official GET evidence and every current source/credential lineage, and keep existing-product recovery outside fresh CREATE completion.

Lazada cumulative r6 remains under independent audit. Shopee r6 and Elevenst r6 are active repair rounds. Their local test counts do not increase the external-evidence denominator before the independent counterexamples and central combined suite pass.

## Migration timestamp correction

Reservations `36000`, `36500`, `37000`, `37500`, `38000`, `38500`, `39000`, and `39500` are retired because their minute components are outside `00..59`. The repository migration-version checker rejects them. Valid, collision-free replacements were checked locally: eBay `40000`, Temu `40500` and `40600`, Shopee `41000` plus forward repair `44000`, Coupang `41500`/`42000`/`42500`, Elevenst `43000` plus forward repair `44500`, and Lazada `43500`.

## Verification boundary

Product registration, CS, and shipping source directions remain isolated, and channel-module cross-dependencies remain empty. Actual provider CREATE plus official remote readback and internal completion remains 0/8. No production migration, OAuth refresh, provider mutation, deployment, commit, or push was performed.

The local progress denominator is now 18/48 (37.5%): SmartStore and Qoo10 were each reduced from 3/6 to 2/6 when the independent executable audit invalidated their previous acceptance. This correction is evidence-driven and does not represent removed production capability.
