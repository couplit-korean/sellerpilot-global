import { createOpenAI, type OpenAIImageModelEditOptions } from "@ai-sdk/openai";
import { generateImage } from "ai";
import { buildThumbnailPrompt } from "../../../product-studio-prompt";
import type { ProductStudioResult, StudioImagePayload } from "../../../product-studio-types";
import { getOpenAICredential } from "../../../../lib/openai-credential";

type ThumbnailRequest = {
  image?: StudioImagePayload;
  studio?: ProductStudioResult;
};

export async function POST(request: Request) {
  const credential = await getOpenAICredential();
  if (!credential) return Response.json({ mode: "demo", reason: "OpenAI 운영 키가 연결되지 않았습니다." });

  const body = (await request.json()) as ThumbnailRequest;
  if (!body.image?.base64 || !body.studio) return Response.json({ error: "대표 이미지와 상세페이지 기획 결과가 필요합니다." }, { status: 400 });

  try {
    const openai = createOpenAI({ apiKey: credential.apiKey, project: credential.project });
    const { image } = await generateImage({
      model: openai.image("gpt-image-2"),
      prompt: { text: buildThumbnailPrompt(body.studio), images: [body.image.base64] },
      size: "1024x1024",
      providerOptions: {
        openai: {
          quality: "medium",
          inputFidelity: "high",
          outputFormat: "png",
        } satisfies OpenAIImageModelEditOptions,
      },
      abortSignal: AbortSignal.timeout(120_000),
    });

    return Response.json({ mode: "openai", dataUrl: `data:image/png;base64,${image.base64}` });
  } catch (error) {
    return Response.json({ mode: "demo", reason: error instanceof Error ? error.message.slice(0, 180) : "이미지 생성 오류" });
  }
}
