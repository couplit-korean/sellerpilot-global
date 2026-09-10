# Shopee r6 common-file wiring (applied in this worktree)

request: `shopee-r6-common-gateway-atomic-completion`
revision: r2
state: applied-locally
base: `0fb40d4`
worktree: `/Users/kimchangheemac/dev/sellerpilot-product-shopee-local-20260910`

## Applied central wiring

1. `lib/channels/commerce-provider.ts` SG `listing.create` skips generic `prepareMarketplaceListingArguments` / listing prepare fence and passes Shopee stage hooks into the executor. Default executor is `executeShopee` → `executeShopeeSgCreateRuntime`.
2. `scripts/commerce-gateway-job.mjs` persists Shopee stage hooks to `/api/channel-gateway/worker/shopee-create-stage` (`state`, `begin`, `complete`, `resume`, `record-global`) and calls `rebind-successor` after credential refresh.
3. `lib/channels/commerce-completion.ts` generic succeeded completion does not call the generic ledger RPC unless `shopeeSgCreateCompletionMap.sameTransactionAsLocalPublish` is present with global/local ids. Owned SQL still writes mapping+job success together on local-publish.
4. `lib/channels/serverless-gateway.ts` SG `listing.create` provides the same stage hooks over RPCs (`state`/`begin`/`complete`/`resume`/`record-global`), calls `rebind-successor` after credential refresh, and keeps the same-transaction completion map after gateway result schema parse so generic prepare/ledger paths are not used.

Supporting types: `lib/product-registration/execution-shared.ts`, `lib/channels/provider-execution-contract.ts`.
