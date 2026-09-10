type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

/** Bind option compilation to the current server-read product, before enqueue. */
export function bindCoupangCreateSourceIdentity(
  argumentsValue: RecordValue,
  publishContext: unknown,
): RecordValue {
  const context = record(publishContext);
  const manual = record(context?.manualFields);
  const product = record(context?.product);
  const canonicalSku = typeof manual?.sellerSku === "string" && manual.sellerSku.trim()
    ? manual.sellerSku.trim()
    : typeof product?.sku === "string" ? product.sku.trim() : "";
  const fail = () => { throw new Error("COUPANG_CREATE_SOURCE_IDENTITY_MISMATCH"); };
  if (!canonicalSku) return fail();
  if (Object.hasOwn(argumentsValue, "sellerpilotCoupangBaseSku")
    && argumentsValue.sellerpilotCoupangBaseSku !== canonicalSku) return fail();

  const body = record(argumentsValue.body);
  const items = Array.isArray(body?.items) ? body.items.map(record) : [];
  if (!items.length || items.some((item) => !item)) return fail();
  const facts = record(argumentsValue.facts);
  const options = facts && Object.hasOwn(facts, "coupangOptionRows") ? facts.coupangOptionRows : [];
  if (!Array.isArray(options)) return fail();
  const skus = items.map((item) => item?.externalVendorSku);
  const initialTemplate = skus.length === 1 && skus[0] === canonicalSku;
  if (!initialTemplate) {
    const expected = options.map((value) => {
      const suffix = record(value)?.skuSuffix;
      return typeof suffix === "string" && /^[A-Za-z0-9._-]+$/u.test(suffix.trim())
        ? `${canonicalSku}-${suffix.trim()}`
        : null;
    });
    if (!expected.length || expected.some((sku) => sku === null)
      || new Set(expected).size !== expected.length
      || new Set(skus).size !== skus.length
      || skus.length !== expected.length
      || skus.some((sku) => typeof sku !== "string" || !expected.includes(sku))) return fail();
  }
  return { ...argumentsValue, sellerpilotCoupangBaseSku: canonicalSku };
}
