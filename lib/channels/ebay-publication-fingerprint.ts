import { createHash } from "node:crypto";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function expectedShapeProjection(actual: unknown, expected: unknown): unknown {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return actual;
    return expected.map((item, index) => expectedShapeProjection(actual[index], item));
  }
  if (expected && typeof expected === "object") {
    const actualRecord = record(actual);
    return Object.fromEntries(
      Object.entries(expected as Record<string, unknown>).map(([key, value]) => [
        key,
        expectedShapeProjection(actualRecord[key], value),
      ]),
    );
  }
  return actual;
}

/**
 * Official Inventory/Offer GET evidence must reproduce the expected payload
 * shape. A hex expected fingerprint by itself is not verification.
 */
export function ebayOfficialPublicationFingerprintVerified(input: {
  expectedFingerprint: string;
  expectedArguments: Record<string, unknown> | null | undefined;
  offer: unknown;
  inventoryItem: unknown;
}) {
  const expectedFingerprint = typeof input.expectedFingerprint === "string"
    ? input.expectedFingerprint.toLowerCase()
    : "";
  if (!/^[a-f0-9]{64}$/u.test(expectedFingerprint) || !input.expectedArguments) {
    return false;
  }
  const expectedInventoryItem = record(input.expectedArguments.inventoryItem);
  const expectedOffer = record(input.expectedArguments.offer);
  if (Object.keys(expectedInventoryItem).length === 0
      || Object.keys(expectedOffer).length === 0) {
    return false;
  }
  const providerProjection = {
    inventoryItem: expectedShapeProjection(input.inventoryItem, expectedInventoryItem),
    offer: expectedShapeProjection(input.offer, expectedOffer),
  };
  const expectedProjection = {
    inventoryItem: expectedInventoryItem,
    offer: expectedOffer,
  };
  return sha256(providerProjection) === sha256(expectedProjection);
}
