import {
  buildElevenstNewProductArgumentsFromServerSources,
  type ElevenstNewProductSourceBuildResult,
  type ElevenstNewProductSourceDependencies,
} from "./new-product-input-source";

export const elevenstNewProductSourceRpc =
  "sellerpilot_service_elevenst_new_product_source" as const;

type RpcResult = { data: unknown; error: unknown };

export type ElevenstNewProductSourceRpcClient = {
  rpc: (name: string, argumentsValue: Record<string, unknown>) => PromiseLike<RpcResult>;
};

type SourceKey = Parameters<ElevenstNewProductSourceDependencies["readProductSource"]>[0];

function rpcArguments(kind: string, key: SourceKey) {
  return {
    p_kind: kind,
    p_owner_id: key.ownerId,
    p_product_id: key.productId,
    p_category_id: key.categoryId,
    p_credential_id: key.credentialId,
    p_credential_version: key.credentialVersion,
  };
}

async function readSource(
  client: ElevenstNewProductSourceRpcClient,
  kind: "product" | "credential" | "notices" | "seller" | "availability" | "policy",
  key: SourceKey,
) {
  const result = await client.rpc(elevenstNewProductSourceRpc, rpcArguments(kind, key));
  if (result.error) throw new Error(`ELEVENST_NEW_PRODUCT_SOURCE_RPC_FAILED:${kind}`);
  return result.data;
}

export function elevenstNewProductSourceDependenciesFromRpc(
  client: ElevenstNewProductSourceRpcClient,
): ElevenstNewProductSourceDependencies {
  return {
    readProductSource: (key) => readSource(client, "product", key),
    readCredentialSource: (key) => readSource(client, "credential", key),
    readNoticeSource: (key) => readSource(client, "notices", key),
    readSellerSource: (key) => readSource(client, "seller", key),
    readAvailabilitySource: (key) => readSource(client, "availability", key),
    readPolicySource: (key) => readSource(client, "policy", key),
  };
}

export async function prepareElevenstNewProductCreateBeforeClaimFromRpc(input: {
  ownerId: string;
  productId: string;
  categoryId: "1346631";
  credentialId: string;
  credentialVersion: number;
  environment: "production";
  arguments: Record<string, unknown>;
  now?: Date;
}, client: ElevenstNewProductSourceRpcClient): Promise<ElevenstNewProductSourceBuildResult> {
  return buildElevenstNewProductArgumentsFromServerSources(
    input,
    elevenstNewProductSourceDependenciesFromRpc(client),
  );
}

