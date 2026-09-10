export type OperationMarginScenario = {
  id: string;
  productId: string | null;
  name: string;
  channelKey: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: string;
};
