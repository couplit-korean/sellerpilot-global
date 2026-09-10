export const ELEVENST_ISOLATED_DB_CONTRACT = Object.freeze({
  contractVersion: "sellerpilot-elevenst-isolated-db/1",
  target: "local_loopback_only",
  fixtureWrites: "disposable_database_only",
  applicationVerification: "read_only_transaction",
  productionMutationAllowed: false,
  requiredObjects: [
    "sellerpilot_private.ingest_elevenst_product_qna_v1",
    "sellerpilot_private.claim_elevenst_product_qna_reply_v1",
    "sellerpilot_private.complete_elevenst_product_qna_reply_v1",
    "sellerpilot_private.read_elevenst_product_qna_history_v1",
  ],
} as const);

export type ElevenstIsolatedDatabaseTarget = {
  contractVersion: "sellerpilot-elevenst-isolated-db/1";
  target: "local_loopback";
  port: number;
  databaseClass: "elevenst_isolated";
  productionMutationAllowed: false;
};

const DATABASE_NAME = /^sellerpilot_cs_elevenst_(?:test|isolated)(?:_[a-z0-9_]+)?$/u;

function fail(reason: string): never {
  throw new Error(`ELEVENST_ISOLATED_DB_REJECTED:${reason}`);
}

export function assertElevenstIsolatedDatabaseTarget(input: {
  databaseUrl: string;
  runtimeEnvironment: string;
}): ElevenstIsolatedDatabaseTarget {
  if (input.runtimeEnvironment.trim().toLowerCase() === "production") fail("production_runtime");
  let target: URL;
  try {
    target = new URL(input.databaseUrl);
  } catch {
    fail("invalid_url");
  }
  if (!target || !["postgres:", "postgresql:"].includes(target.protocol)) fail("invalid_protocol");
  const hostname = target.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) fail("non_loopback_host");
  if (!target.port || !/^\d{2,5}$/u.test(target.port)) fail("explicit_port_required");
  const port = Number(target.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) fail("invalid_port");
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//u, ""));
  if (!DATABASE_NAME.test(databaseName)) fail("database_name_not_isolated");
  const sslMode = target.searchParams.get("sslmode");
  if (sslMode !== null && sslMode !== "disable") fail("local_sslmode_invalid");
  return {
    contractVersion: "sellerpilot-elevenst-isolated-db/1",
    target: "local_loopback",
    port,
    databaseClass: "elevenst_isolated",
    productionMutationAllowed: false,
  };
}
