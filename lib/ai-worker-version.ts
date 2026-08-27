const minimumResultUploadWorker = Object.freeze({ major: 1, minor: 50 });

export const minimumResultUploadWorkerVersion =
  `sellerpilot-cli-worker/${minimumResultUploadWorker.major}.${minimumResultUploadWorker.minor}` as const;

/**
 * Gates only new claims that require live result-upload authorization. Existing
 * leases keep using the version-tolerant heartbeat and completion endpoints.
 */
export function supportsLiveResultUploadAuthorization(version: string) {
  const match = /^sellerpilot-cli-worker\/(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > minimumResultUploadWorker.major
    || (major === minimumResultUploadWorker.major && minor >= minimumResultUploadWorker.minor);
}
