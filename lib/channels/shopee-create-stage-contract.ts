// Shared transport data only. This module must not import a business executor.
export type ShopeeSgCreateStageName =
  | "image-upload"
  | "global-item-create"
  | "local-publish";

export type ShopeeSgCreateStageInput = {
  sequence: number;
  stage: ShopeeSgCreateStageName;
  preparedPayloadSha256: string;
  sourceUrl?: string;
  sourceSha256?: string;
  globalItemId?: string;
};

export type ShopeeSgCreateStageCompletion = ShopeeSgCreateStageInput & {
  outputId: string;
  result?: Record<string, unknown>;
};

