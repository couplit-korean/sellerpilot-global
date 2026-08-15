import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BadgeCheck, ImageIcon, Layers3, Sparkles } from "lucide-react";
import { showcaseProducts } from "../showcase-products";
import { ShowcaseThumbnail } from "./showcase-thumbnail";

export const metadata: Metadata = {
  title: "AI 상품 디자인 샘플 5종 | SellerPilot",
  description: "SellerPilot이 샘플 상품 데이터로 자동 제작한 썸네일과 상세페이지 5종을 확인하세요.",
  openGraph: {
    title: "SellerPilot | 상품 사진에서 시작된 5개의 판매 페이지",
    description: "AI로 자동 제작한 상품 썸네일과 반응형 상세페이지 5종",
    images: [{ url: "/demo/setting-shots/premium-studio.png", alt: "실제 촬영 상품 이미지로 제작한 SellerPilot 상품 디자인 샘플" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SellerPilot | 상품 사진에서 시작된 5개의 판매 페이지",
    description: "AI로 자동 제작한 상품 썸네일과 반응형 상세페이지 5종",
    images: ["/demo/setting-shots/premium-studio.png"],
  },
};

export default function ShowcasePage() {
  return (
    <main className="showcase-page">
      <header className="showcase-topbar">
        <Link href="/" className="showcase-brand"><span>⚡</span><b>SellerPilot</b></Link>
        <Link href="/" className="showcase-back"><ArrowLeft size={16} />운영센터로 돌아가기</Link>
      </header>

      <section className="showcase-intro">
        <div>
          <span><Sparkles size={15} /> AI PRODUCT DESIGN SHOWCASE</span>
          <h1>상품 사진에서 시작된<br /><em>5개의 판매 페이지</em></h1>
          <p>샘플 상품 정보를 바탕으로 자동 제작한 채널용 썸네일과 모바일 우선 상세페이지입니다. 각 카드를 눌러 독립된 상세페이지 링크를 확인할 수 있습니다.</p>
        </div>
        <aside>
          <div><ImageIcon size={19} /><span><b>5종</b><small>자동 썸네일</small></span></div>
          <div><Layers3 size={19} /><span><b>8개</b><small>상세 블록 구성</small></span></div>
          <div><BadgeCheck size={19} /><span><b>7채널</b><small>등록 활용 가능</small></span></div>
        </aside>
      </section>

      <section className="showcase-grid" aria-label="샘플 상품 5종">
        {showcaseProducts.map((product, index) => (
          <article className="showcase-card" key={product.slug}>
            <ShowcaseThumbnail product={product} priority={index < 2} />
            <div className="showcase-card-meta">
              <div><span>{String(index + 1).padStart(2, "0")}</span><p><small>{product.sku} · {product.photoCredit}</small><b>{product.name}</b></p></div>
              <Link href={`/showcase/${product.slug}`}>상세페이지 열기<ArrowRight size={16} /></Link>
            </div>
          </article>
        ))}
      </section>

      <section className="showcase-note">
        <BadgeCheck size={18} />
        <p><b>실제 촬영 이미지 사용</b><span>사용자 제공 상품 사진과 Unsplash License로 제공된 실제 제품 촬영 사진을 사용했습니다. 상품 정보는 이미지에 보이는 라벨을 중심으로 구성했으며 판매 전 공식 제조사 자료로 최종 확인해야 합니다.</span></p>
      </section>
    </main>
  );
}
