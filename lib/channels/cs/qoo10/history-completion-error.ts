// Accept the old SQLSTATE during a rolling deployment only when the exact
// Qoo10 evidence-conflict message matches. Other 40001 failures stay retryable.
export function isQoo10HistoryEvidenceConflict(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return (error?.code === "PT409" || error?.code === "40001")
    && error.message === "QOO10_HISTORY_COMPLETION_REPLAY_MISMATCH";
}
