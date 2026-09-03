"use client";
/* eslint-disable @next/next/no-img-element -- Puck blocks accept object/data URLs from the image studio */

import { Puck, Render, usePuck, type Config, type Data, type Viewports } from "@puckeditor/core";
import { Save, X } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  localizedProductDetailImageRoles,
  productDetailRoleFromAssetReference,
} from "../lib/product-detail-image-manifest";
import { productDetailHealthFunctionalStatus } from "../lib/product-detail-classification";
import { validateDetailAnimatedGif } from "../lib/product-media-contract";
import { resolveProductDetailAssets } from "./_publishing/product-detail-persistence";
import mediaStyles from "./product-detail-media.module.css";
import type { DetailLayout, DetailMotion, DetailSection, ProductStudioResult } from "./product-studio-types";
import { useModalInteraction } from "./use-modal-interaction";

type VerificationStatus = "verified" | "needs-review";
type DetailSectionType = DetailSection["type"];

const detailSectionTypeOptions: Array<{ label: string; value: DetailSectionType }> = [
  { label: "핵심 효익", value: "benefit" },
  { label: "브랜드 스토리", value: "story" },
  { label: "사용·활용", value: "howto" },
  { label: "확인 근거", value: "proof" },
  { label: "규격·수치", value: "spec" },
  { label: "주의·제외", value: "caution" },
  { label: "선택 비교", value: "comparison" },
  { label: "자주 묻는 질문", value: "faq" },
  { label: "필수 안내", value: "notice" },
];

const detailSectionTypeLabels = Object.fromEntries(
  detailSectionTypeOptions.map((option) => [option.value, option.label]),
) as Record<DetailSectionType, string>;

const verificationStatusOptions: Array<{ label: string; value: VerificationStatus }> = [
  { label: "자료 확인", value: "verified" },
  { label: "추가 확인 필요", value: "needs-review" },
];

const detailImageAssets = [
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

const evidenceDetailImageAssets = new Set([
  "detail-feature",
  "detail-package",
  "detail-material",
  "detail-dimensions",
  "detail-contents",
  "detail-care",
]);

type DetailComponents = {
  HeroBlock: {
    eyebrow: string;
    title: string;
    description: string;
    cta: string;
    imageUrl: string;
    imageAlt: string;
    primary: string;
    accent: string;
    surface: string;
    layout: "split" | "centered" | "editorial";
  };
  VerificationRibbonBlock: {
    classification: string;
    verificationStatus: VerificationStatus;
    evidence: string;
    healthFunctionalStatus: string;
    targetCustomer: string;
    primary: string;
    accent: string;
    surface: string;
  };
  BenefitBlock: {
    sectionType: DetailSectionType;
    eyebrow: string;
    title: string;
    body: string;
    point1: string;
    point2: string;
    point3: string;
    point4: string;
    point5: string;
    point6: string;
    buyerQuestion: string;
    evidence: string;
    verificationStatus: VerificationStatus;
    accent: string;
    motion: DetailMotion;
  };
  ImageStoryBlock: {
    sectionType: DetailSectionType;
    eyebrow: string;
    title: string;
    body: string;
    points: string;
    imageUrl: string;
    imageRole: string;
    imageAlt: string;
    imageFit: "cover" | "contain";
    reverse: boolean;
    primary: string;
    accent: string;
    surface: string;
    layout: DetailLayout;
    motion: DetailMotion;
    buyerQuestion: string;
    evidence: string;
    verificationStatus: VerificationStatus;
  };
  AnimatedGifBlock: {
    gifUrl: string;
    posterUrl: string;
    alt: string;
    caption: string;
    tone: "light" | "dark";
  };
  StoryBlock: {
    sectionType: DetailSectionType;
    eyebrow: string;
    title: string;
    body: string;
    points: string;
    tone: "light" | "dark" | "accent";
    primary: string;
    accent: string;
    layout: DetailLayout;
    motion: DetailMotion;
    buyerQuestion: string;
    evidence: string;
    verificationStatus: VerificationStatus;
  };
  CtaBlock: {
    audience: string;
    title: string;
    description: string;
    checklist: string;
    button: string;
    primary: string;
    accent: string;
  };
};

export type ProductDetailData = Data<DetailComponents>;
export type ProductDetailSource = Pick<ProductStudioResult, "product" | "design">
  & Partial<Pick<ProductStudioResult, "localizedListings">>;

export type ProductDetailImageLoadState = "loaded" | "error";

const noopProductDetailImageLoadReport = () => undefined;
const ProductDetailImageLoadContext = createContext<{
  report: (role: string, state: ProductDetailImageLoadState) => void;
}>({ report: noopProductDetailImageLoadReport });

const productDetailEditorViewports: Viewports = [
  { width: "100%", height: "auto", label: "현재 화면", icon: "Monitor" },
  { width: 360, height: "auto", label: "모바일", icon: "Smartphone" },
  { width: 768, height: "auto", label: "태블릿", icon: "Tablet" },
  { width: 1280, height: "auto", label: "데스크톱", icon: "Monitor" },
];

const detailConfig: Config<DetailComponents> = {
  categories: {
    story: { title: "상세페이지 블록", components: ["HeroBlock", "VerificationRibbonBlock", "BenefitBlock", "ImageStoryBlock", "AnimatedGifBlock", "StoryBlock", "CtaBlock"], defaultExpanded: true },
  },
  components: {
    HeroBlock: {
      label: "히어로",
      fields: {
        eyebrow: { type: "text", label: "상단 문구" },
        title: { type: "textarea", label: "메인 카피" },
        description: { type: "textarea", label: "보조 문구" },
        cta: { type: "text", label: "버튼" },
        imageUrl: { type: "text", label: "대표 이미지 URL" },
        imageAlt: { type: "text", label: "대표 이미지 설명" },
        primary: { type: "text", label: "주 색상" },
        accent: { type: "text", label: "강조 색상" },
        surface: { type: "text", label: "배경 색상" },
        layout: { type: "radio", label: "히어로 배치", options: [{ label: "분할", value: "split" }, { label: "중앙", value: "centered" }, { label: "에디토리얼", value: "editorial" }] },
      },
      defaultProps: { eyebrow: "NEW PRODUCT", title: "제품의 핵심 가치를 한 문장으로", description: "짧고 명확한 제품 설명", cta: "상품 확인하기", imageUrl: "", imageAlt: "상품 대표 이미지", primary: "#25352d", accent: "#d9eeae", surface: "#f4f1e9", layout: "split" },
      render: ({ eyebrow, title, description, cta, imageUrl, imageAlt, primary, accent, surface, layout }) => (
        <section className={`pdp-hero-block ${layout}`} data-motion="reveal" style={{ "--pdp-primary": primary, "--pdp-accent": accent, "--pdp-surface": surface } as React.CSSProperties}>
          <div className="pdp-hero-copy"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p><span className="pdp-visual-cta">{cta}</span></div>
          <div className="pdp-hero-visual">{imageUrl ? <img src={imageUrl} alt={imageAlt || "상품 대표 이미지"} /> : <span>PRODUCT IMAGE</span>}<i /></div>
        </section>
      ),
    },
    VerificationRibbonBlock: {
      label: "상품 분류 · 검증 리본",
      fields: {
        classification: { type: "text", label: "상품 분류" },
        verificationStatus: { type: "radio", label: "검증 상태", options: verificationStatusOptions },
        evidence: { type: "textarea", label: "분류 근거" },
        healthFunctionalStatus: { type: "text", label: "건강기능식품 여부" },
        targetCustomer: { type: "text", label: "추천 대상" },
        primary: { type: "text", label: "주 색상" },
        accent: { type: "text", label: "강조 색상" },
        surface: { type: "text", label: "배경 색상" },
      },
      defaultProps: {
        classification: "상품 유형 확인 필요",
        verificationStatus: "needs-review",
        evidence: "상품 라벨과 판매 자료에서 분류 정보를 확인해 주세요.",
        healthFunctionalStatus: "표시 여부 확인 필요",
        targetCustomer: "상품 정보를 꼼꼼히 비교하는 고객",
        primary: "#25352d",
        accent: "#d9eeae",
        surface: "#f4f1e9",
      },
      render: ({ classification, verificationStatus, evidence, healthFunctionalStatus, targetCustomer, primary, accent, surface }) => (
        <section
          className="pdp-verification-ribbon"
          aria-label="상품 분류와 확인 상태"
          style={{
            color: primary,
            background: `color-mix(in srgb, ${primary}, transparent 82%)`,
            borderBlock: `1px solid color-mix(in srgb, ${primary}, transparent 78%)`,
          }}
        >
          <VerificationCell label="상품 분류" value={classification} surface={surface} />
          {healthFunctionalStatus.trim() ? <VerificationCell label="건강기능식품 표시" value={healthFunctionalStatus} surface={surface} /> : null}
          <VerificationCell label="추천 대상" value={targetCustomer} surface={surface} />
          <VerificationCell
            label={verificationStatus === "verified" ? "자료 확인 완료" : "구매 전 추가 확인"}
            value={evidence}
            surface={verificationStatus === "verified" ? accent : `color-mix(in srgb, ${accent}, white 42%)`}
          />
        </section>
      ),
    },
    BenefitBlock: {
      label: "구매정보 카드",
      fields: {
        sectionType: { type: "select", label: "정보 유형", options: detailSectionTypeOptions },
        eyebrow: { type: "text", label: "상단 문구" }, title: { type: "text", label: "제목" }, body: { type: "textarea", label: "설명" },
        point1: { type: "text", label: "포인트 1" }, point2: { type: "text", label: "포인트 2" }, point3: { type: "text", label: "포인트 3" }, point4: { type: "text", label: "포인트 4" }, point5: { type: "text", label: "포인트 5" }, point6: { type: "text", label: "포인트 6" }, accent: { type: "text", label: "강조 색상" },
        buyerQuestion: { type: "textarea", label: "구매 전 질문" }, evidence: { type: "textarea", label: "확인 근거" },
        verificationStatus: { type: "radio", label: "검증 상태", options: verificationStatusOptions },
        motion: { type: "radio", label: "미리보기 모션", options: [{ label: "없음", value: "none" }, { label: "등장", value: "reveal" }, { label: "순차", value: "stagger" }] },
      },
      defaultProps: { sectionType: "benefit", eyebrow: "KEY FACTS", title: "구매 판단 포인트", body: "서로 다른 구매 정보를 빠르게 비교합니다.", point1: "첫 번째 정보", point2: "두 번째 정보", point3: "세 번째 정보", point4: "", point5: "", point6: "", buyerQuestion: "내 선택에 필요한 핵심 정보는 무엇인가요?", evidence: "상품 라벨과 등록 자료에서 확인한 정보", verificationStatus: "verified", accent: "#d9eeae", motion: "stagger" },
      render: ({ sectionType, eyebrow, title, body, point1, point2, point3, point4, point5, point6, buyerQuestion, evidence, verificationStatus, accent, motion }) => (
        <section className="pdp-benefit-block" data-motion={motion} data-section-type={sectionType} style={{ "--pdp-accent": accent } as React.CSSProperties}><SectionTypeBadge sectionType={sectionType} /><span>{eyebrow}</span><h2>{title}</h2><p>{body}</p><SectionEvidence buyerQuestion={buyerQuestion} evidence={evidence} verificationStatus={verificationStatus} /><div>{[point1, point2, point3, point4, point5, point6].filter(Boolean).map((point, index) => <article key={`${point}-${index}`} style={{ "--pdp-sequence": index } as React.CSSProperties}><em>{String(index + 1).padStart(2, "0")}</em><b>{point}</b></article>)}</div></section>
      ),
    },
    ImageStoryBlock: {
      label: "이미지 · 구매 근거",
      fields: {
        sectionType: { type: "select", label: "정보 유형", options: detailSectionTypeOptions },
        eyebrow: { type: "text", label: "상단 문구" }, title: { type: "textarea", label: "제목" }, body: { type: "textarea", label: "설명" }, points: { type: "textarea", label: "확인 포인트 (줄바꿈)" },
        imageUrl: { type: "text", label: "상세 이미지 URL" }, imageRole: { type: "text", label: "운영 이미지 역할 (자동)" }, imageAlt: { type: "text", label: "이미지 설명" }, imageFit: { type: "radio", label: "이미지 표시", options: [{ label: "장면 채우기", value: "cover" }, { label: "근거 전체 보기", value: "contain" }] }, reverse: { type: "radio", label: "배치", options: [{ label: "이미지 왼쪽", value: false }, { label: "이미지 오른쪽", value: true }] },
        primary: { type: "text", label: "주 색상" }, accent: { type: "text", label: "강조 색상" }, surface: { type: "text", label: "배경 색상" },
        layout: { type: "radio", label: "레이아웃", options: [{ label: "분할", value: "split" }, { label: "풀 블리드", value: "full-bleed" }, { label: "카드", value: "cards" }, { label: "단계", value: "steps" }, { label: "스펙", value: "spec-grid" }, { label: "에디토리얼", value: "editorial" }] },
        motion: { type: "radio", label: "미리보기 모션", options: [{ label: "없음", value: "none" }, { label: "등장", value: "reveal" }, { label: "순차", value: "stagger" }] },
        buyerQuestion: { type: "textarea", label: "구매 전 질문" }, evidence: { type: "textarea", label: "확인 근거" },
        verificationStatus: { type: "radio", label: "검증 상태", options: verificationStatusOptions },
      },
      defaultProps: { sectionType: "proof", eyebrow: "VISIBLE EVIDENCE", title: "보이는 특징을 구체적으로", body: "구매 판단에 필요한 근거를 이미지와 함께 설명합니다.", points: "확인 포인트 1\n확인 포인트 2", imageUrl: "", imageRole: "", imageAlt: "상품 특징 이미지", imageFit: "contain", reverse: false, primary: "#25352d", accent: "#d9eeae", surface: "#f4f1e9", layout: "split", motion: "reveal", buyerQuestion: "사진에서 실제로 확인할 수 있는 특징은 무엇인가요?", evidence: "업로드한 실물 사진과 상품 자료", verificationStatus: "verified" },
      render: (props) => <ImageStoryBlockRender {...props} />,
    },
    AnimatedGifBlock: {
      label: "상세페이지 GIF (채널 전송 제외)",
      fields: {
        gifUrl: { type: "text", label: "HTTPS GIF URL (.gif, 필수)" },
        posterUrl: { type: "text", label: "HTTPS 정적 poster URL (JPG/PNG/WebP/AVIF, 필수)" },
        alt: { type: "text", label: "대체텍스트 (필수)" },
        caption: { type: "textarea", label: "설명 캡션 (필수)" },
        tone: { type: "radio", label: "배경", options: [{ label: "밝게", value: "light" }, { label: "어둡게", value: "dark" }] },
      },
      defaultProps: {
        gifUrl: "",
        posterUrl: "",
        alt: "상품 사용 장면",
        caption: "상품의 동작과 사용 방식을 정적 이미지와 함께 확인하세요.",
        tone: "light",
      },
      render: (props) => <AnimatedGifMedia {...props} />,
    },
    StoryBlock: {
      label: "스토리 · 정보",
      fields: {
        sectionType: { type: "select", label: "정보 유형", options: detailSectionTypeOptions },
        eyebrow: { type: "text", label: "상단 문구" }, title: { type: "text", label: "제목" }, body: { type: "textarea", label: "설명" }, points: { type: "textarea", label: "목록 (줄바꿈)" },
        tone: { type: "radio", label: "배경", options: [{ label: "밝게", value: "light" }, { label: "어둡게", value: "dark" }, { label: "강조", value: "accent" }] },
        primary: { type: "text", label: "주 색상" }, accent: { type: "text", label: "강조 색상" },
        layout: { type: "radio", label: "레이아웃", options: [{ label: "분할", value: "split" }, { label: "풀 블리드", value: "full-bleed" }, { label: "카드", value: "cards" }, { label: "단계", value: "steps" }, { label: "스펙", value: "spec-grid" }, { label: "에디토리얼", value: "editorial" }] },
        motion: { type: "radio", label: "미리보기 모션", options: [{ label: "없음", value: "none" }, { label: "등장", value: "reveal" }, { label: "순차", value: "stagger" }] },
        buyerQuestion: { type: "textarea", label: "구매 전 질문" }, evidence: { type: "textarea", label: "확인 근거" },
        verificationStatus: { type: "radio", label: "검증 상태", options: verificationStatusOptions },
      },
      defaultProps: { sectionType: "proof", eyebrow: "PRODUCT DETAIL", title: "구매 질문에 답하는 정보", body: "앞 섹션과 겹치지 않는 새로운 판단 정보를 설명합니다.", points: "핵심 정보 1\n핵심 정보 2\n핵심 정보 3", tone: "light", primary: "#25352d", accent: "#d9eeae", layout: "editorial", motion: "none", buyerQuestion: "구매 전에 무엇을 확인해야 하나요?", evidence: "상품 라벨과 등록 자료", verificationStatus: "verified" },
      render: ({ sectionType, eyebrow, title, body, points, tone, primary, accent, layout, motion, buyerQuestion, evidence, verificationStatus }) => (
        <section className={`pdp-story-block ${tone} ${layout}`} data-motion={motion} data-section-type={sectionType} style={{ "--pdp-primary": primary, "--pdp-accent": accent } as React.CSSProperties}><div><SectionTypeBadge sectionType={sectionType} /><span>{eyebrow}</span><h2>{title}</h2><p>{body}</p><SectionEvidence buyerQuestion={buyerQuestion} evidence={evidence} verificationStatus={verificationStatus} /></div><ul>{points.split("\n").filter(Boolean).map((point, index) => <li key={point} style={{ "--pdp-sequence": index } as React.CSSProperties}>{point}</li>)}</ul></section>
      ),
    },
    CtaBlock: {
      label: "구매 유도",
      fields: { audience: { type: "text", label: "추천 대상" }, title: { type: "text", label: "제목" }, description: { type: "textarea", label: "설명" }, checklist: { type: "textarea", label: "마지막 확인사항" }, button: { type: "text", label: "버튼" }, primary: { type: "text", label: "주 색상" }, accent: { type: "text", label: "강조 색상" } },
      defaultProps: { audience: "이 상품의 핵심 정보를 비교한 고객", title: "확인한 기준으로 선택하세요", description: "상품 정보를 확인하고 나에게 맞는 옵션을 선택하세요.", checklist: "분류 · 구성 · 규격 · 주의사항을 마지막으로 확인하세요.", button: "상품 정보 확인하기", primary: "#25352d", accent: "#d9eeae" },
      render: ({ audience, title, description, checklist, button, primary, accent }) => (
        <section className="pdp-cta-block" style={{ "--pdp-primary": primary, "--pdp-accent": accent } as React.CSSProperties}><span>FOR {audience}</span><h2>{title}</h2><p>{description}</p><p className="pdp-cta-checklist">{checklist}</p><span className="pdp-visual-cta">{button}</span></section>
      ),
    },
  },
};

function CheckMark() {
  return <span aria-hidden="true">✓</span>;
}

function ImageStoryBlockRender({ sectionType, eyebrow, title, body, points, imageUrl, imageRole, imageAlt, imageFit, reverse, primary, accent, surface, layout, motion, buyerQuestion, evidence, verificationStatus }: DetailComponents["ImageStoryBlock"]) {
  const loadContext = useContext(ProductDetailImageLoadContext);
  const role = imageRole || productDetailRoleFromAssetReference(imageUrl) || "";
  return (
    <section className={`pdp-image-story ${layout} ${reverse ? "reverse" : ""}`} data-motion={motion} data-section-type={sectionType} data-sellerpilot-detail-role={role || undefined} style={{ "--pdp-primary": primary, "--pdp-accent": accent, "--pdp-surface": surface } as React.CSSProperties}>
      <div className={`pdp-image-story-visual ${imageFit === "contain" ? "contain" : "cover"}`}>{imageUrl ? <img src={imageUrl} alt={imageAlt} loading="eager" decoding="async" data-sellerpilot-detail-image-role={role || undefined} onLoad={() => loadContext.report(role, "loaded")} onError={() => loadContext.report(role, "error")} /> : <span>DETAIL IMAGE</span>}<i /></div>
      <div className="pdp-image-story-copy"><SectionTypeBadge sectionType={sectionType} /><span>{eyebrow}</span><h2>{title}</h2><p>{body}</p><SectionEvidence buyerQuestion={buyerQuestion} evidence={evidence} verificationStatus={verificationStatus} /><ul>{points.split("\n").filter(Boolean).map((point, index) => <li key={`${point}-${index}`} style={{ "--pdp-sequence": index } as React.CSSProperties}><CheckMark />{point}</li>)}</ul></div>
    </section>
  );
}

function useAllowsDetailAnimation() {
  const [allowsAnimation, setAllowsAnimation] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setAllowsAnimation(!preference.matches);
    updatePreference();
    if (typeof preference.addEventListener === "function") {
      preference.addEventListener("change", updatePreference);
      return () => preference.removeEventListener("change", updatePreference);
    }
    preference.addListener(updatePreference);
    return () => preference.removeListener(updatePreference);
  }, []);
  return allowsAnimation;
}

function AnimatedGifMedia({ gifUrl, posterUrl, alt, caption, tone }: DetailComponents["AnimatedGifBlock"]) {
  const media = useMemo(
    () => validateDetailAnimatedGif({ gifUrl, posterUrl, alt, caption }),
    [alt, caption, gifUrl, posterUrl],
  );
  const allowsAnimation = useAllowsDetailAnimation();
  const [failedGifUrl, setFailedGifUrl] = useState("");
  const [failedPosterUrl, setFailedPosterUrl] = useState("");
  const gifFailed = Boolean(media.gifUrl && failedGifUrl === media.gifUrl);
  const posterFailed = Boolean(media.posterUrl && failedPosterUrl === media.posterUrl);
  const showAnimation = media.canAnimate && allowsAnimation && !gifFailed;
  const showPoster = Boolean(media.posterUrl) && !posterFailed;
  const mediaState = showAnimation
    ? "animated"
    : !showPoster
      ? "poster-unavailable"
      : media.canAnimate && !allowsAnimation
        ? "reduced-motion"
        : gifFailed
          ? "gif-load-failed"
          : "validation-failed";
  const status = mediaState === "animated"
    ? "상세페이지에서만 재생됩니다. 판매채널 이미지 전송과는 별도입니다."
    : mediaState === "reduced-motion"
      ? "동작 줄이기 설정에 따라 정적 poster로 표시합니다."
      : mediaState === "gif-load-failed"
        ? "GIF를 불러오지 못해 정적 poster로 표시합니다."
        : mediaState === "poster-unavailable"
          ? "유효한 HTTPS 정적 poster URL이 필요합니다."
          : "GIF URL·poster·대체텍스트·캡션을 확인해 정적 poster로 표시합니다.";

  return (
    <figure className={`${mediaStyles.mediaBlock} ${tone === "dark" ? mediaStyles.dark : ""}`} data-media-state={mediaState}>
      <div className={mediaStyles.stage}>
        {showAnimation && media.gifUrl ? (
          <img className={mediaStyles.image} src={media.gifUrl} alt={media.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedGifUrl(media.gifUrl ?? "")} />
        ) : showPoster && media.posterUrl ? (
          <img className={mediaStyles.image} src={media.posterUrl} alt={media.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedPosterUrl(media.posterUrl ?? "")} />
        ) : (
          <span className={mediaStyles.placeholder} role="img" aria-label={media.alt}>정적 poster URL을 확인해 주세요.</span>
        )}
        <span className={mediaStyles.modeBadge}>{showAnimation ? "ANIMATED GIF" : "STATIC POSTER"}</span>
      </div>
      <figcaption className={mediaStyles.copy}>
        <span>DETAIL MOTION</span>
        <h2>{media.caption || "상품 동작 안내"}</h2>
        <p>{media.alt}</p>
        <small>{status}</small>
      </figcaption>
    </figure>
  );
}

function VerificationCell({ label, value, surface }: { label: string; value: string; surface: string }) {
  return <span className="pdp-verification-cell" style={{ background: surface }}><small>{label}</small><b>{value}</b></span>;
}

function SectionTypeBadge({ sectionType }: { sectionType: DetailSectionType }) {
  return <em className="pdp-section-type">{detailSectionTypeLabels[sectionType] ?? "상품 정보"}</em>;
}

function SectionEvidence({ buyerQuestion, evidence, verificationStatus }: { buyerQuestion: string; evidence: string; verificationStatus: VerificationStatus }) {
  if (!buyerQuestion && !evidence) return null;
  return (
    <aside className="pdp-section-evidence" aria-label="구매 질문과 확인 근거">
      <span><small>{verificationStatus === "verified" ? "자료 확인" : "확인 필요"}</small></span>
      {buyerQuestion && <span><small>구매 전 질문</small><b>{buyerQuestion}</b></span>}
      {evidence && <span><small>{verificationStatus === "verified" ? "확인 근거" : "추가 확인할 근거"}</small><b>{evidence}</b></span>}
    </aside>
  );
}

export function createDetailData(result: ProductDetailSource, imageUrl: string, assetUrls: Record<string, string>): ProductDetailData {
  const { product, design } = result;
  const classification = product.classification ?? {
    displayName: "상품 유형 확인 필요",
    verificationStatus: "needs-review" as const,
    evidence: "상품 라벨과 판매 자료에서 분류 정보를 확인해 주세요.",
    isHealthFunctionalFood: null,
  };
  const verificationStatus = classification.verificationStatus;
  const selectedDetailRoles = new Set(localizedProductDetailImageRoles(result.localizedListings));
  const designArchetype = design.creativeStrategy?.designArchetype ?? "proof-led";
  const heroLayout = designArchetype === "gift-story"
    ? "centered"
    : ["proof-led", "spec-first", "comparison-led"].includes(designArchetype)
      ? "editorial"
      : "split";
  return {
    root: {},
    content: [
      { type: "HeroBlock", props: { id: "ai-hero", eyebrow: product.category.toUpperCase(), title: design.heroCopy, description: design.heroSubcopy, cta: design.cta, imageUrl, imageAlt: `${product.name} 대표 이미지`, primary: design.palette.primary, accent: design.palette.accent, surface: design.palette.surface, layout: heroLayout } },
      { type: "VerificationRibbonBlock", props: { id: "ai-verification", classification: classification.displayName, verificationStatus, evidence: classification.evidence, healthFunctionalStatus: productDetailHealthFunctionalStatus({ name: product.name, category: product.category, classification }), targetCustomer: product.targetCustomer, primary: design.palette.primary, accent: design.palette.accent, surface: design.palette.surface } },
      ...design.sections.map((section, index) => {
        const sectionLayout = section.layout ?? (index === 0 ? "cards" : index % 3 === 0 ? "editorial" : "split");
        const sectionMotion = section.motion ?? "none";
        const sectionAsset = section.imageAsset ?? detailImageAssets[index] ?? "none";
        const sectionImage = sectionAsset === "none" || !selectedDetailRoles.has(sectionAsset) ? "" : assetUrls[sectionAsset];
        const sectionImageFit: "contain" | "cover" = evidenceDetailImageAssets.has(sectionAsset) ? "contain" : "cover";
        const sectionVerificationStatus: VerificationStatus = verificationStatus === "needs-review" || /(미확인|확인 필요|추가 확인|근거 없음|제공되지 않)/.test(section.evidence ?? "") ? "needs-review" : "verified";
        return sectionImage ? {
          type: "ImageStoryBlock" as const,
          props: { id: `ai-image-section-${index}`, sectionType: section.type, eyebrow: section.eyebrow, title: section.title, body: section.body, points: section.points.join("\n"), imageUrl: sectionImage, imageRole: sectionAsset, imageAlt: `${product.name} ${section.title}`, imageFit: sectionImageFit, reverse: index % 2 === 1, primary: design.palette.primary, accent: design.palette.accent, surface: design.palette.surface, layout: sectionLayout, motion: sectionMotion, buyerQuestion: section.buyerQuestion, evidence: section.evidence, verificationStatus: sectionVerificationStatus },
        } : sectionLayout === "cards" ? {
          type: "BenefitBlock" as const,
          props: { id: `ai-card-section-${index}`, sectionType: section.type, eyebrow: section.eyebrow, title: section.title, body: section.body, point1: section.points[0] ?? "", point2: section.points[1] ?? "", point3: section.points[2] ?? "", point4: section.points[3] ?? "", point5: section.points[4] ?? "", point6: section.points[5] ?? "", buyerQuestion: section.buyerQuestion, evidence: section.evidence, verificationStatus: sectionVerificationStatus, accent: design.palette.accent, motion: sectionMotion },
        } : {
          type: "StoryBlock" as const,
          props: { id: `ai-section-${index}`, sectionType: section.type, eyebrow: section.eyebrow, title: section.title, body: section.body, points: section.points.join("\n"), tone: (["proof", "comparison"].includes(section.type) ? "dark" : ["caution", "notice"].includes(section.type) ? "accent" : "light") as "light" | "dark" | "accent", primary: design.palette.primary, accent: design.palette.accent, layout: sectionLayout, motion: sectionMotion, buyerQuestion: section.buyerQuestion, evidence: section.evidence, verificationStatus: sectionVerificationStatus },
        };
      }),
      { type: "CtaBlock", props: { id: "ai-cta", audience: product.targetCustomer ?? "상품 정보를 확인한 고객", title: `${product.name}, 나에게 맞는 선택인지 확인하세요`, description: `${product.oneLine} ${classification.displayName} 분류와 실제 구성, 규격, 주의사항을 함께 확인한 뒤 선택해 주세요.`, checklist: [...(product.features ?? []).slice(0, 2), ...(product.cautions ?? []).slice(0, 1)].join(" · ") || "분류 · 구성 · 규격 · 주의사항을 마지막으로 확인하세요.", button: design.cta || `${product.name} 상품 정보 확인`, primary: design.palette.primary, accent: design.palette.accent } },
    ],
  };
}

export function ProductDetailRender({ result, imageUrl, assetUrls = {}, data, onDetailImageLoadState }: { result: ProductDetailSource | null; imageUrl: string; assetUrls?: Record<string, string>; data: ProductDetailData | null; onDetailImageLoadState?: (role: string, state: ProductDetailImageLoadState) => void }) {
  const renderData = useMemo(() => {
    if (data) return resolveProductDetailAssets(data, assetUrls);
    return result ? createDetailData(result, imageUrl, assetUrls) : null;
  }, [assetUrls, data, imageUrl, result]);
  const imageLoadContext = useMemo(
    () => ({ report: onDetailImageLoadState ?? noopProductDetailImageLoadReport }),
    [onDetailImageLoadState],
  );
  if (!renderData) return null;
  return <ProductDetailImageLoadContext.Provider value={imageLoadContext}><Render config={detailConfig} data={renderData} /></ProductDetailImageLoadContext.Provider>;
}

function ProductDetailPublishAction({ saving, onSave }: { saving: boolean; onSave: (next: ProductDetailData) => void | Promise<void> }) {
  const { appState } = usePuck<typeof detailConfig>();
  return (
    <button
      type="button"
      className="puck-editor-publish-action"
      disabled={saving}
      onClick={() => {
        if (!saving) void onSave(appState.data as ProductDetailData);
      }}
    >
      <Save size={16} aria-hidden="true" />
      {saving ? "저장 중" : "상세페이지 저장"}
    </button>
  );
}

export function ProductDetailEditor({ result, imageUrl, assetUrls = {}, data, saving = false, onSave, onClose }: { result: ProductDetailSource | null; imageUrl: string; assetUrls?: Record<string, string>; data: ProductDetailData | null; saving?: boolean; onSave: (next: ProductDetailData) => void | Promise<void>; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const initialData = useMemo(() => data ? resolveProductDetailAssets(data, assetUrls) : result ? createDetailData(result, imageUrl, assetUrls) : null, [assetUrls, data, imageUrl, result]);
  useModalInteraction(Boolean(initialData), dialogRef, onClose, { dismissible: !saving, initialFocusRef: closeButtonRef });

  if (!initialData) return null;
  return (
    <div ref={dialogRef} tabIndex={-1} className="puck-editor-modal" role="dialog" aria-modal="true" aria-label="상세페이지 시각 편집기">
      <div className="puck-editor-top"><span><b>Puck 상세페이지 편집기</b><small>{saving ? "운영 원장에 저장 중입니다." : "블록을 드래그하고 오른쪽 속성에서 문구·색상을 수정하세요."}</small></span><button ref={closeButtonRef} type="button" aria-label="편집기 닫기" disabled={saving} onClick={onClose}><X size={18} /></button></div>
      <div className="puck-editor-body" aria-busy={saving} aria-disabled={saving || undefined} inert={saving || undefined}>
        <Puck
          config={detailConfig}
          data={initialData}
          viewports={productDetailEditorViewports}
          overrides={{ headerActions: () => <ProductDetailPublishAction saving={saving} onSave={onSave} /> }}
          onPublish={(next) => { if (!saving) void onSave(next); }}
        />
      </div>
    </div>
  );
}

export { fetchProductDetailData, productDetailDataToHtml, saveProductDetailData } from "./_publishing/product-detail-html";
