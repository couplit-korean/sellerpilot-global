import type { ActiveChannelKey } from "./catalog";
import type { CredentialRefreshSnapshot, CredentialRefreshTarget } from "./protocols";
import type {
  ShopeeSgCreateStageCompletion,
  ShopeeSgCreateStageInput,
} from "../product-registration/execution-shared";
export type ServerlessGatewayExecutionHooks = {
  beginCredentialMutation: (target?: CredentialRefreshTarget) => Promise<void>;
  beginOAuthProviderCall?: () => Promise<void>;
  stageCredentialRefresh: (refresh: CredentialRefreshSnapshot) => Promise<void>;
  beginProviderMutation: (options?: {
    fresh?: boolean;
    providerBody?: Record<string, unknown>;
  }) => Promise<void>;
  stageSmartstoreCreateTransport?: (input: {
    bodyText: string;
    bodySha256: string;
    bodyByteLength: number;
    bodyBindingSha256: string;
  }) => Promise<unknown>;
  readShopeeSgCreateStageState?: () => Promise<unknown>;
  beginShopeeSgCreateStage?: (stage: ShopeeSgCreateStageInput) => Promise<unknown>;
  completeShopeeSgCreateStage?: (
    completion: ShopeeSgCreateStageCompletion,
  ) => Promise<unknown>;
  readShopeeSgCreateResume?: () => Promise<unknown>;
  recordShopeeSgGlobalCreateReadback?: (value: {
    globalItemId: string;
    createResponse: Record<string, unknown>;
    readbackResponse?: Record<string, unknown>;
    officialReadback?: Record<string, unknown>;
    preparedArguments?: Record<string, unknown>;
  }) => Promise<void>;

  assertLeaseHealthy: () => Promise<void>;
  reserveProviderRequest?: () => Promise<void>;
};

export type ProviderJob = {
  id: string; claim_token: string; credential_id: string; channel: ActiveChannelKey;
  operation: string; environment: "production" | "sandbox";
  request: Record<string, unknown>; credential: Record<string, unknown>; attempt_count: number;
  credential_binding_context?: {
    status?: string;
    sellerAccountKey?: string;
    sellerAccountKeySource?: string;
  } | null;
  // Certified seller account key delivered with the claim payload.
  seller_account_key?: string | null;
  // Provenance of that key (`provider_certified_v1`, `credential_incarnation_v1`, ...).
  seller_account_key_source?: string | null;
  temu_buyer_chat_readiness_context?: { status?: string; blocker?: string } | null;
};
export type ProviderExecutionInput = { job: ProviderJob; signal: AbortSignal; hooks: ServerlessGatewayExecutionHooks };
