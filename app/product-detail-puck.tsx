"use client";
/* eslint-disable @next/next/no-img-element -- Puck blocks accept object/data URLs from the image studio */

import { Puck, Render, type Config, type Data } from "@puckeditor/core";
import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { customerCopyQualityIssue, safeCustomerCopy } from "../lib/customer-copy-quality";
import type { ProductStudioResult } from "./product-studio-types";

type DetailComponents = {
  HeroBlock: {
    eyebrow: string;
    title: string;
    description: string;
    cta: string;
    imageUrl: string;
    primary: string;
    accent: string;
    surface: string;
  };
  BenefitBlock: {
    eyebrow: string;
    title: string;
    body: string;
    point1: string;
    point2: string;
    point3: string;
    accent: string;
  };
  ImageStoryBlock: {
    eyebrow: string;
    title: string;
    body: string;
    points: string;
    imageUrl: string;
    imageAlt: string;
    reverse: boolean;
    primary: string;
    accent: string;
    surface: string;
  };
  StoryBlock: {
    eyebrow: string;
    title: string;
    body: string;
    points: string;
    tone: "light" | "dark" | "accent";
    primary: string;
    accent: string;
  };
  CtaBlock: {
    title: string;
    description: string;
    button: string;
    primary: string;
    accent: string;
  };
};

export type ProductDetailData = Data<DetailComponents>;

const detailConfig: Config<DetailComponents> = {
  categories: {
    story: { title: "상세페이지 블록", components: ["HeroBlock", "BenefitBlock", "ImageStoryBlock", "StoryBlock", "CtaBlock"], defaultExpanded: true },
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
        primary: { type: "text", label: "주 색상" },
        accent: { type: "text", label: "강조 색상" },
        surface: { type: "text", label: "배경 색상" },
      },
      defaultProps: { eyebrow: "NEW PRODUCT", title: "제품의 핵심 가치를 한 문장으로", description: "짧고 명확한 제품 설명", cta: "상품 확인하기", imageUrl: "", primary: "#25352d", accent: "#d9eeae", surface: "#f4f1e9" },
      render: ({ eyebrow, title, description, cta, imageUrl, primary, accent, surface }) => (
        <section className="pdp-hero-block" style={{ "--pdp-primary": primary, "--pdp-accent": accent, "--pdp-surface": surface } as React.CSSProperties}>
          <div className="pdp-hero-copy"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p><span className="pdp-visual-cta">{cta}</span></div>
          <div className="pdp-hero-visual">{imageUrl ? <img src={imageUrl} alt="상품 대표 이미지" /> : <span>PRODUCT IMAGE</span>}<i /></div>
        </section>
      ),
    },
    BenefitBlock: {
      label: "핵심 장점 3개",
      fields: {
        eyebrow: { type: "text", label: "상단 문구" }, title: { type: "text", label: "제목" }, body: { type: "textarea", label: "설명" },
        point1: { type: "text", label: "장점 1" }, point2: { type: "text", label: "장점 2" }, point3: { type: "text", label: "장점 3" }, accent: { type: "text", label: "강조 색상" },
      },
      defaultProps: { eyebrow: "KEY BENEFITS", title: "세 가지 핵심 장점", body: "구매 이유를 빠르게 이해할 수 있도록 정리합니다.", point1: "첫 번째 장점", point2: "두 번째 장점", point3: "세 번째 장점", accent: "#d9eeae" },
      render: ({ eyebrow, title, body, point1, point2, point3, accent }) => (
        <section className="pdp-benefit-block" style={{ "--pdp-accent": accent } as React.CSSProperties}><span>{eyebrow}</span><h2>{title}</h2><p>{body}</p><div>{[point1, point2, point3].map((point, index) => <article key={`${point}-${index}`}><em>0{index + 1}</em><b>{point}</b></article>)}</div></section>
      ),
    },
    ImageStoryBlock: {
      label: "이미지 · 구매 근거",
      fields: {
        eyebrow: { type: "text", label: "상단 문구" }, title: { type: "textarea", label: "제목" }, body: { type: "textarea", label: "설명" }, points: { type: "textarea", label: "확인 포인트 (줄바꿈)" },
        imageUrl: { type: "text", label: "상세 이미지 URL" }, imageAlt: { type: "text", label: "이미지 설명" }, reverse: { type: "radio", label: "배치", options: [{ label: "이미지 왼쪽", value: false }, { label: "이미지 오른쪽", value: true }] },
        primary: { type: "text", label: "주 색상" }, accent: { type: "text", label: "강조 색상" }, surface: { type: "text", label: "배경 색상" },
      },
      defaultProps: { eyebrow: "WHY IT WORKS", title: "보이는 특징을 구체적으로", body: "구매 판단에 필요한 근거를 이미지와 함께 설명합니다.", points: "확인 포인트 1\n확인 포인트 2", imageUrl: "", imageAlt: "상품 특징 이미지", reverse: false, primary: "#25352d", accent: "#d9eeae", surface: "#f4f1e9" },
      render: ({ eyebrow, title, body, points, imageUrl, imageAlt, reverse, primary, accent, surface }) => (
        <section className={`pdp-image-story ${reverse ? "reverse" : ""}`} style={{ "--pdp-primary": primary, "--pdp-accent": accent, "--pdp-surface": surface } as React.CSSProperties}>
          <div className="pdp-image-story-visual">{imageUrl ? <img src={imageUrl} alt={imageAlt} /> : <span>DETAIL IMAGE</span>}<i /></div>
          <div className="pdp-image-story-copy"><span>{eyebrow}</span><h2>{title}</h2><p>{body}</p><ul>{points.split("\n").filter(Boolean).map((point) => <li key={point}><CheckMark />{point}</li>)}</ul></div>
        </section>
      ),
    },
    StoryBlock: {
      label: "스토리 · 정보",
      fields: {
        eyebrow: { type: "text", label: "상단 문구" }, title: { type: "text", label: "제목" }, body: { type: "textarea", label: "설명" }, points: { type: "textarea", label: "목록 (줄바꿈)" },
        tone: { type: "radio", label: "배경", options: [{ label: "밝게", value: "light" }, { label: "어둡게", value: "dark" }, { label: "강조", value: "accent" }] },
        primary: { type: "text", label: "주 색상" }, accent: { type: "text", label: "강조 색상" },
      },
      defaultProps: { eyebrow: "PRODUCT STORY", title: "제품 이야기", body: "제품을 선택해야 하는 맥락을 설명합니다.", points: "핵심 정보 1\n핵심 정보 2\n핵심 정보 3", tone: "light", primary: "#25352d", accent: "#d9eeae" },
      render: ({ eyebrow, title, body, points, tone, primary, accent }) => (
        <section className={`pdp-story-block ${tone}`} style={{ "--pdp-primary": primary, "--pdp-accent": accent } as React.CSSProperties}><div><span>{eyebrow}</span><h2>{title}</h2><p>{body}</p></div><ul>{points.split("\n").filter(Boolean).map((point) => <li key={point}>{point}</li>)}</ul></section>
      ),
    },
    CtaBlock: {
      label: "구매 유도",
      fields: { title: { type: "text", label: "제목" }, description: { type: "textarea", label: "설명" }, button: { type: "text", label: "버튼" }, primary: { type: "text", label: "주 색상" }, accent: { type: "text", label: "강조 색상" } },
      defaultProps: { title: "오늘부터 시작해 보세요", description: "상품 정보를 확인하고 나에게 맞는 옵션을 선택하세요.", button: "상품 확인하기", primary: "#25352d", accent: "#d9eeae" },
      render: ({ title, description, button, primary, accent }) => (
        <section className="pdp-cta-block" style={{ "--pdp-primary": primary, "--pdp-accent": accent } as React.CSSProperties}><span>READY TO START?</span><h2>{title}</h2><p>{description}</p><span className="pdp-visual-cta">{button}</span></section>
      ),
    },
  },
};

function CheckMark() {
  return <span aria-hidden="true">✓</span>;
}

function createDetailData(result: ProductStudioResult, imageUrl: string, assetUrls: Record<string, string>): ProductDetailData {
  const { product, design } = result;
  const safeProductName = safeCustomerCopy(product.name, "상품 정보");
  const safeOneLine = safeCustomerCopy(product.oneLine, `${safeProductName}의 주요 정보를 확인해 보세요.`);
  const safeSections = design.sections.filter((section) => !customerCopyQualityIssue({
    eyebrow: section.eyebrow,
    title: section.title,
    body: section.body,
    points: section.points,
  }));
  const first = safeSections[0];
  const imageAssets = ["detail-overview", "detail-feature", "detail-use", "detail-package"];
  return {
    root: {},
    content: [
      { type: "HeroBlock", props: { id: "ai-hero", eyebrow: safeCustomerCopy(product.category, "PRODUCT").toUpperCase(), title: safeCustomerCopy(design.heroCopy, safeProductName), description: safeCustomerCopy(design.heroSubcopy, safeOneLine), cta: safeCustomerCopy(design.cta, "상품 정보 보기"), imageUrl, primary: design.palette.primary, accent: design.palette.accent, surface: design.palette.surface } },
      { type: "BenefitBlock", props: { id: "ai-benefits", eyebrow: first?.eyebrow ?? "KEY BENEFITS", title: first?.title ?? safeOneLine, body: first?.body ?? safeCustomerCopy(product.targetCustomer, safeOneLine), point1: safeCustomerCopy(product.features[0], "상품 구성 확인"), point2: safeCustomerCopy(product.features[1], "사용 방법 확인"), point3: safeCustomerCopy(product.features[2], "규격과 옵션 확인"), accent: design.palette.accent } },
      ...safeSections.slice(1).map((section, index) => {
        const assetId = imageAssets[index];
        const sectionImage = assetId ? assetUrls[assetId] : "";
        return sectionImage ? {
          type: "ImageStoryBlock" as const,
          props: { id: `ai-image-section-${index}`, eyebrow: section.eyebrow, title: section.title, body: section.body, points: section.points.join("\n"), imageUrl: sectionImage, imageAlt: `${safeProductName} ${section.title}`, reverse: index % 2 === 1, primary: design.palette.primary, accent: design.palette.accent, surface: design.palette.surface },
        } : {
          type: "StoryBlock" as const,
          props: { id: `ai-section-${index}`, eyebrow: section.eyebrow, title: section.title, body: section.body, points: section.points.join("\n"), tone: (section.type === "proof" ? "dark" : section.type === "caution" ? "accent" : "light") as "light" | "dark" | "accent", primary: design.palette.primary, accent: design.palette.accent },
        };
      }),
      { type: "CtaBlock", props: { id: "ai-cta", title: safeOneLine, description: `${safeProductName}의 구성과 주의사항을 확인하고 알맞은 옵션을 선택하세요.`, button: safeCustomerCopy(design.cta, "상품 정보 보기"), primary: design.palette.primary, accent: design.palette.accent } },
    ],
  };
}

export function ProductDetailRender({ result, imageUrl, assetUrls = {}, data }: { result: ProductStudioResult; imageUrl: string; assetUrls?: Record<string, string>; data: ProductDetailData | null }) {
  const renderData = useMemo(() => data ?? createDetailData(result, imageUrl, assetUrls), [assetUrls, data, imageUrl, result]);
  return <Render config={detailConfig} data={renderData} />;
}

export function ProductDetailEditor({ result, imageUrl, assetUrls = {}, data, onSave, onClose }: { result: ProductStudioResult; imageUrl: string; assetUrls?: Record<string, string>; data: ProductDetailData | null; onSave: (next: ProductDetailData) => void; onClose: () => void }) {
  const initialData = useMemo(() => data ?? createDetailData(result, imageUrl, assetUrls), [assetUrls, data, imageUrl, result]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="puck-editor-modal" role="dialog" aria-modal="true" aria-label="상세페이지 시각 편집기">
      <div className="puck-editor-top"><span><b>Puck 상세페이지 편집기</b><small>블록을 드래그하고 오른쪽 속성에서 문구·색상을 수정하세요.</small></span><button type="button" aria-label="편집기 닫기" onClick={onClose}><X size={18} /></button></div>
      <div className="puck-editor-body"><Puck config={detailConfig} data={initialData} onPublish={(next) => { onSave(next); onClose(); }} /></div>
    </div>
  );
}
