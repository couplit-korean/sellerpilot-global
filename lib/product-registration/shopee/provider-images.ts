import {
  shopeeSgCreatePrewriteContract,
  shopeeSgCreatePrewriteEvidenceArgument,
} from "./create-prewrite-adapter";
import type { ShopeeSgRequirementRemote } from "./provider-requirements";
import { shopeePositiveInteger } from "./strict-numbers";

type UnknownRecord = Record<string, unknown>;

export type ShopeeSgProviderImageDependencies = {
  merchantGet: (path: string, query: URLSearchParams) => Promise<ShopeeSgRequirementRemote>;
  shopGet: (path: string, query: URLSearchParams) => Promise<ShopeeSgRequirementRemote>;
  uploadImage: (
    url: string,
    scene: "normal" | "desc",
    identity: { index: number; sourceSha256: string },
  ) => Promise<string>;
  assertLeaseHealthy: () => Promise<void>;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

export function shopeeSgProviderImageSourceSha256(urlValue: string) {
  try {
    const path = new URL(urlValue).pathname;
    return /\/normalized\/[a-f0-9]{2}\/([a-f0-9]{64})\.(?:jpe?g|png)$/u
      .exec(path)?.[1] ?? "";
  } catch {
    return "";
  }
}

function nonNegativeInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(text(value));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function successfulResponse(remote: ShopeeSgRequirementRemote, errorCode: string) {
  const root = record(remote.data);
  const response = record(root.response);
  if (!remote.response.ok || text(root.error) || !Object.keys(response).length) {
    throw new Error(errorCode);
  }
  return response;
}

function imagePlan(globalRemote: ShopeeSgRequirementRemote, localRemote: ShopeeSgRequirementRemote) {
  const global = successfulResponse(globalRemote, "SHOPEE_SG_GLOBAL_IMAGE_LIMIT_INVALID");
  const local = successfulResponse(localRemote, "SHOPEE_SG_LOCAL_IMAGE_LIMIT_INVALID");
  const globalGallery = record(global.global_item_image_count_limit);
  const localGallery = record(local.item_image_count_limit);
  const minimums = [nonNegativeInteger(globalGallery.min_limit), nonNegativeInteger(localGallery.min_limit)];
  const maximums = [nonNegativeInteger(globalGallery.max_limit), nonNegativeInteger(localGallery.max_limit)];
  if (minimums.some((value) => value === null) || maximums.some((value) => value === null)) {
    throw new Error("SHOPEE_SG_PROVIDER_IMAGE_LIMIT_INVALID");
  }
  const minimum = Math.max(...minimums as number[]);
  const maximum = Math.min(...maximums as number[]);
  if (minimum < 1 || maximum < minimum) throw new Error("SHOPEE_SG_PROVIDER_IMAGE_LIMIT_INVALID");
  if (minimum <= 9 && maximum >= 9) {
    return { surface: "gallery" as const, galleryCount: 9 };
  }
  if (maximum < 1 || minimum > 9) throw new Error("SHOPEE_SG_PROVIDER_IMAGE_LIMIT_INVALID");
  const globalExtended = record(global.extended_description_limit);
  const localExtended = record(local.extended_description_limit);
  const extendedMinimums = [
    nonNegativeInteger(globalExtended.description_image_num_min),
    nonNegativeInteger(localExtended.description_image_num_min),
  ];
  const extendedMaximums = [
    nonNegativeInteger(globalExtended.description_image_num_max),
    nonNegativeInteger(localExtended.description_image_num_max),
  ];
  if (extendedMinimums.some((value) => value === null)
      || extendedMaximums.some((value) => value === null)
      || Math.max(...extendedMinimums as number[]) > 8
      || Math.min(...extendedMaximums as number[]) < 8) {
    throw new Error("SHOPEE_SG_PROVIDER_DETAIL_IMAGES_UNAVAILABLE");
  }
  return { surface: "detail_content" as const, galleryCount: maximum };
}

export async function prepareShopeeSgProviderImagesOnly(input: {
  argumentsValue: UnknownRecord;
  dependencies: ShopeeSgProviderImageDependencies;
}) {
  const source = structuredClone(input.argumentsValue);
  const evidence = record(source[shopeeSgCreatePrewriteEvidenceArgument]);
  const provider = record(evidence.provider);
  const globalCategoryId = shopeePositiveInteger(provider.globalCategoryId);
  const localCategoryId = shopeePositiveInteger(provider.localCategoryId);
  const urls = Array.isArray(source.imageUrls) ? source.imageUrls.map(text) : [];
  const sourceSha256s = urls.map(shopeeSgProviderImageSourceSha256);
  if (evidence.contract !== shopeeSgCreatePrewriteContract
      || globalCategoryId === null || localCategoryId === null
      || urls.length !== 9 || urls.some((url) => !url)
      || sourceSha256s.some((digest) => !digest)
      || new Set(sourceSha256s).size !== sourceSha256s.length
      || new Set(urls).size !== urls.length) {
    throw new Error("SHOPEE_SG_PROVIDER_IMAGE_PREWRITE_INVALID");
  }
  await input.dependencies.assertLeaseHealthy();
  const globalLimit = await input.dependencies.merchantGet(
    "/api/v2/global_product/get_global_item_limit",
    new URLSearchParams({ category_id: String(globalCategoryId) }),
  );
  await input.dependencies.assertLeaseHealthy();
  const localLimit = await input.dependencies.shopGet(
    "/api/v2/product/get_item_limit",
    new URLSearchParams({ category_id: String(localCategoryId) }),
  );
  const plan = imagePlan(globalLimit, localLimit);
  const ids: string[] = [];
  for (const [index, url] of urls.entries()) {
    await input.dependencies.assertLeaseHealthy();
    const id = text(await input.dependencies.uploadImage(
      url,
      plan.surface === "detail_content" && index > 0 ? "desc" : "normal",
      { index, sourceSha256: sourceSha256s[index] },
    ));
    if (!id || ids.includes(id)) throw new Error("SHOPEE_SG_PROVIDER_IMAGE_UPLOAD_INVALID");
    ids.push(id);
  }
  const details = ids.slice(1);
  if (details.length !== 8) throw new Error("SHOPEE_SG_PROVIDER_IMAGE_UPLOAD_INVALID");
  const body = record(source.body);
  const publish = record(source.publish);
  const item = record(publish.item);
  const description = text(item.description ?? body.description);
  const extended = plan.surface === "detail_content" ? {
    description_type: "extended",
    description_info: {
      extended_description: {
        field_list: [
          ...(description ? [{ field_type: "text", text: description }] : []),
          ...details.map((imageId) => ({
            field_type: "image",
            image_info: { image_id: imageId },
          })),
        ],
      },
    },
  } : {};
  const gallery = ids.slice(0, plan.galleryCount);
  return {
    ...source,
    sellerpilotProviderDetailImageIds: details,
    sellerpilotProviderImageSurface: plan.surface,
    sellerpilotProviderImageContract: plan.surface === "gallery"
      ? "representative_plus_approved_detail_8_exact_gallery_9"
      : "approved_detail_content_exact_8",
    body: { ...body, ...extended, image: { image_id_list: gallery } },
    publish: {
      ...publish,
      item: { ...item, ...extended, image: { image_id_list: gallery } },
    },
  };
}
