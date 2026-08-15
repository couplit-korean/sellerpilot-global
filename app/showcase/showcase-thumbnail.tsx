import Image from "next/image";
import type { ShowcaseProduct } from "../showcase-products";

export function ShowcaseThumbnail({ product, priority = false }: { product: ShowcaseProduct; priority?: boolean }) {
  const { palette } = product.result.design;
  return (
    <div
      className="showcase-thumbnail"
      style={{
        "--showcase-primary": palette.primary,
        "--showcase-accent": palette.accent,
        "--showcase-surface": palette.surface,
      } as React.CSSProperties}
    >
      <span className="showcase-thumbnail-badge">{product.result.thumbnail.badge}</span>
      <div className="showcase-thumbnail-copy">
        <small>{product.category}</small>
        <strong>{product.result.thumbnail.headline}</strong>
        <em>{product.result.thumbnail.subline}</em>
      </div>
      <div className="showcase-thumbnail-image">
        <Image src={product.image} alt={`${product.name} 샘플 상품 이미지`} fill sizes="(max-width: 760px) 90vw, 420px" priority={priority} />
      </div>
      <i className="showcase-thumbnail-orb" />
    </div>
  );
}
