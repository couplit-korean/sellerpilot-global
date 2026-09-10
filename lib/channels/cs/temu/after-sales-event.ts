import { createHash } from "node:crypto";

function exactId(value: unknown, code: string) {
  const id = typeof value === "string"
    ? value.trim()
    : typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error(code);
  return id;
}

/** Projects the documented bg_aftersales_status_change event to a detail read. */
export function projectTemuAfterSalesStatusChange(
  event: Record<string, unknown>,
  expectedMallId: string,
) {
  const mallId = exactId(event.mallId, "TEMU_AFTER_SALES_EVENT_MALL_INVALID");
  if (mallId !== exactId(expectedMallId, "TEMU_AFTER_SALES_EVENT_SCOPE_INVALID")) {
    throw new Error("TEMU_AFTER_SALES_EVENT_SCOPE_MISMATCH");
  }
  const parentAfterSalesSn = exactId(
    event.parentAfterSalesSn,
    "TEMU_AFTER_SALES_EVENT_ID_INVALID",
  );
  const parentOrderSn = exactId(event.parentOrderSn, "TEMU_AFTER_SALES_EVENT_ORDER_INVALID");
  const updateAt = Number(event.updateAt);
  if (!Number.isSafeInteger(updateAt) || updateAt < 1_000_000_000_000 || updateAt > 9_999_999_999_999) {
    throw new Error("TEMU_AFTER_SALES_EVENT_MILLISECOND_TIMESTAMP_INVALID");
  }
  const second = Math.floor(updateAt / 1000);
  const webhookIdentity = createHash("sha256").update([
    "temu-bg-aftersales-status-change-v1",
    mallId,
    parentAfterSalesSn,
    parentOrderSn,
    String(updateAt),
    String(event.parentAfterSalesStatus ?? ""),
  ].join("\u001f")).digest("hex");

  return {
    event: "bg_aftersales_status_change" as const,
    mallId,
    parentAfterSalesSn,
    parentOrderSn,
    updateAtMillis: updateAt,
    webhookIdentity,
    readArguments: {
      kind: "after_sales" as const,
      includeDetails: true as const,
      pageNo: 1 as const,
      pageSize: 200 as const,
      updateAtStart: second,
      updateAtEnd: second,
    },
  };
}
