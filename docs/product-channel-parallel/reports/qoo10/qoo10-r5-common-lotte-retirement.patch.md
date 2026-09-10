# Qoo10 r5 common-file Lotte retirement

Applied in this worktree at 2026-09-10T17:28:37+09:00. Not committed.

## Applied

- `lib/channels/listing-update.ts`: removed Lotte protection/tuple/SKU special case. Ordinary Qoo10 updates keep published `ItemCode`. Rollback recovery kept.
- `lib/channels/commerce-worker-completion.ts`: removed `qoo10LotteExistingGatewayRequirement` / `recordQoo10LotteExistingGatewayRequirement`. Generic completion only.
- `app/api/admin/channel-operations/route.ts`: removed preview/Lotte carrier imports, hardcoded listing `13858f41-78fd-463f-9390-e8f06e71e538` / remoteId `1217536689` / SKU `AUTO-780720401E2D4E4EA45F`, and carrier-evidence binding. Duplicate success now reuses `claim.listing_id`.
- `app/api/admin/channel-operations/qoo10-lotte-postwrite/route.ts`: deleted.
- `scripts/commerce-gateway-job.mjs`: Qoo10 `listing.create` uses `/api/channel-gateway/worker/qoo10-create-boundary` (CAS). On response loss, official SellerCode GET then `POST /api/channel-gateway/worker/qoo10-create-boundary/recover`. Rejects remoteId `1217536689` as new CREATE. Does not treat GET as SetNewGoods POST success.
- `lib/channels/serverless-gateway.ts`: Qoo10 `listing.create` `beginProviderMutation` calls `sellerpilot_service_begin_qoo10_gateway_create_v1` instead of generic `sellerpilot_service_begin_serverless_gateway_provider_mutation`. On response loss, official SellerCode GET then owned recover `sellerpilot_service_qoo10_create_get_rec_v1`. Ambiguous/unavailable readback is stored as `reconciliation_required` without retry. Rejects remoteId `1217536689` as new CREATE.
