import { validatePreservedStudioUploadPaths } from "./studio-image-paths";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function rejectedUploadPaths(payload: unknown, userId: string) {
  if (!payload || typeof payload !== "object" || !uuidPattern.test(userId)) return [];
  const row = payload as Record<string, unknown>;
  const jobId = typeof row.jobId === "string" ? row.jobId : "";
  const imagePaths = Array.isArray(row.imagePaths) ? row.imagePaths : [];
  if (!uuidPattern.test(jobId) || imagePaths.length < 1 || imagePaths.length > 100) return [];
  if (imagePaths.some((path) => typeof path !== "string" || path.length < 1 || path.length > 400)) return [];

  const paths = imagePaths as string[];
  const expectedPrefix = `${userId}/${jobId}/input/`;
  if (paths.some((path) => !path.startsWith(expectedPrefix) || path.includes(".."))) return [];
  const imageSpecs = Array.isArray(row.imageSpecs)
    ? row.imageSpecs.filter((spec): spec is Record<string, unknown> => Boolean(spec) && typeof spec === "object" && !Array.isArray(spec))
    : [];
  const preserved = validatePreservedStudioUploadPaths(userId, jobId, paths, imageSpecs);
  return preserved?.allPaths ?? paths;
}
