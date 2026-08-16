import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output, type UserModelMessage } from "ai";
import { z } from "zod";
import { createDemoStudioResult } from "../../../product-studio-fallback";
import type { StudioImagePayload } from "../../../product-studio-types";
import { getOpenAICredential } from "../../../../lib/openai-credential";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const studioSchema = z.object({
  product: z.object({
    name: z.string(),
    category: z.string(),
    oneLine: z.string(),
    targetCustomer: z.string(),
    features: z.array(z.string()).min(3).max(5),
    cautions: z.array(z.string()).min(1).max(4),
  }),
  design: z.object({
    themeName: z.string(),
    palette: z.object({ primary: hex, accent: hex, surface: hex, text: hex }),
    heroCopy: z.string(),
    heroSubcopy: z.string(),
    cta: z.string(),
    sections: z.array(z.object({
      type: z.enum(["benefit", "story", "howto", "proof", "spec", "caution"]),
      eyebrow: z.string(),
      title: z.string(),
      body: z.string(),
      points: z.array(z.string()).min(2).max(4),
    })).min(5).max(7),
  }),
  thumbnail: z.object({ headline: z.string(), subline: z.string(), badge: z.string() }),
  warnings: z.array(z.string()).max(5),
});

type StudioRequest = {
  description?: string;
  productUrl?: string;
  images?: StudioImagePayload[];
};

export async function POST(request: Request) {
  const body = (await request.json()) as StudioRequest;
  const description = body.description?.trim().slice(0, 4000) ?? "";
  const productUrl = body.productUrl?.trim().slice(0, 1000) ?? "";
  const images = (body.images ?? []).filter((image) => image.base64 && image.mediaType.startsWith("image/")).slice(0, 9);
  const credential = await getOpenAICredential();

  if (!credential) {
    return Response.json(createDemoStudioResult(description));
  }

  if (!images.length) {
    return Response.json({ error: "대표 상품 이미지가 필요합니다." }, { status: 400 });
  }

  try {
    const openai = createOpenAI({ apiKey: credential.apiKey, project: credential.project });
    const content: UserModelMessage["content"] = [
      {
        type: "text",
        text: [
          "당신은 한국·일본·동남아·미국 마켓플레이스를 이해하는 시니어 이커머스 아트디렉터이자 상품정보 검수자입니다.",
          "업로드 이미지를 우선 사실 근거로 사용하고 OCR이 불확실하거나 이미지와 설명이 충돌하면 warnings에 명시하세요.",
          "모바일에서 구매 흐름이 잘 읽히는 상세페이지를 설계하세요. hero 다음에 benefit, story/howto, proof/spec, caution 순서의 5~7개 섹션을 만드세요.",
          "의학적 효능, 인증, 원산지, 성분·함량은 확인되지 않으면 단정하지 마세요. 문구는 자연스러운 한국어로 작성하세요.",
          `판매자 입력 설명: ${description || "입력 없음"}`,
          `참고 상품 링크: ${productUrl || "입력 없음"} (링크 문자열은 출처 식별용이며, 페이지 내용을 읽었다고 가정하지 마세요.)`,
        ].join("\n"),
      },
      ...images.map((image) => ({
        type: "file" as const,
        mediaType: image.mediaType,
        data: image.base64,
        filename: image.name,
        providerOptions: { openai: { imageDetail: "high" as const } },
      })),
    ];

    const { output } = await generateText({
      model: openai.responses("gpt-5.6"),
      output: Output.object({ schema: studioSchema }),
      messages: [{ role: "user", content }],
      temperature: 0.4,
      abortSignal: AbortSignal.timeout(90_000),
    });

    return Response.json({ mode: "openai", ...output });
  } catch (error) {
    const fallback = createDemoStudioResult(description);
    const reason = error instanceof Error ? error.message.slice(0, 180) : "알 수 없는 오류";
    return Response.json({ ...fallback, warnings: [...fallback.warnings, `AI 호출 오류로 임의 데이터가 표시됩니다: ${reason}`] });
  }
}
