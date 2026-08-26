type StudioAdmissionRpcResult = { data: unknown; error: unknown };

type StudioAdmissionResolution =
  | { outcome: "accepted"; reconciled: boolean }
  | { outcome: "ambiguous" }
  | { outcome: "rejected"; cleanupPending: boolean };

export async function resolveStudioAdmission({
  jobId,
  createJob,
  readExactJob,
  cleanupUploads,
}: {
  jobId: string;
  createJob: () => PromiseLike<StudioAdmissionRpcResult>;
  readExactJob: () => PromiseLike<StudioAdmissionRpcResult>;
  cleanupUploads: () => Promise<void>;
}): Promise<StudioAdmissionResolution> {
  try {
    const created = await createJob();
    if (!created.error && created.data === jobId) return { outcome: "accepted", reconciled: false };
  } catch {
    // A committed insert can lose only its HTTP response. Exact readback below
    // decides whether the deterministic uploads are still live job inputs.
  }

  let readback: StudioAdmissionRpcResult;
  try {
    readback = await readExactJob();
  } catch {
    return { outcome: "ambiguous" };
  }
  if (readback.error) return { outcome: "ambiguous" };
  if (readback.data && typeof readback.data === "object" && !Array.isArray(readback.data)) {
    const job = readback.data as Record<string, unknown>;
    if (job.id === jobId && job.kind === "product_studio") {
      return { outcome: "accepted", reconciled: true };
    }
    return { outcome: "ambiguous" };
  }
  if (readback.data != null) return { outcome: "ambiguous" };

  try {
    await cleanupUploads();
    return { outcome: "rejected", cleanupPending: false };
  } catch {
    return { outcome: "rejected", cleanupPending: true };
  }
}
