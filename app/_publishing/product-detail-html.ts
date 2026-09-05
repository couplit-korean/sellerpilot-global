import { productDetailChrome, resolveProductDetailLocale, type ProductDetailLocale } from "../../lib/product-detail-locale";
import type { ProductDetailData } from "../product-detail-puck";
import { productDetailRoleFromAssetReference } from "../../lib/product-detail-image-manifest";

type VerificationStatus = "verified" | "needs-review";

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
  const cta = trimmedText(props.cta);
  if (!eyebrow && !title && !description && !cta) return "";
  return [
    `<section data-sellerpilot-puck-block="hero" style="max-width:860px;margin:0 auto;padding:28px 20px;text-align:center">`,
    eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#496158">${htmlEscape(eyebrow)}</p>` : "",
    title ? `<h1 style="margin:0 0 10px;font-size:30px;line-height:1.3">${htmlEscape(title)}</h1>` : "",
    description ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.7">${htmlEscape(description)}</p>` : "",
    cta ? `<span style="display:inline-block;padding:11px 20px;border:1px solid currentColor;border-radius:999px;font-size:13px;font-weight:700">${htmlEscape(cta)}</span>` : "",
    `</section>`,
  ].join("");
}

function renderVerificationRibbonHtml(props: Record<string, unknown>, locale: ProductDetailLocale): string {
  const labels = productDetailChrome(locale);
  const verificationStatus = props.verificationStatus as VerificationStatus | undefined;
  const cells = [
    [labels.classification, trimmedText(props.classification)],
    [labels.health, trimmedText(props.healthFunctionalStatus)],
    [labels.audience, trimmedText(props.targetCustomer)],
    [verificationStatus === "verified" ? labels.verified : labels.needsReview, trimmedText(props.evidence)],
  ].filter(([, value]) => value.length > 0);
  if (!cells.length) return "";
  return [
    `<section data-sellerpilot-puck-block="verification" style="max-width:860px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:#d8dfdc;border:1px solid #d8dfdc">`,
    cells.map(([label, value]) => `<span style="display:grid;align-content:start;gap:6px;min-height:92px;padding:16px;background:#ffffff"><small style="font-size:10px;font-weight:700;letter-spacing:.06em;opacity:.6">${htmlEscape(label)}</small><b style="font-size:13px;line-height:1.55">${htmlEscape(value)}</b></span>`).join(""),
    `</section>`,
  ].join("");
}

function renderEvidenceHtml(props: Record<string, unknown>, locale: ProductDetailLocale): string {
  const labels = productDetailChrome(locale);
  const buyerQuestion = trimmedText(props.buyerQuestion);
  const evidence = trimmedText(props.evidence);
  if (!buyerQuestion && !evidence) return "";
  const verificationStatus = props.verificationStatus as VerificationStatus | undefined;
  return [
    `<p data-sellerpilot-puck-evidence="true" style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#4d5b56">`,
    buyerQuestion ? `<strong>${htmlEscape(labels.question)}</strong> · ${htmlEscape(buyerQuestion)}` : "",
    buyerQuestion && evidence ? `<br />` : "",
    evidence ? `<strong>${verificationStatus === "verified" ? labels.evidence : labels.pendingEvidence}</strong> · ${htmlEscape(evidence)}` : "",
    `</p>`,
  ].join("");
}

function renderBenefitBlockHtml(props: Record<string, unknown>, locale: ProductDetailLocale): string {
  const eyebrow = trimmedText(props.eyebrow);
  const title = trimmedText(props.title);
  const body = trimmedText(props.body);
  const points = [props.point1, props.point2, props.point3, props.point4, props.point5, props.point6].map(trimmedText).filter(Boolean);
  const evidence = renderEvidenceHtml(props, locale);
  if (!eyebrow && !title && !body && !points.length && !evidence) return "";
  return [
    `<section data-sellerpilot-puck-block="benefit" style="max-width:860px;margin:36px auto">`,
    eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#496158">${htmlEscape(eyebrow)}</p>` : "",
    title ? `<h2 style="margin:0 0 10px;font-size:24px;line-height:1.35">${htmlEscape(title)}</h2>` : "",
    body ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.75">${htmlEscape(body)}</p>` : "",
    evidence,
    points.length ? `<ul style="display:grid;gap:10px;margin:0;padding:0;list-style:none">${points.map((point) => `<li style="padding:12px 14px;border:1px solid #e4e9e6;border-radius:10px;font-size:14px;line-height:1.6">${htmlEscape(point)}</li>`).join("")}</ul>` : "",
    `</section>`,
  ].join("");
}

function renderImageStoryBlockHtml(props: Record<string, unknown>, locale: ProductDetailLocale): string {
  const eyebrow = trimmedText(props.eyebrow);
  const title = trimmedText(props.title);
  const body = trimmedText(props.body);
  const points = splitLines(props.points);
  // Rebind by asset id (imageRole or the persisted sellerpilot-asset:// reference)
  // instead of relying on the block's positional index, so reordered or re-bound
  // blocks keep resolving to the same operating asset.
  const asset = trimmedText(props.imageRole) || productDetailRoleFromAssetReference(props.imageUrl) || "";
  const imageToken = asset ? `{{SELLERPILOT_IMAGE:${asset}}}` : "";
  const evidence = renderEvidenceHtml(props, locale);
  if (!eyebrow && !title && !body && !points.length && !imageToken && !evidence) return "";
  return [
    `<section data-sellerpilot-puck-block="image-story" data-sellerpilot-image-role="${asset}" style="max-width:860px;margin:36px auto">`,
    eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#496158">${htmlEscape(eyebrow)}</p>` : "",
    title ? `<h2 style="margin:0 0 10px;font-size:24px;line-height:1.35">${htmlEscape(title)}</h2>` : "",
    body ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.75">${htmlEscape(body)}</p>` : "",
    imageToken,
    points.length ? `<ul style="margin:0 0 16px;padding:0 0 0 18px;font-size:14px;line-height:1.7">${points.map((point) => `<li>${htmlEscape(point)}</li>`).join("")}</ul>` : "",
    evidence,
    `</section>`,
  ].join("");
}

function renderStoryBlockHtml(props: Record<string, unknown>, locale: ProductDetailLocale): string {
  const eyebrow = trimmedText(props.eyebrow);
  const title = trimmedText(props.title);
  const body = trimmedText(props.body);
  const points = splitLines(props.points);
  const evidence = renderEvidenceHtml(props, locale);
  if (!eyebrow && !title && !body && !points.length && !evidence) return "";
  return [
    `<section data-sellerpilot-puck-block="story" style="max-width:860px;margin:36px auto">`,
    eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#496158">${htmlEscape(eyebrow)}</p>` : "",
    title ? `<h2 style="margin:0 0 10px;font-size:24px;line-height:1.35">${htmlEscape(title)}</h2>` : "",
    body ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.75">${htmlEscape(body)}</p>` : "",
    points.length ? `<ul style="margin:0 0 16px;padding:0 0 0 18px;font-size:14px;line-height:1.7">${points.map((point) => `<li>${htmlEscape(point)}</li>`).join("")}</ul>` : "",
    evidence,
    `</section>`,
  ].join("");
}

function renderCtaBlockHtml(props: Record<string, unknown>): string {
  const audience = trimmedText(props.audience);
  const title = trimmedText(props.title);
  const description = trimmedText(props.description);
  const checklist = trimmedText(props.checklist);
  const button = trimmedText(props.button);
  if (!audience && !title && !description && !checklist && !button) return "";
  return [
    `<section data-sellerpilot-puck-block="cta" style="max-width:860px;margin:36px auto;padding:26px 20px;text-align:center;border-radius:14px">`,
    audience ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;opacity:.7">FOR ${htmlEscape(audience)}</p>` : "",
    title ? `<h2 style="margin:0 0 10px;font-size:26px;line-height:1.35">${htmlEscape(title)}</h2>` : "",
    description ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.7">${htmlEscape(description)}</p>` : "",
    checklist ? `<p style="max-width:560px;margin:0 auto 16px;padding:12px 14px;border:1px solid rgba(0,0,0,.14);border-radius:10px;font-size:13px;line-height:1.65">${htmlEscape(checklist)}</p>` : "",
    button ? `<span style="display:inline-block;padding:11px 20px;border:1px solid currentColor;border-radius:999px;font-size:13px;font-weight:700">${htmlEscape(button)}</span>` : "",
    `</section>`,
  ].join("");
}

function renderDetailBlockHtml(block: ProductDetailData["content"][number], locale: ProductDetailLocale): string {
  const props = block.props as Record<string, unknown>;
  switch (block.type) {
    case "HeroBlock": return renderHeroBlockHtml(props);
    case "VerificationRibbonBlock": return renderVerificationRibbonHtml(props, locale);
    case "BenefitBlock": return renderBenefitBlockHtml(props, locale);
    case "ImageStoryBlock": return renderImageStoryBlockHtml(props, locale);
    case "StoryBlock": return renderStoryBlockHtml(props, locale);
    case "CtaBlock": return renderCtaBlockHtml(props);
    case "AnimatedGifBlock": return "";
    default: return "";
  }
}

export function productDetailDataToHtml(data: ProductDetailData | null | undefined, locale?: string): string {
  if (!data || !Array.isArray(data.content) || data.content.length === 0) return "";
  const resolvedLocale = resolveProductDetailLocale(data, locale);
  const blocks = data.content.map((block) => renderDetailBlockHtml(block, resolvedLocale)).filter((html) => html.length > 0);
  if (!blocks.length) return "";
  return `<div data-sellerpilot-puck-detail="true" data-sellerpilot-section-count="${blocks.length}" style="max-width:860px;margin:0 auto">${blocks.join("")}</div>`;
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
