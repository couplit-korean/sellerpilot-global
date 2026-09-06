import { qoo10Request, type SecretPayload } from "./protocols";
import { qoo10RollbackUpdateRecoveryArgument, qoo10RollbackUpdateRecoveryBinding } from "./listing-update";
import {
  qoo10ExactAdoptedLocalizationArgument,
  qoo10ExactAdoptedLocalizationBinding,
  qoo10ExactLocalizationUpdateArgument,
  qoo10ExactLocalizationUpdateBinding,
} from "./qoo10-exact-localization-identity";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function text(value: unknown) {
  return typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
}

function aliases(value: RecordValue, names: readonly string[]) {
  return Object.entries(value).filter(([key]) => names.includes(key.toLowerCase())).map(([, value]) => text(value));
}

function itemRecords(value: unknown, depth = 0): RecordValue[] {
  if (depth > 7 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => itemRecords(item, depth + 1));
  const row = record(value);
  return [
    ...(aliases(row, ["itemcode", "itemno", "gdno"]).length ? [row] : []),
    ...Object.values(row).flatMap((item) => itemRecords(item, depth + 1)),
  ];
}

// ShippingNo=0 changes a listing to free delivery; it is not an omitted value.
// https://api.qoo10.jp/GMKT.INC.Front.OpenApiService/APIList/UpdateGoods.aspx
export function qoo10ShippingFromReadback(resultObject: unknown, itemCode: string, sellerCode: string) {
  const rows = itemRecords(resultObject);
  if (rows.length !== 1) throw new Error("QOO10_UPDATE_SHIPPING_UNVERIFIED");
  const identities = aliases(rows[0], ["itemcode", "itemno", "gdno"]);
  const shipping = aliases(rows[0], ["shippingno", "deliverygroupno"]);
  const sellers = aliases(rows[0], ["sellercode"]);
  if (!identities.every((value) => value === itemCode)
      || shipping.length === 0 || new Set(shipping).size !== 1 || !/^\d+$/.test(shipping[0])
      || (sellerCode && (sellers.length === 0 || !sellers.every((value) => value === sellerCode)))) {
    throw new Error("QOO10_UPDATE_SHIPPING_UNVERIFIED");
  }
  return shipping[0];
}

export async function prepareQoo10ShippingPreservedUpdate(input: {
  arguments: RecordValue;
  credential: SecretPayload;
  assertLeaseHealthy: () => Promise<void>;
}) {
  const recoveryMarkers = [qoo10RollbackUpdateRecoveryArgument, qoo10ExactLocalizationUpdateArgument, qoo10ExactAdoptedLocalizationArgument];
  if (recoveryMarkers.some((key) => Object.hasOwn(input.arguments, key))) {
    const rollback = qoo10RollbackUpdateRecoveryBinding(input.arguments);
    const localized = qoo10ExactLocalizationUpdateBinding(input.arguments);
    const adoptedValid = !Object.hasOwn(input.arguments, qoo10ExactAdoptedLocalizationArgument)
      || qoo10ExactAdoptedLocalizationBinding(input.arguments);
    if ((!rollback && !localized) || !adoptedValid) throw new Error("QOO10_UPDATE_SHIPPING_UNVERIFIED");
    // These server-bound contracts already re-read and verify their exact
    // shipping group in operations.ts. Do not change their approved arguments.
    return input.arguments;
  }
  const params = record(input.arguments.params);
  const itemCode = text(params.ItemCode);
  const sellerCode = text(params.SellerCode);
  if (!/^\d{9,10}$/.test(itemCode)) throw new Error("QOO10_UPDATE_SHIPPING_UNVERIFIED");
  await input.assertLeaseHealthy();
  const remote = await qoo10Request({
    payload: input.credential,
    service: "ItemsLookup",
    method: "GetItemDetailInfo",
    version: "1.2",
    params: { ItemCode: itemCode, SellerCode: sellerCode },
  });
  if (!remote.response.ok || (remote.data.ResultCode !== 0 && remote.data.ResultCode !== "0")) {
    throw new Error("QOO10_UPDATE_SHIPPING_UNVERIFIED");
  }
  const shippingNo = qoo10ShippingFromReadback(remote.data.ResultObject, itemCode, sellerCode);
  await input.assertLeaseHealthy();
  return { ...input.arguments, params: { ...params, ShippingNo: shippingNo } };
}
