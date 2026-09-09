import type { ActiveChannelKey } from "./catalog";
import type { CredentialRefreshSnapshot, CredentialRefreshTarget } from "./protocols";
export type ServerlessGatewayExecutionHooks = {
  beginCredentialMutation: (target?: CredentialRefreshTarget) => Promise<void>;
  beginOAuthProviderCall?: () => Promise<void>;
  stageCredentialRefresh: (refresh: CredentialRefreshSnapshot) => Promise<void>;
  beginProviderMutation: (options?: { fresh?: boolean }) => Promise<void>;

  assertLeaseHealthy: () => Promise<void>;
  reserveProviderRequest?: () => Promise<void>;
};

export type ProviderJob = {
  id: string; claim_token: string; credential_id: string; channel: ActiveChannelKey;
  operation: string; environment: "production" | "sandbox";
  request: Record<string, unknown>; credential: Record<string, unknown>; attempt_count: number;
};
export type ProviderExecutionInput = { job: ProviderJob; signal: AbortSignal; hooks: ServerlessGatewayExecutionHooks };
