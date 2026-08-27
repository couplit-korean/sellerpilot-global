export type ProductEditDraftHydrationFence = {
  dialogOpen: boolean;
  dirty: boolean;
};

export function resolveHydratedProductEditDraft<Draft>(
  current: Draft | null,
  incoming: Draft,
  fence: ProductEditDraftHydrationFence,
) {
  return fence.dialogOpen || fence.dirty ? current : incoming;
}
