/* eslint-disable @next/next/no-img-element -- studio assets can be local preview URLs */
import React, { type CSSProperties, type ReactNode } from "react";
import { productDetailRoleFromAssetReference } from "../lib/product-detail-image-manifest";
import { productDetailChrome, resolveProductDetailLocale, type ProductDetailLocale } from "../lib/product-detail-locale";
import type { ProductDetailData, ProductDetailImageLoadState } from "./product-detail-puck";

type Block = ProductDetailData["content"][number];
const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

function Points({ items, numbered = false }: { items: string[]; numbered?: boolean }) {
  if (!items.length) return null;
  return <ul className={`buyer-points${numbered ? " numbered" : ""}`}>{items.map((item, index) => <li key={`${index}-${item}`}>{numbered && <span className="buyer-step">{String(index + 1).padStart(2, "0")}</span>}{item}</li>)}</ul>;
}

type BuyerMedia = {
  onDetailImageLoadState?: (role: string, state: ProductDetailImageLoadState) => void;
  renderAnimatedGif?: (props: Extract<Block, { type: "AnimatedGifBlock" }>["props"]) => ReactNode;
};

function BuyerBlock({ block, locale, onDetailImageLoadState, renderAnimatedGif }: { block: Block; locale: ProductDetailLocale } & BuyerMedia) {
  switch (block.type) {
    case "HeroBlock": {
      const p = block.props;
      return <header className={`buyer-hero ${p.layout}`}>
        <div className="buyer-hero-copy"><p className="buyer-eyebrow">{p.eyebrow}</p><h1>{p.title}</h1><p className="buyer-lead">{p.description}</p></div>
        {p.imageUrl && <div className="buyer-hero-image"><img src={p.imageUrl} alt={p.imageAlt || p.title.replace(/\n/g, " ")} fetchPriority="high" /></div>}
      </header>;
    }
    case "VerificationRibbonBlock": {
      const p = block.props;
      // Audit provenance stays in the editor document. Only confirmed product
      // classification belongs in the customer view; no universal health badge.
      return p.verificationStatus === "verified" && p.classification
        ? <div className="buyer-classification"><span>{productDetailChrome(locale).classification}</span><strong>{p.classification}</strong></div>
        : null;
    }
    case "BenefitBlock": {
      const p = block.props;
      return <section className="buyer-section buyer-benefits"><p className="buyer-eyebrow">{p.eyebrow}</p><h2>{p.title}</h2><p className="buyer-body">{p.body}</p><Points items={[p.point1, p.point2, p.point3, p.point4, p.point5, p.point6].filter(Boolean)} /></section>;
    }
    case "ImageStoryBlock": {
      const p = block.props;
      const role = p.imageRole || productDetailRoleFromAssetReference(p.imageUrl) || "";
      return <section data-sellerpilot-detail-role={role || undefined} className={`buyer-section buyer-image-story ${p.layout}${p.reverse ? " reverse" : ""}`}>
        {p.imageUrl && <figure><img src={p.imageUrl} alt={p.imageAlt || p.title} style={{ objectFit: p.imageFit || "contain" }} loading="eager" decoding="async" data-sellerpilot-detail-image-role={role || undefined} onLoad={() => { if (role) onDetailImageLoadState?.(role, "loaded"); }} onError={() => { if (role) onDetailImageLoadState?.(role, "error"); }} /></figure>}
        <div className="buyer-copy"><p className="buyer-eyebrow">{p.eyebrow}</p><h2>{p.title}</h2><p className="buyer-body">{p.body}</p><Points items={lines(p.points)} numbered={p.layout === "steps"} /></div>
      </section>;
    }
    case "AnimatedGifBlock": return renderAnimatedGif?.(block.props) ?? null;
    case "StoryBlock": {
      const p = block.props;
      return <section className={`buyer-section buyer-story ${p.layout} ${p.tone}`}><div><p className="buyer-eyebrow">{p.eyebrow}</p><h2>{p.title}</h2><p className="buyer-body">{p.body}</p></div><Points items={lines(p.points)} numbered={p.layout === "steps"} /></section>;
    }
    case "CtaBlock": {
      const p = block.props;
      return <footer className="buyer-section buyer-closing"><p className="buyer-eyebrow">{p.audience}</p><h2>{p.title}</h2><p className="buyer-body">{p.description}</p>{p.checklist && <p className="buyer-footnote">{p.checklist}</p>}</footer>;
    }
    default: return null;
  }
}

/** Presentation only. Does not mutate the editor document or channel HTML. */
export function ProductDetailBuyer({ data, locale, ...media }: { data: ProductDetailData; locale?: string } & BuyerMedia) {
  const hero = data.content.find((block) => block.type === "HeroBlock");
  const palette = hero?.type === "HeroBlock" ? hero.props : null;
  const style = {
    "--buyer-primary": palette?.primary || "#29253d",
    "--buyer-accent": palette?.accent || "#f3eaaa",
    "--buyer-surface": palette?.surface || "#f4f1fa",
  } as CSSProperties;
  return React.createElement("article", { className: "buyer-detail", style }, data.content.map((block, index) => <BuyerBlock key={block.props.id || index} block={block} locale={resolveProductDetailLocale(data, locale)} {...media} />));
}
