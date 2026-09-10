import { publishRegistrationDataSchema, publishRegistrationIdentity } from "../../publish-registration-draft";
import { shopeePositiveMoney } from "./strict-numbers";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function money(value: unknown) {
  return shopeePositiveMoney(value);
}

function samePath(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((part, index) => part === right[index]);
}

export function shopeeSgStoredCreatePrices(input: {
  draftData: unknown;
  credentialId: unknown;
  market: unknown;
  targetId: unknown;
  categoryId: unknown;
  transmittedArguments: unknown;
}) {
  const draft = publishRegistrationDataSchema.safeParse(input.draftData);
  const market = text(input.market).toUpperCase();
  const targetId = text(input.targetId);
  const credentialId = text(input.credentialId);
  const categoryId = text(input.categoryId);
  if (!draft.success || market !== "SG" || !targetId || !credentialId || !categoryId) {
    throw new Error("SHOPEE_SG_STORED_PRICES_UNVERIFIED");
  }
  const identity = publishRegistrationIdentity("shopee", market, targetId, credentialId);
  const channel = draft.data.channels[identity];
  if (!channel || channel.categoryId !== categoryId) {
    throw new Error("SHOPEE_SG_STORED_PRICES_UNVERIFIED");
  }
  const localPricePatches = channel.patches.filter((patch) => (
    samePath(patch.path, ["publish", "item", "original_price"])
  ));
  const targetPrice = localPricePatches.length === 1
    ? money(localPricePatches[0].value)
    : null;
  const globalPrice = money(draft.data.common.globalBaseUsdPrice);
  const transmitted = record(input.transmittedArguments);
  const body = record(transmitted?.body);
  const publish = record(transmitted?.publish);
  const item = record(publish?.item);
  if (targetPrice === null || globalPrice === null
    || money(item?.original_price) !== targetPrice
    || money(body?.original_price) !== globalPrice) {
    throw new Error("SHOPEE_SG_STORED_PRICES_UNVERIFIED");
  }
  return { targetPriceSgd: targetPrice, globalPriceUsd: globalPrice, identity };
}
