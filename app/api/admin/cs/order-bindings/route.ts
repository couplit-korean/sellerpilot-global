import { NextResponse } from "next/server";
import {
  authenticateAdminRequest,
  isAdminApiError,
} from "../../../../../lib/admin-api";
import {
  csOrderBindingHealthSchema,
  csOrderBindingHealthV1Schema,
  smartstoreOrderBindingHealthV3Schema,
} from "../../../../../lib/cs/order-binding-health";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };
const SMARTSTORE_READ_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let next = 0;
  const run = async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await worker(values[index]);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => run(),
  ));
  return results;
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;

  const [legacyRead, credentialRead] = await Promise.all([
    admin.userClient.rpc("sellerpilot_read_cs_order_binding_health_v1"),
    admin.userClient.rpc("sellerpilot_list_credentials"),
  ]);
  if (legacyRead.error || credentialRead.error) {
    return NextResponse.json(
      { message: "CS 주문 결속을 읽지 못했습니다." },
      { status: 503, headers },
    );
  }

  const credentials = Array.isArray(credentialRead.data)
    ? credentialRead.data.filter((row) =>
        row && typeof row === "object"
        && row.channel === "smartstore"
        && row.environment === "production"
        && row.status === "active"
        && typeof row.id === "string")
    : [];
  const scopedReads = await mapWithConcurrency(
    credentials,
    SMARTSTORE_READ_CONCURRENCY,
    async (credential) => {
      const read = await admin.userClient.rpc(
        "sellerpilot_read_smartstore_cs_order_binding_health_v3",
        { p_credential_id: credential.id },
      );
      return { data: read.data as unknown, error: read.error };
    },
  );
  if (scopedReads.some((read) => read.error)) {
    return NextResponse.json(
      { message: "스마트스토어 계정별 주문 결속을 읽지 못했습니다." },
      { status: 503, headers },
    );
  }

  const legacy = csOrderBindingHealthV1Schema.safeParse(legacyRead.data);
  const scoped = scopedReads.map((read) =>
    smartstoreOrderBindingHealthV3Schema.safeParse(read.data));
  if (!legacy.success || scoped.some((result, index) => !result.success
      || result.data.credentialId !== credentials[index]?.id)) {
    return NextResponse.json(
      { message: "CS 주문 결속 형식을 확인하지 못했습니다." },
      { status: 502, headers },
    );
  }

  const counts = new Map<string, number>();
  for (const result of scoped) {
    if (!result.success) continue;
    for (const group of result.data.groups) {
      counts.set(group.status, (counts.get(group.status) ?? 0) + group.count);
    }
  }
  const smartstoreGroups = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => ({ channel: "smartstore" as const, status, count }));
  const checkedAt = scoped.reduce((latest, result) =>
    result.success && result.data.checkedAt > latest
      ? result.data.checkedAt
      : latest,
  legacy.data.checkedAt);

  const parsed = csOrderBindingHealthSchema.safeParse({
    contract: "sellerpilot-cs-order-binding-health/2",
    checkedAt,
    matchingRule: "preserve_v1_other_channels_and_project_smartstore_exact_product_order",
    smartstoreProjectionContract: "smartstore-cs-order-binding-projection/1",
    csCommerceMutationAllowed: false,
    groups: [
      ...legacy.data.groups.filter((group) => group.channel !== "smartstore"),
      ...smartstoreGroups,
    ],
  });
  return parsed.success
    ? NextResponse.json(parsed.data, { headers })
    : NextResponse.json(
        { message: "CS 주문 결속 형식을 확인하지 못했습니다." },
        { status: 502, headers },
      );
}
