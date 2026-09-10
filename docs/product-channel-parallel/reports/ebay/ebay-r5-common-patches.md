# eBay r5 common-file patch proposals

These files are outside the eBay-owned edit set. Apply only after independent review. No production apply.

## 1. `scripts/commerce-gateway-job.mjs`

Do not require `attempt_id` for non-eBay jobs. Parse refresh receipts with `ebayCreateCredentialRefreshIncarnationFromResponse` so an undefined/non-OK response cannot be dereferenced.

```diff
--- a/scripts/commerce-gateway-job.mjs
+++ b/scripts/commerce-gateway-job.mjs
@@
+import { attachEbayCreateClaimIncarnation } from "../lib/channels/ebay-create-claim.ts";
+import { ebayCreateCredentialRefreshIncarnationFromResponse } from "../lib/channels/ebay-credential-refresh-receipt.ts";
@@
-  const claimed = await claimGatewayJob(...);
+  const claimed = attachEbayCreateClaimIncarnation(await claimGatewayJob(...));
@@
-    await persistWorkerCompletion("/api/channel-gateway/worker/credential-refresh", ...);
+    const response = await persistWorkerCompletion("/api/channel-gateway/worker/credential-refresh", ...);
+    const incarnation = await ebayCreateCredentialRefreshIncarnationFromResponse(
+      response,
+      job.channel === "ebay" && job.operation === "listing.create",
+    );
```

## 2. `app/api/channel-gateway/worker/credential-refresh/route.ts`

After a successful stage, call `sellerpilot_service_ebay_create_credential_incarnation_v1` and return `{ status, credentialIncarnation }` without mutating immutable stage receipts.

## 3. `lib/channels/listing-publication-readback.ts`

Stop treating a hex `publicationExpectedFingerprint` as verified. Compare official Inventory/Offer GET projections to `expectedArguments` via `ebayOfficialPublicationFingerprintVerified`.

## 4. `app/api/admin/channel-operations/route.ts`

Strip client `sellerpilotEbayCreateApproval`, prepare images, then `buildEbayCreateApproval`. Fail closed if revision-backed eBay create cannot build the receipt. Bind server ledger snapshot + current category assignment before enqueue.

Do not wrap `public.sellerpilot_claim_channel_gateway_job`. Other channels keep nullable `attempt_id`.

## 5. `scripts/channel-gateway-worker.mjs` (applied in this worktree)

HTTP claim JSON is inspected with `attachEbayCreateClaimIncarnation` before `processGatewayJob`. eBay `listing.create` without attempt/version/fingerprint fails closed. Other-channel jobs, including null `attempt_id`, pass through. The claim RPC is not wrapped.
