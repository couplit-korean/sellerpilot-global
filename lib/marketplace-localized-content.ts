import type { ActiveChannelKey } from "./channels/catalog";

export const localizedDetailImageRoles = [
  "detail-overview",
  "detail-feature",
  "detail-use",
  "detail-package",
  "detail-routine",
  "detail-scale",
  "detail-storage",
  "detail-context",
  "detail-material",
  "detail-dimensions",
  "detail-contents",
  "detail-care",
] as const;

export type LocalizedDetailImageRole = (typeof localizedDetailImageRoles)[number];

export const localizedDetailSectionTypes = ["overview", "feature", "howto", "spec", "routine", "contents", "care", "proof"] as const;

export type LocalizedDetailSectionType = (typeof localizedDetailSectionTypes)[number];

export type LocalizedProductClassification = {
  displayName: string;
  verificationStatus: "verified" | "needs-review";
  evidence: string;
  isHealthFunctionalFood: boolean | null;
};

export type LocalizedDetailSection = {
  type: LocalizedDetailSectionType;
  buyerQuestion?: string;
  evidence?: string;
  heading: string;
  body: string;
  imageAsset: LocalizedDetailImageRole;
  imageAltText: string;
};

export type LocalizedCreativeListing = {
  locale?: string;
  title: string;
  shortDescription: string;
  description: string;
  keywords: string[];
  thumbnailAltText?: string;
  detailSections?: LocalizedDetailSection[];
  classification?: LocalizedProductClassification;
};

export type LocalizedDetailRenderContext = {
  classification?: LocalizedProductClassification;
};

type PlainDetailPart = {
  prefix?: string;
  value: string;
  minimum: number;
  weight: number;
};

const fallbackDetailOrders: Record<ActiveChannelKey, LocalizedDetailImageRole[]> = {
  qoo10: ["detail-overview", "detail-feature", "detail-context", "detail-package", "detail-contents", "detail-use", "detail-routine", "detail-care"],
  shopee: ["detail-overview", "detail-feature", "detail-use", "detail-routine", "detail-contents", "detail-package", "detail-context", "detail-care"],
  lazada: ["detail-overview", "detail-feature", "detail-use", "detail-routine", "detail-context", "detail-package", "detail-contents", "detail-care"],
  coupang: ["detail-context", "detail-overview", "detail-feature", "detail-package", "detail-contents", "detail-use", "detail-care", "detail-routine"],
  elevenst: ["detail-overview", "detail-context", "detail-feature", "detail-package", "detail-use", "detail-contents", "detail-care", "detail-routine"],
  smartstore: ["detail-overview", "detail-feature", "detail-context", "detail-use", "detail-package", "detail-contents", "detail-care", "detail-routine"],
  ebay: ["detail-overview", "detail-context", "detail-package", "detail-feature", "detail-contents", "detail-use", "detail-care", "detail-routine"],
  temu: ["detail-overview", "detail-feature", "detail-context", "detail-contents", "detail-package", "detail-use", "detail-routine", "detail-care"],
};

const detailTypeOrders: Record<ActiveChannelKey, LocalizedDetailSectionType[]> = {
  qoo10: ["overview", "feature", "proof", "spec", "contents", "howto", "routine", "care"],
  shopee: ["overview", "feature", "howto", "routine", "contents", "spec", "proof", "care"],
  lazada: ["overview", "feature", "howto", "routine", "proof", "spec", "contents", "care"],
  coupang: ["proof", "overview", "feature", "spec", "contents", "howto", "care", "routine"],
  elevenst: ["overview", "proof", "feature", "spec", "howto", "contents", "care", "routine"],
  smartstore: ["overview", "feature", "proof", "howto", "spec", "contents", "care", "routine"],
  ebay: ["overview", "proof", "spec", "feature", "contents", "howto", "care", "routine"],
  temu: ["overview", "feature", "proof", "contents", "spec", "howto", "routine", "care"],
};

const galleryOrders: Record<ActiveChannelKey, string[]> = {
  qoo10: ["square", "hero", "portrait", "wide"],
  shopee: ["square", "hero", "portrait", "wide"],
  lazada: ["square", "hero", "wide", "portrait"],
  coupang: ["square", "hero", "portrait", "wide"],
  elevenst: ["square", "hero", "portrait", "wide"],
  smartstore: ["square", "hero", "portrait", "wide"],
  ebay: ["square", "hero", "wide", "portrait"],
  temu: ["square", "hero", "wide", "portrait"],
};

type LocalizedDetailLabels = {
  classification: string;
  verified: string;
  needsReview: string;
  healthFunctionalFood: string;
  notHealthFunctionalFood: string;
  healthStatusNeedsReview: string;
  buyerQuestion: string;
  evidence: string;
};

const englishLabels: LocalizedDetailLabels = {
  classification: "Product classification",
  verified: "Verified from supplied evidence",
  needsReview: "Seller review required",
  healthFunctionalFood: "Verified health functional food",
  notHealthFunctionalFood: "Not verified as a health functional food",
  healthStatusNeedsReview: "Health functional food status requires verification",
  buyerQuestion: "Buyer question",
  evidence: "Verification basis",
};

function labelsForLocale(locale: string | undefined): LocalizedDetailLabels {
  const language = locale?.split("-")[0]?.toLocaleLowerCase();
  if (language === "ko") return { classification: "상품 분류", verified: "제공 근거로 확인됨", needsReview: "판매자 확인 필요", healthFunctionalFood: "건강기능식품으로 확인됨", notHealthFunctionalFood: "건강기능식품으로 확인되지 않음", healthStatusNeedsReview: "건강기능식품 여부 확인 필요", buyerQuestion: "구매자 질문", evidence: "확인 근거" };
  if (language === "ja") return { classification: "商品分類", verified: "提供された根拠で確認済み", needsReview: "出品者の確認が必要", healthFunctionalFood: "機能性表示を確認済み", notHealthFunctionalFood: "機能性食品として未確認", healthStatusNeedsReview: "機能性食品の該当性を要確認", buyerQuestion: "購入前の質問", evidence: "確認根拠" };
  if (language === "ms") return { classification: "Klasifikasi produk", verified: "Disahkan daripada bukti yang diberi", needsReview: "Semakan penjual diperlukan", healthFunctionalFood: "Disahkan sebagai makanan berfungsi kesihatan", notHealthFunctionalFood: "Tidak disahkan sebagai makanan berfungsi kesihatan", healthStatusNeedsReview: "Status makanan berfungsi kesihatan perlu disahkan", buyerQuestion: "Soalan pembeli", evidence: "Asas pengesahan" };
  if (language === "vi") return { classification: "Phân loại sản phẩm", verified: "Đã xác minh từ bằng chứng được cung cấp", needsReview: "Cần người bán kiểm tra", healthFunctionalFood: "Đã xác minh là thực phẩm bảo vệ sức khỏe", notHealthFunctionalFood: "Chưa được xác minh là thực phẩm bảo vệ sức khỏe", healthStatusNeedsReview: "Cần xác minh tình trạng thực phẩm bảo vệ sức khỏe", buyerQuestion: "Câu hỏi của người mua", evidence: "Căn cứ xác minh" };
  if (language === "th") return { classification: "การจัดประเภทสินค้า", verified: "ตรวจสอบจากหลักฐานที่ให้แล้ว", needsReview: "ผู้ขายต้องตรวจสอบ", healthFunctionalFood: "ยืนยันว่าเป็นอาหารเพื่อสุขภาพ", notHealthFunctionalFood: "ยังไม่ยืนยันว่าเป็นอาหารเพื่อสุขภาพ", healthStatusNeedsReview: "ต้องตรวจสอบสถานะอาหารเพื่อสุขภาพ", buyerQuestion: "คำถามของผู้ซื้อ", evidence: "หลักฐานยืนยัน" };
  if (language === "zh") return { classification: "商品分類", verified: "已依提供的證據確認", needsReview: "需要賣家確認", healthFunctionalFood: "已確認為健康機能食品", notHealthFunctionalFood: "未確認為健康機能食品", healthStatusNeedsReview: "健康機能食品狀態待確認", buyerQuestion: "買家問題", evidence: "確認依據" };
  if (language === "pt") return { classification: "Classificação do produto", verified: "Verificado com as evidências fornecidas", needsReview: "Requer verificação do vendedor", healthFunctionalFood: "Verificado como alimento funcional", notHealthFunctionalFood: "Não verificado como alimento funcional", healthStatusNeedsReview: "O status de alimento funcional requer verificação", buyerQuestion: "Pergunta do comprador", evidence: "Base da verificação" };
  if (language === "es") return { classification: "Clasificación del producto", verified: "Verificado con la evidencia proporcionada", needsReview: "Requiere revisión del vendedor", healthFunctionalFood: "Verificado como alimento funcional", notHealthFunctionalFood: "No verificado como alimento funcional", healthStatusNeedsReview: "Debe verificarse si es un alimento funcional", buyerQuestion: "Pregunta del comprador", evidence: "Base de verificación" };
  if (language === "id") return { classification: "Klasifikasi produk", verified: "Terverifikasi dari bukti yang diberikan", needsReview: "Perlu ditinjau penjual", healthFunctionalFood: "Terverifikasi sebagai pangan fungsional kesehatan", notHealthFunctionalFood: "Belum terverifikasi sebagai pangan fungsional kesehatan", healthStatusNeedsReview: "Status pangan fungsional kesehatan perlu diverifikasi", buyerQuestion: "Pertanyaan pembeli", evidence: "Dasar verifikasi" };
  if (language === "de") return { classification: "Produktklassifizierung", verified: "Anhand der vorliegenden Nachweise bestätigt", needsReview: "Prüfung durch den Verkäufer erforderlich", healthFunctionalFood: "Als funktionelles Lebensmittel bestätigt", notHealthFunctionalFood: "Nicht als funktionelles Lebensmittel bestätigt", healthStatusNeedsReview: "Status als funktionelles Lebensmittel muss geprüft werden", buyerQuestion: "Käuferfrage", evidence: "Prüfgrundlage" };
  if (language === "fr") return { classification: "Classification du produit", verified: "Vérifié à partir des preuves fournies", needsReview: "Vérification du vendeur requise", healthFunctionalFood: "Vérifié comme aliment fonctionnel", notHealthFunctionalFood: "Non vérifié comme aliment fonctionnel", healthStatusNeedsReview: "Le statut d’aliment fonctionnel doit être vérifié", buyerQuestion: "Question de l’acheteur", evidence: "Base de vérification" };
  if (language === "it") return { classification: "Classificazione del prodotto", verified: "Verificato in base alle prove fornite", needsReview: "È necessaria la verifica del venditore", healthFunctionalFood: "Verificato come alimento funzionale", notHealthFunctionalFood: "Non verificato come alimento funzionale", healthStatusNeedsReview: "Lo stato di alimento funzionale richiede verifica", buyerQuestion: "Domanda dell’acquirente", evidence: "Base della verifica" };
  return englishLabels;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function cleanList(values: unknown, maximum = 10) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))].slice(0, maximum);
}

function normalizedClassification(classification: LocalizedProductClassification | undefined) {
  if (!classification || !classification.displayName?.trim() || !classification.evidence?.trim()) return undefined;
  if (classification.verificationStatus !== "verified" && classification.verificationStatus !== "needs-review") return undefined;
  return {
    displayName: classification.displayName.trim(),
    verificationStatus: classification.verificationStatus,
    evidence: classification.evidence.trim(),
    isHealthFunctionalFood: typeof classification.isHealthFunctionalFood === "boolean" ? classification.isHealthFunctionalFood : null,
  } satisfies LocalizedProductClassification;
}

function resolvedClassification(listing: LocalizedCreativeListing | undefined, context: LocalizedDetailRenderContext | undefined) {
  return normalizedClassification(context?.classification ?? listing?.classification);
}

function healthStatusText(classification: LocalizedProductClassification, labels: LocalizedDetailLabels) {
  if (classification.isHealthFunctionalFood === true) return labels.healthFunctionalFood;
  if (classification.isHealthFunctionalFood === false) return labels.notHealthFunctionalFood;
  return labels.healthStatusNeedsReview;
}

function codePoints(value: string) {
  return Array.from(value);
}

function clippedPlainValue(value: string, maximum: number) {
  const points = codePoints(value.trim());
  if (points.length <= maximum) return points.join("");
  if (maximum <= 1) return points.slice(0, Math.max(0, maximum)).join("");
  return `${points.slice(0, maximum - 1).join("")}…`;
}

function fitPlainDetailParts(parts: PlainDetailPart[], maximumCharacters: number) {
  const values = parts
    .map((part) => ({ ...part, prefix: part.prefix ?? "", value: part.value.trim() }))
    .filter((part) => part.value.length > 0);
  if (!values.length || maximumCharacters <= 0) return "";
  const separatorLength = Math.max(0, values.length - 1) * 2;
  const fixedLength = separatorLength + values.reduce((total, part) => total + codePoints(part.prefix).length, 0);
  const available = Math.max(values.length, maximumCharacters - fixedLength);
  const lengths = values.map((part) => codePoints(part.value).length);
  const allocations = values.map((part, index) => Math.min(lengths[index], Math.max(1, part.minimum)));
  let allocated = allocations.reduce((total, length) => total + length, 0);
  while (allocated > available) {
    let changed = false;
    for (let index = allocations.length - 1; index >= 0 && allocated > available; index -= 1) {
      if (allocations[index] <= 1) continue;
      allocations[index] -= 1;
      allocated -= 1;
      changed = true;
    }
    if (!changed) break;
  }
  const expansionOrder = values.flatMap((part, index) => Array.from({ length: Math.max(1, part.weight) }, () => index));
  let remaining = Math.max(0, available - allocated);
  while (remaining > 0) {
    let changed = false;
    for (const index of expansionOrder) {
      if (remaining <= 0) break;
      if (allocations[index] >= lengths[index]) continue;
      allocations[index] += 1;
      remaining -= 1;
      changed = true;
    }
    if (!changed) break;
  }
  const rendered = values
    .map((part, index) => `${part.prefix}${clippedPlainValue(part.value, allocations[index])}`)
    .join("\n\n");
  return codePoints(rendered).slice(0, maximumCharacters).join("");
}

function localizedPlainDetailParts(
  listing: LocalizedCreativeListing | undefined,
  fallbackTitle: string,
  fallbackDescription: string,
  context?: LocalizedDetailRenderContext,
) {
  const title = listing?.title?.trim() || fallbackTitle;
  const summary = listing?.shortDescription?.trim() || listing?.description?.trim() || fallbackDescription;
  const description = listing?.description?.trim() || fallbackDescription;
  const sections = normalizedLocalizedDetailSections(listing);
  const classification = resolvedClassification(listing, context);
  const labels = labelsForLocale(listing?.locale);
  const parts: PlainDetailPart[] = [
    { value: title, minimum: 20, weight: 2 },
    { value: summary, minimum: 48, weight: 2 },
    { value: description, minimum: 80, weight: 2 },
  ];
  if (classification) {
    parts.push(
      { prefix: `${labels.classification}: `, value: classification.displayName, minimum: 20, weight: 2 },
      { value: classification.verificationStatus === "verified" ? labels.verified : labels.needsReview, minimum: 12, weight: 1 },
      { value: healthStatusText(classification, labels), minimum: 12, weight: 1 },
      { prefix: `${labels.evidence}: `, value: classification.evidence, minimum: 40, weight: 2 },
    );
  }
  for (const section of sections) {
    if (section.buyerQuestion) parts.push({ prefix: `${labels.buyerQuestion}: `, value: section.buyerQuestion, minimum: 30, weight: 2 });
    parts.push(
      { value: section.heading, minimum: 16, weight: 2 },
      { value: section.body, minimum: 72, weight: 4 },
    );
    if (section.evidence) parts.push({ prefix: `${labels.evidence}: `, value: section.evidence, minimum: 32, weight: 2 });
  }
  return parts;
}

export function galleryAssetOrderForChannel(channel: ActiveChannelKey) {
  return galleryOrders[channel];
}

export function detailAssetOrderForChannel(channel: ActiveChannelKey, listing?: LocalizedCreativeListing) {
  const sections = normalizedLocalizedDetailSections(listing);
  if (!sections.length) return fallbackDetailOrders[channel];
  const ranks = new Map(detailTypeOrders[channel].map((type, index) => [type, index]));
  return [...sections]
    .sort((left, right) => (ranks.get(left.type) ?? 99) - (ranks.get(right.type) ?? 99))
    .map((section) => section.imageAsset);
}

export function normalizedLocalizedDetailSections(listing: LocalizedCreativeListing | undefined) {
  if (!listing || !Array.isArray(listing.detailSections)) return [];
  const validAssets = new Set<string>(localizedDetailImageRoles);
  const validTypes = new Set<string>(localizedDetailSectionTypes);
  const seenAssets = new Set<LocalizedDetailImageRole>();
  const seenTypes = new Set<LocalizedDetailSectionType>();
  const sections: LocalizedDetailSection[] = [];
  for (const section of listing.detailSections) {
    if (!section || !validAssets.has(section.imageAsset) || !validTypes.has(section.type)) continue;
    if (seenAssets.has(section.imageAsset) || seenTypes.has(section.type)) continue;
    if (!section.heading?.trim() || !section.body?.trim() || !section.imageAltText?.trim()) continue;
    const buyerQuestion = section.buyerQuestion?.trim();
    const evidence = section.evidence?.trim();
    sections.push({
      ...section,
      ...(buyerQuestion ? { buyerQuestion } : {}),
      ...(evidence ? { evidence } : {}),
      heading: section.heading.trim(),
      body: section.body.trim(),
      imageAltText: section.imageAltText.trim(),
    });
    seenAssets.add(section.imageAsset);
    seenTypes.add(section.type);
    if (sections.length === localizedDetailSectionTypes.length) break;
  }
  return sections;
}

export function localizedImageSeo(listing: LocalizedCreativeListing | undefined, channel: ActiveChannelKey, fallbackTitle: string) {
  const sections = normalizedLocalizedDetailSections(listing);
  const byAsset = new Map(sections.map((section) => [section.imageAsset, section]));
  const detailImageRoles = detailAssetOrderForChannel(channel, listing);
  return {
    thumbnailAltText: listing?.thumbnailAltText?.trim() || listing?.title?.trim() || fallbackTitle,
    detailImageRoles,
    detailImageAltTexts: detailImageRoles.map((role) => byAsset.get(role)?.imageAltText || `${listing?.title?.trim() || fallbackTitle} ${role.replace("detail-", "")}`),
  };
}

export function buildLocalizedRichDetail(
  listing: LocalizedCreativeListing | undefined,
  fallbackTitle: string,
  fallbackDescription: string,
  context?: LocalizedDetailRenderContext,
) {
  const title = listing?.title?.trim() || fallbackTitle;
  const shortDescription = listing?.shortDescription?.trim() || listing?.description?.trim() || fallbackDescription;
  const description = listing?.description?.trim() || fallbackDescription;
  const sections = normalizedLocalizedDetailSections(listing);
  const classification = resolvedClassification(listing, context);
  const labels = labelsForLocale(listing?.locale);
  const classificationHtml = classification ? [
    `<section data-sellerpilot-classification="${classification.verificationStatus}" data-health-functional-food="${classification.isHealthFunctionalFood === null ? "unknown" : String(classification.isHealthFunctionalFood)}" style="max-width:860px;margin:24px auto;padding:18px 20px;border:1px solid #d8dfdc;border-radius:14px;background:#f7faf8">`,
    `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#496158">${escapeHtml(labels.classification)}</p>`,
    `<h2 style="margin:0 0 8px;font-size:22px;line-height:1.4">${escapeHtml(classification.displayName)}</h2>`,
    `<p style="margin:0 0 6px;font-size:14px;line-height:1.65"><strong>${escapeHtml(classification.verificationStatus === "verified" ? labels.verified : labels.needsReview)}</strong> · ${escapeHtml(healthStatusText(classification, labels))}</p>`,
    `<p data-sellerpilot-classification-evidence="true" style="margin:0;font-size:13px;line-height:1.65;color:#4d5b56">${escapeHtml(classification.evidence)}</p>`,
    "</section>",
  ].join("") : "";
  const sectionHtml = sections.map((section) => [
    `<section data-sellerpilot-section="${section.type}" data-sellerpilot-image-role="${section.imageAsset}" style="max-width:860px;margin:36px auto">`,
    section.buyerQuestion ? `<p data-sellerpilot-buyer-question="true" style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#496158"><strong>${escapeHtml(labels.buyerQuestion)}</strong> · ${escapeHtml(section.buyerQuestion)}</p>` : "",
    `<h2 style="margin:0 0 10px;font-size:24px;line-height:1.35">${escapeHtml(section.heading)}</h2>`,
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.75">${escapeHtml(section.body)}</p>`,
    `{{SELLERPILOT_IMAGE:${section.imageAsset}}}`,
    section.evidence ? `<aside data-sellerpilot-evidence="true" style="margin:14px 0 0;padding:12px 14px;border-left:3px solid #7c958b;background:#f7faf8;font-size:13px;line-height:1.65;color:#4d5b56"><strong>${escapeHtml(labels.evidence)}</strong> · ${escapeHtml(section.evidence)}</aside>` : "",
    "</section>",
  ].join("")).join("");
  return [
    `<div data-sellerpilot-localized-detail="true" data-sellerpilot-section-count="${sections.length}" style="max-width:860px;margin:0 auto">`,
    `<h1 style="margin:0 0 12px;font-size:30px;line-height:1.3">${escapeHtml(title)}</h1>`,
    `<p style="margin:0 0 14px;font-size:18px;line-height:1.65">${escapeHtml(shortDescription)}</p>`,
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.75">${escapeHtml(description)}</p>`,
    classificationHtml,
    sectionHtml,
    "</div>",
  ].join("");
}

export function buildLocalizedPlainDetail(
  listing: LocalizedCreativeListing | undefined,
  fallbackTitle: string,
  fallbackDescription: string,
  context?: LocalizedDetailRenderContext,
) {
  return localizedPlainDetailParts(listing, fallbackTitle, fallbackDescription, context)
    .map((part) => `${part.prefix ?? ""}${part.value.trim()}`)
    .filter(Boolean)
    .join("\n\n");
}

export function buildLocalizedBudgetedPlainDetail(
  listing: LocalizedCreativeListing | undefined,
  fallbackTitle: string,
  fallbackDescription: string,
  maximumCharacters: number,
  context?: LocalizedDetailRenderContext,
) {
  return fitPlainDetailParts(
    localizedPlainDetailParts(listing, fallbackTitle, fallbackDescription, context),
    maximumCharacters,
  );
}

export function buildLocalizedSectionBulletPoints(listing: LocalizedCreativeListing | undefined, maximumCharacters = 700) {
  const labels = labelsForLocale(listing?.locale);
  return normalizedLocalizedDetailSections(listing).map((section) => fitPlainDetailParts([
    { value: section.heading, minimum: 16, weight: 2 },
    ...(section.buyerQuestion ? [{ prefix: `${labels.buyerQuestion}: `, value: section.buyerQuestion, minimum: 30, weight: 2 }] : []),
    { value: section.body, minimum: 72, weight: 4 },
    ...(section.evidence ? [{ prefix: `${labels.evidence}: `, value: section.evidence, minimum: 32, weight: 2 }] : []),
  ], maximumCharacters));
}

export function localizedSeoKeywords(listing: LocalizedCreativeListing | undefined, maximum = 10) {
  return cleanList(listing?.keywords, maximum);
}
