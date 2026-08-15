"use client";
/* eslint-disable @next/next/no-img-element -- Puck blocks accept object/data URLs from the image studio */

import { Puck, Render, type Config, type Data } from "@puckeditor/core";
import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
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
    story: { title: "상세페이지 블록", components: ["HeroBlock", "BenefitBlock", "StoryBlock", "CtaBlock"], defaultExpanded: true },
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
          <div className="pdp-hero-copy"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p><button>{cta}</button></div>
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
        <section className="pdp-cta-block" style={{ "--pdp-primary": primary, "--pdp-accent": accent } as React.CSSProperties}><span>READY TO START?</span><h2>{title}</h2><p>{description}</p><button>{button}</button></section>
      ),
    },
  },
};

function createDetailData(result: ProductStudioResult, imageUrl: string): ProductDetailData {
  const { product, design } = result;
  const first = design.sections[0];
  return {
    root: {},
    content: [
      { type: "HeroBlock", props: { id: "ai-hero", eyebrow: product.category.toUpperCase(), title: design.heroCopy, description: design.heroSubcopy, cta: design.cta, imageUrl, primary: design.palette.primary, accent: design.palette.accent, surface: design.palette.surface } },
      { type: "BenefitBlock", props: { id: "ai-benefits", eyebrow: first?.eyebrow ?? "KEY BENEFITS", title: first?.title ?? product.oneLine, body: first?.body ?? product.targetCustomer, point1: product.features[0] ?? "핵심 장점", point2: product.features[1] ?? "편리한 사용", point3: product.features[2] ?? "선명한 구성", accent: design.palette.accent } },
      ...design.sections.slice(1).map((section, index) => ({ type: "StoryBlock" as const, props: { id: `ai-section-${index}`, eyebrow: section.eyebrow, title: section.title, body: section.body, points: section.points.join("\n"), tone: (section.type === "proof" ? "dark" : section.type === "caution" ? "accent" : "light") as "light" | "dark" | "accent", primary: design.palette.primary, accent: design.palette.accent } })),
      { type: "CtaBlock", props: { id: "ai-cta", title: product.oneLine, description: `${product.name}의 구성과 주의사항을 확인하고 알맞은 판매 채널에서 만나보세요.`, button: design.cta, primary: design.palette.primary, accent: design.palette.accent } },
    ],
  };
}

export function ProductDetailRender({ result, imageUrl, data }: { result: ProductStudioResult; imageUrl: string; data: ProductDetailData | null }) {
  const renderData = useMemo(() => data ?? createDetailData(result, imageUrl), [data, imageUrl, result]);
  return <Render config={detailConfig} data={renderData} />;
}

export function ProductDetailEditor({ result, imageUrl, data, onSave, onClose }: { result: ProductStudioResult; imageUrl: string; data: ProductDetailData | null; onSave: (next: ProductDetailData) => void; onClose: () => void }) {
  const initialData = useMemo(() => data ?? createDetailData(result, imageUrl), [data, imageUrl, result]);
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
