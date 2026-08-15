import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BadgeCheck, ExternalLink, Layers3 } from "lucide-react";
import { notFound } from "next/navigation";
import { ProductDetailRender } from "../../product-detail-puck";
import { getShowcaseProduct, showcaseProducts } from "../../showcase-products";
import { ShowcaseThumbnail } from "../showcase-thumbnail";

export function generateStaticParams() {
  return showcaseProducts.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = getShowcaseProduct(slug);
  if (!product) return {};
  return {
    title: `${product.name} AI 상세페이지 | SellerPilot`,
    description: product.result.product.oneLine,
    openGraph: {
      title: `${product.name} | SellerPilot`,
      description: product.result.product.oneLine,
      images: [{ url: product.image, alt: `${product.name} 실제 상품 사진` }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${product.name} | SellerPilot`,
      description: product.result.product.oneLine,
      images: [product.image],
    },
  };
}

export default async function ShowcaseDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = getShowcaseProduct(slug);
  if (!product) notFound();
  const currentIndex = showcaseProducts.findIndex((item) => item.slug === slug);
  const nextProduct = showcaseProducts[(currentIndex + 1) % showcaseProducts.length];

  return (
    <main className="showcase-detail-page">
      <header className="showcase-detail-nav">
        <Link href="/showcase"><ArrowLeft size={17} />샘플 5종 전체 보기</Link>
        <Link href="/" className="showcase-brand"><span>⚡</span><b>SellerPilot</b></Link>
        <Link href={`/showcase/${nextProduct.slug}`}>다음 상품<ArrowRight size={17} /></Link>
      </header>

      <section className="showcase-detail-summary">
        <div>
          <span><Layers3 size={14} /> GENERATED PRODUCT PAGE</span>
          <small>{product.sku} · 샘플 데이터</small>
          <h1>{product.name}</h1>
          <p>{product.result.product.oneLine}</p>
          <div>{product.result.product.features.map((feature) => <em key={feature}><BadgeCheck size={14} />{feature}</em>)}</div>
        </div>
        <ShowcaseThumbnail product={product} priority />
      </section>

      <section className="showcase-detail-toolbar">
        <div><span>DETAIL PAGE PREVIEW</span><b>모바일·태블릿·PC 반응형 상세페이지</b></div>
        <a href={product.sourceUrl ?? product.image} target="_blank" rel="noreferrer">실제 상품 사진 출처 · {product.photoCredit}<ExternalLink size={14} /></a>
      </section>

      <article className="showcase-detail-canvas">
        <ProductDetailRender result={product.result} imageUrl={product.image} data={null} />
      </article>

      <footer className="showcase-detail-footer">
        <p><b>이 상세페이지는 자동 제작 샘플입니다.</b><span>실제 상품 데이터 연결 후 문구·가격·표시사항을 최종 확정하세요.</span></p>
        <Link href={`/showcase/${nextProduct.slug}`}>{nextProduct.name} 보기<ArrowRight size={16} /></Link>
      </footer>
    </main>
  );
}
