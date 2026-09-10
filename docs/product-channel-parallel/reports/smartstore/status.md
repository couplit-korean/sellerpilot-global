# SmartStore r4 local HOLD repair

Date: 2026-09-10 KST
Worktree: `/Users/kimchangheemac/dev/sellerpilot-product-smartstore-local-20260910`
Ledger: 2/6 (not raised). External CREATE+readback+completion remains 0/8.
HEAD base: `0fb40d4`
Commit/push: not done

## Confirmed

- Independent review-69 counterexample is now an executable failure: one unchanged source snapshot cannot bind, execute, or stage two bodies with different title/price/stock.
- Owned execute re-checks `sellerpilotSmartstoreCreateSource` against the exact CREATE body, including `bodyBindingSha256`.
- POST `/v2/products` response-loss recovery is GET-only. A recovered official product that does not match the staged body is refused and a second CREATE is not sent.
- Reserved migration `20260910050500` stages one final UTF-8 JSON body and rejects a second commercial body. Identifier lengths are <= 63 bytes. `check-migration-version.mjs` reports no local collision.
- Shared `channel-operations` maps snapshot RPC errors to HTTP 503 `smartstore_listing_create_source_unavailable` and does not claim or start a provider write.
- Shared route binds category-attribute source, then source identity/`bodyBindingSha256`, before fingerprint/claim. After media bind it attaches transport and re-checks the source. Same snapshot with a different title/price/stock body is 409 at the route.
- 50500 adds dedicated `sellerpilot_complete_smartstore_listing_create`. Owned worker route `/api/channel-gateway/worker/smartstore-create-complete` uses it. Generic gateway completion is not used on that path.
- Shared `commerce-worker-completion` now intercepts `smartstore` `listing.create` and calls `completeSmartstoreListingCreate` / `sellerpilot_complete_smartstore_listing_create`. Generic `sellerpilot_service_complete_gateway_transaction` is not used on that path. Failed listing.create is 409 and does not fall through. Same snapshot with a different title/price/stock body is sent only to the dedicated RPC, which rejects `SMARTSTORE_CREATE_COMPLETION_SOURCE_MISMATCH`.

## Unconfirmed

- Production SQL, OAuth, and provider CREATE were not performed.
- Failed listing.create jobs are refused by the generic complete handler; they are not marked failed through a dedicated failure RPC.

## Counterexample

Closed in owned modules, 50500 PGlite, shared `channel-operations` route, and shared worker completion.

Same snapshot, body A (`name`/`salePrice=10000`/`stock=1`) accepted. Body B (`다른 제목`/`990000`/`99`) rejected as `SMARTSTORE_CREATE_COMMERCIAL_SOURCE_MISMATCH` or `SMARTSTORE_CREATE_TRANSPORT_SOURCE_DRIFT` or route 409 `smartstore_listing_create_source_identity_invalid` or dedicated completion `SMARTSTORE_CREATE_COMPLETION_SOURCE_MISMATCH`. Snapshot RPC failure is 503. GET recovery of a different official title/price/stock is `SMARTSTORE_CREATE_GET_RECOVERY_MISMATCH` with one POST.

## Tests

```
node scripts/check-migration-version.mjs 20260910050500_smartstore_final_transport_and_current_state_hardening_r4.sql
node --import tsx --test tests/product-smartstore-create-contract.test.ts tests/smartstore-approved-product-create-fence.test.ts tests/smartstore-create-transport.test.ts tests/smartstore-create-source-revision-fence.test.mjs tests/smartstore-create-final-transport-r4.test.mjs tests/smartstore-create-readback-contract.test.ts tests/smartstore-current-publish-flow.test.ts tests/smartstore-create-category-source-collector.test.ts tests/smartstore-preimage-preflight.test.ts tests/smartstore-serverless-create-source-fence.test.mjs tests/server-smartstore-category-attribute-binding.test.ts tests/smartstore-worker-listing-create-completion.test.ts tests/gateway-additional-evidence-runtime.test.ts tests/smartstore-content-repair-api.test.ts tests/smartstore-manual-adoption-fixed-gateway.test.ts tests/channel-gateway-worker-route-contract.test.mjs
```

- Owned create/CAS/recovery/route/50500/source plus worker dedicated completion: 93/93 pass
- No full build, no full regression, no production apply

## Patch proposal

Applied in this worktree: `docs/product-channel-parallel/reports/smartstore/20260910-r4-channel-operations-source-unavailable.patch.md`

## Blockers

- Do not treat local tests as live registration.
- Failed listing.create has no dedicated failure completion RPC.

## Next one step

Keep ledger at 2/6. Do not apply production SQL or provider CREATE from this worktree.
