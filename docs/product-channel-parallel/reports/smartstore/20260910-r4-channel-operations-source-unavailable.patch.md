# Shared route patch proposal — SmartStore snapshot unavailable

Applied in this worktree on 2026-09-10. Snapshot RPC failure is 503 `smartstore_listing_create_source_unavailable`. Category source, transport, and `bodyBindingSha256` are attached before execute.

Current catch around `sellerpilot_service_smartstore_create_source_snapshot` maps every failure, including RPC error, to HTTP 409 `smartstore_listing_create_source_identity_invalid`. Snapshot read failure should stay 503 `smartstore_listing_create_source_unavailable` and must not claim or start a provider write.

Suggested replacement for the SmartStore `listing.create` source block:

```ts
if (channel === "smartstore" && operation === "listing.create") {
  try {
    const { data: sourceSnapshot, error: sourceSnapshotError } = await serviceClient.rpc(
      "sellerpilot_service_smartstore_create_source_snapshot",
      {
        p_owner_id: userData.user.id,
        p_product_id: parsed.data.productId!,
        p_credential_id: parsed.data.credentialId,
      },
    );
    if (sourceSnapshotError) throw new Error("SMARTSTORE_CREATE_SOURCE_SNAPSHOT_UNAVAILABLE");
    effectiveArguments = bindSmartstoreListingCreateSourceIdentity({
      argumentsValue: effectiveArguments,
      publishContext: verifiedPublishContext,
      sourceSnapshot,
      approvedDetail: approvedDetailBinding!,
      productId: parsed.data.productId!,
      credentialId: parsed.data.credentialId,
      market: parsed.data.market,
      targetId: parsed.data.targetId,
    });
  } catch (error) {
    const unavailable = error instanceof Error
      && error.message === "SMARTSTORE_CREATE_SOURCE_SNAPSHOT_UNAVAILABLE";
    return NextResponse.json({
      message: unavailable
        ? "스마트스토어 등록 소스 스냅샷을 읽지 못해 등록을 시작하지 않았습니다."
        : "선택 상품의 준비 상태와 확정 판매자 SKU를 현재 상품 원장에 결속하지 못해 스마트스토어 등록을 시작하지 않았습니다.",
      mode: unavailable
        ? "smartstore_listing_create_source_unavailable"
        : "smartstore_listing_create_source_identity_invalid",
      providerWritePerformed: false,
      jobCreated: false,
    }, {
      status: unavailable ? 503 : 409,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }
}
```
