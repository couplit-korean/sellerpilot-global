import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "@puckeditor/core/puck.css";
import "./globals.css";
import "./operations-system.css";
import "./commerce-ux-refactor.css";
import "./style-learning-center.css";
import "./mobile-optimization.css";
import "./interaction-layers.css";
import "./product-publish-workbench.css";

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-geist-sans",
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  manifest: "/manifest.webmanifest",
  title: "SellerPilot | 멀티채널 커머스 운영센터",
  description: "Qoo10, Shopee, Lazada, 쿠팡, 11번가, 네이버 스마트스토어, eBay, Temu를 운영하는 AI 커머스 운영센터.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    shortcut: "/favicon.svg",
    apple: "/icon-192.png",
  },
  applicationName: "SellerPilot",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "SellerPilot" },
  openGraph: {
    title: "SellerPilot | 멀티채널 커머스 운영센터",
    description: "한 번의 등록, 모든 마켓에. 상품 등록부터 판매와 CS까지 하나의 운영 화면으로.",
    images: [{ url: "/og-style-learning.png", width: 1200, height: 630, alt: "SellerPilot 멀티채널 상품·주문·문의 통합 운영" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SellerPilot | 멀티채널 커머스 운영센터",
    description: "한 번의 등록, 모든 마켓에.",
    images: ["/og-style-learning.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-visual",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={notoSansKr.variable}>{children}</body>
    </html>
  );
}
