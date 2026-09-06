import type { AdminApiContext } from "./admin-api";

export const PRODUCT_REGISTRATION_CONTEXT_RPC =
  "sellerpilot_service_get_product_registration_context";

const uuidPart = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const generatedPathPattern = new RegExp(
  `^results/(${uuidPart})/claims/(${uuidPart})/[^/]+$`,
  "i",
);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeErrorCode(message: string) {
  const match = message.match(/PRODUCT_REGISTRATION_CONTEXT_[A-Z_]+/u);
  return match?.[0] ?? null;
}

function providedAttributesAreSafe(value: unknown) {
  const attributes = record(value);
  return attributes != null && Object.values(attributes).every((attribute) => (
    typeof attribute === "string"
    || (
      Array.isArray(attribute)
      && attribute.every((entry) => typeof entry === "string")
    )
  ));
}

export function productRegistrationContextFromRead(
  value: unknown,
  ownerId: string,
  productId: string,
): Record<string, unknown> {
  const payload = typeof value === "string" ? JSON.parse(value) as unknown : value;
  const context = record(payload);
  const product = record(context?.product);
  const studioJob = context?.studioJob == null ? null : record(context.studioJob);
  const manualFields = record(context?.manualFields);
  const generatedPaths = record(context?.generatedImagePaths);
  const detailPage = record(context?.detailPage);
  if (
    !context
    || context.contract !== "sellerpilot_product_registration_context_v1"
    || context.contextMode !== "editing_only"
    || context.ownerId !== ownerId
    || !product
    || product.id !== productId
    || !manualFields
    || !Array.isArray(context.imageSpecs)
    || !Array.isArray(context.sourceImagePaths)
    || !generatedPaths
    || !Array.isArray(context.localizedListings)
    || !Array.isArray(context.assignments)
    || !Array.isArray(context.listings)
    || !detailPage
    || (context.studioJob != null && !studioJob)
  ) {
    throw new Error("PRODUCT_REGISTRATION_CONTEXT_INVALID");
  }

  const jobId = typeof studioJob?.id === "string" ? studioJob.id : "";
  if (context.sourceImagePaths.length > 0 && !jobId) {
    throw new Error("PRODUCT_REGISTRATION_CONTEXT_SOURCE_JOB_OWNER_MISMATCH");
  }
  const sourcePathPattern = new RegExp(
    `^${ownerId}/${jobId}/input/[0-9]{3}\\.jpg$`,
    "i",
  );
  if (context.sourceImagePaths.some((path) => (
    typeof path !== "string" || !sourcePathPattern.test(path)
  ))) {
    throw new Error("PRODUCT_REGISTRATION_CONTEXT_SOURCE_PATH_INVALID");
  }

  const originalPathPattern = new RegExp(
    `^${ownerId}/${jobId}/original/[0-9]{3}\\.source$`,
    "i",
  );
  if (context.imageSpecs.some((spec) => {
    const imageSpec = record(spec);
    if (!imageSpec) return true;
    if (!("originalPath" in imageSpec)) return false;
    return typeof imageSpec.originalPath !== "string"
      || !originalPathPattern.test(imageSpec.originalPath);
  })) {
    throw new Error("PRODUCT_REGISTRATION_CONTEXT_SOURCE_PATH_INVALID");
  }

  if (Object.values(generatedPaths).some((path) => (
    typeof path !== "string"
    || path.includes("..")
    || !generatedPathPattern.test(path)
  ))) {
    throw new Error("PRODUCT_REGISTRATION_CONTEXT_GENERATED_PATH_INVALID");
  }

  if (context.assignments.some((assignment) => {
    const row = record(assignment);
    return !row
      || typeof row.channel !== "string"
      || typeof row.environment !== "string"
      || typeof row.market !== "string"
      || typeof row.categoryId !== "string"
      || !Array.isArray(row.categoryPath)
      || !row.categoryPath.every((entry) => typeof entry === "string")
      || !providedAttributesAreSafe(row.providedAttributes)
      || !Array.isArray(row.requiredAttributes)
      || !record(row.officialMetadata);
  })) {
    throw new Error("PRODUCT_REGISTRATION_CONTEXT_INVALID");
  }
  if (context.listings.some((listing) => {
    const row = record(listing);
    return !row
      || typeof row.id !== "string"
      || typeof row.channel !== "string"
      || typeof row.market !== "string"
      || typeof row.targetId !== "string";
  })) {
    throw new Error("PRODUCT_REGISTRATION_CONTEXT_INVALID");
  }
  return context;
}

export async function readProductRegistrationContext(
  admin: AdminApiContext,
  productId: string,
): Promise<Record<string, unknown>> {
  let result: Awaited<ReturnType<typeof admin.serviceClient.rpc>>;
  try {
    result = await admin.serviceClient.rpc(PRODUCT_REGISTRATION_CONTEXT_RPC, {
      p_owner_id: admin.user.id,
      p_product_id: productId,
    });
  } catch {
    throw new Error("PRODUCT_REGISTRATION_CONTEXT_UNAVAILABLE");
  }
  if (result.error) {
    const code = safeErrorCode(result.error.message ?? "");
    if (code) throw new Error(code);
    throw new Error("PRODUCT_REGISTRATION_CONTEXT_UNAVAILABLE");
  }
  if (result.data == null) {
    throw new Error("PRODUCT_REGISTRATION_CONTEXT_NOT_FOUND");
  }
  try {
    return productRegistrationContextFromRead(
      result.data,
      admin.user.id,
      productId,
    );
  } catch (error) {
    const code = error instanceof Error ? safeErrorCode(error.message) : null;
    throw new Error(code ?? "PRODUCT_REGISTRATION_CONTEXT_INVALID");
  }
}
