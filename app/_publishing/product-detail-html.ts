import type { ProductDetailData } from "../product-detail-puck";
import { productDetailRoleFromAssetReference } from "../../lib/product-detail-image-manifest";

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function trimmedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function splitLines(value: unknown): string[] {
  return trimmedText(value).split("\n").map((point) => point.trim()).filter(Boolean);
}

function renderHeroBlockHtml(props: Record<string, unknown>): string {
  const eyebrow = trimmedText(props.eyebrow);
  const title = trimmedText(props.title);
  const description = trimmedText(props.description);
  if (!eyebrow && !title && !description) return "";
  return [
    `<section data-sellerpilot-puck-block="hero" style="max-width:860px;margin:0 auto;padding:56px 24px;text-align:center;background:${safeColor(props.surface, "#f4f1fa")};color:${safeColor(props.primary, "#29253d")}">`,
    eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#496158">${htmlEscape(eyebrow)}</p>` : "",
    title ? `<h1 style="margin:0 0 10px;font-size:38px;line-height:1.2;white-space:pre-line;letter-spacing:-.04em">${htmlEscape(title)}</h1>` : "",
    description ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.7">${htmlEscape(description)}</p>` : "",
    `</section>`,
  ].join("");
}

function renderVerificationRibbonHtml(props: Record<string, unknown>): string {
  const classification = trimmedText(props.classification);
  return props.verificationStatus === "verified" && classification
    ? `<section data-sellerpilot-puck-block="verification" style="padding:16px 24px;text-align:center;border-bottom:1px solid #eeedf2;font-size:13px">제품 유형 · ${htmlEscape(classification)}</section>`
    : "";
}

function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[a-f\d]{6}$/iu.test(value) ? value : fallback;
}

function renderBenefitBlockHtml(props: Record<string, unknown>): string {
  const eyebrow = trimmedText(props.eyebrow);
  const title = trimmedText(props.title);
  const body = trimmedText(props.body);
  const points = [props.point1, props.point2, props.point3, props.point4, props.point5, props.point6].map(trimmedText).filter(Boolean);
  if (!eyebrow && !title && !body && !points.length) return "";
  return [
    `<section data-sellerpilot-puck-block="benefit" style="max-width:860px;margin:0 auto;padding:48px 24px;box-sizing:border-box">`,
    eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#496158">${htmlEscape(eyebrow)}</p>` : "",
    title ? `<h2 style="margin:0 0 10px;font-size:30px;line-height:1.3;white-space:pre-line;letter-spacing:-.035em">${htmlEscape(title)}</h2>` : "",
    body ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.75">${htmlEscape(body)}</p>` : "",
    points.length ? `<ul style="display:grid;gap:10px;margin:0;padding:0;list-style:none">${points.map((point) => `<li style="padding:12px 14px;border:1px solid #e4e9e6;border-radius:10px;font-size:14px;line-height:1.6">${htmlEscape(point)}</li>`).join("")}</ul>` : "",
    `</section>`,
  ].join("");
}

function renderImageStoryBlockHtml(props: Record<string, unknown>): string {
  const eyebrow = trimmedText(props.eyebrow);
  const title = trimmedText(props.title);
  const body = trimmedText(props.body);
  const points = splitLines(props.points);
  // Rebind by asset id (imageRole or the persisted sellerpilot-asset:// reference)
  // instead of relying on the block's positional index, so reordered or re-bound
  // blocks keep resolving to the same operating asset.
  const asset = trimmedText(props.imageRole) || productDetailRoleFromAssetReference(props.imageUrl) || "";
  const imageToken = asset ? `{{SELLERPILOT_IMAGE:${asset}}}` : "";
  if (!eyebrow && !title && !body && !points.length && !imageToken) return "";
  return [
    `<section data-sellerpilot-puck-block="image-story" data-sellerpilot-image-role="${asset}" style="max-width:860px;margin:0 auto;padding:48px 24px;box-sizing:border-box">`,
    eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#496158">${htmlEscape(eyebrow)}</p>` : "",
    title ? `<h2 style="margin:0 0 10px;font-size:30px;line-height:1.3;white-space:pre-line;letter-spacing:-.035em">${htmlEscape(title)}</h2>` : "",
    body ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.75">${htmlEscape(body)}</p>` : "",
    imageToken,
    points.length ? `<ul style="margin:0 0 16px;padding:0 0 0 18px;font-size:14px;line-height:1.7">${points.map((point) => `<li>${htmlEscape(point)}</li>`).join("")}</ul>` : "",
    `</section>`,
  ].join("");
}

function renderStoryBlockHtml(props: Record<string, unknown>): string {
  const eyebrow = trimmedText(props.eyebrow);
  const title = trimmedText(props.title);
  const body = trimmedText(props.body);
  const points = splitLines(props.points);
  if (!eyebrow && !title && !body && !points.length) return "";
  return [
    `<section data-sellerpilot-puck-block="story" style="max-width:860px;margin:0 auto;padding:48px 24px;box-sizing:border-box">`,
    eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#496158">${htmlEscape(eyebrow)}</p>` : "",
    title ? `<h2 style="margin:0 0 10px;font-size:30px;line-height:1.3;white-space:pre-line;letter-spacing:-.035em">${htmlEscape(title)}</h2>` : "",
    body ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.75">${htmlEscape(body)}</p>` : "",
    points.length ? `<ul style="margin:0 0 16px;padding:0 0 0 18px;font-size:14px;line-height:1.7">${points.map((point) => `<li>${htmlEscape(point)}</li>`).join("")}</ul>` : "",
    `</section>`,
  ].join("");
}

function renderCtaBlockHtml(props: Record<string, unknown>): string {
  const audience = trimmedText(props.audience);
  const title = trimmedText(props.title);
  const description = trimmedText(props.description);
  const checklist = trimmedText(props.checklist);
  if (!audience && !title && !description && !checklist) return "";
  return [
    `<section data-sellerpilot-puck-block="cta" style="max-width:860px;margin:0 auto;padding:48px 24px;box-sizing:border-box;text-align:center;background:${safeColor(props.primary, "#29253d")};color:#fff">`,
    audience ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;opacity:.7">FOR ${htmlEscape(audience)}</p>` : "",
    title ? `<h2 style="margin:0 0 10px;font-size:26px;line-height:1.35">${htmlEscape(title)}</h2>` : "",
    description ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.7">${htmlEscape(description)}</p>` : "",
    checklist ? `<p style="max-width:560px;margin:0 auto 16px;padding:12px 14px;border:1px solid rgba(0,0,0,.14);border-radius:10px;font-size:13px;line-height:1.65">${htmlEscape(checklist)}</p>` : "",
    `</section>`,
  ].join("");
}

function renderDetailBlockHtml(block: ProductDetailData["content"][number]): string {
  const props = block.props as Record<string, unknown>;
  switch (block.type) {
    case "HeroBlock": return renderHeroBlockHtml(props);
    case "VerificationRibbonBlock": return renderVerificationRibbonHtml(props);
    case "BenefitBlock": return renderBenefitBlockHtml(props);
    case "ImageStoryBlock": return renderImageStoryBlockHtml(props);
    case "StoryBlock": return renderStoryBlockHtml(props);
    case "CtaBlock": return renderCtaBlockHtml(props);
    case "AnimatedGifBlock": return "";
    default: return "";
  }
}

export function productDetailDataToHtml(data: ProductDetailData | null | undefined): string {
  if (!data || !Array.isArray(data.content) || data.content.length === 0) return "";
  const blocks = data.content.map(renderDetailBlockHtml).filter((html) => html.length > 0);
  if (!blocks.length) return "";
  return `<div data-sellerpilot-puck-detail="true" data-sellerpilot-presentation="buyer-v1" data-sellerpilot-section-count="${blocks.length}" style="max-width:860px;margin:0 auto;background:#fff;color:#272438;font-family:Arial,sans-serif;line-height:1.75;word-break:keep-all;overflow-wrap:anywhere">${blocks.join("")}</div>`;
}

export async function fetchProductDetailData(productId: string, accessToken: string): Promise<ProductDetailData | null> {
  const response = await fetch(`/api/admin/product-detail-data?productId=${encodeURIComponent(productId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({ message: "상세페이지 편집 데이터 응답을 읽지 못했습니다." })) as { detailData?: ProductDetailData | null; message?: string };
  if (!response.ok) throw new Error(payload.message ?? "상세페이지 편집 데이터를 불러오지 못했습니다.");
  return payload.detailData ?? null;
}

export async function saveProductDetailData(productId: string, detailData: ProductDetailData, accessToken: string): Promise<void> {
  const response = await fetch("/api/admin/product-detail-data", {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ productId, detailData }),
  });
  const payload = await response.json().catch(() => ({ message: "상세페이지 편집 저장 응답을 읽지 못했습니다." })) as { ok?: boolean; message?: string };
  if (!response.ok || payload.ok !== true) throw new Error(payload.message ?? "상세페이지 편집 내용을 저장하지 못했습니다.");
}
