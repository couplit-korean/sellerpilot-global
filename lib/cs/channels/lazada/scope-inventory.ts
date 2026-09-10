export const lazadaSupplementalScopeContract = "sellerpilot-lazada-supplemental-scope/2" as const;

export const lazadaSupplementalCsSurfaces = [
  {
    key: "product_review",
    label: "상품 리뷰·판매자 답글",
    state: "permission_pending",
    officialReadPaths: ["/review/seller/list"],
    officialReplyPaths: ["/review/seller/reply/add"],
    sellerCenterSurface: "review_management_visible",
    currentAppEvidence: "commerce_product_review_permission_not_visible",
    implementation: "read_only_adapter_storage_ui",
    automaticReadEnabled: false,
    livePermissionObserved: false,
    historyStorage: "implemented_local",
    mutationBoundary: "reply_requires_approved_review_and_exact_text",
  },
  {
    key: "reverse_order_after_sales",
    label: "반품·환불·취소 사후지원",
    state: "conditional",
    officialReadPaths: [
      "/reverse/getreverseordersforseller",
      "/order/reverse/return/detail/list",
      "/order/reverse/return/history/list",
      "/order/reverse/reason/list",
    ],
    officialReplyPaths: [],
    sellerCenterSurface: "return_refund_management_visible",
    currentAppEvidence: "commerce_reverse_order_management_active",
    implementation: "read_only_adapter_storage_ui",
    automaticReadEnabled: false,
    livePermissionObserved: false,
    historyStorage: "implemented_local",
    mutationBoundary: "cancel_return_refund_reject_mutations_excluded",
  },
] as const;

export function lazadaSupplementalScopeInventory() {
  return {
    contract: lazadaSupplementalScopeContract,
    surfaces: lazadaSupplementalCsSurfaces,
  };
}
