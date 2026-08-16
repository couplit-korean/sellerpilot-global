import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "@puckeditor/core/puck.css";
import "./globals.css";
import "./operations-system.css";

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
  title: "SellerPilot | 멀티채널 커머스 운영센터",
  description: "Qoo10, Lazada, 쿠팡, 11번가, 네이버 스마트스토어, eBay를 운영하고 Alibaba와 1688 연동을 준비하는 AI 커머스 운영센터.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "SellerPilot | 멀티채널 커머스 운영센터",
    description: "한 번의 등록, 모든 마켓에. 상품 등록부터 판매와 CS까지 하나의 운영 화면으로.",
    images: [{ url: "/og-commerce.png", width: 1200, height: 630, alt: "SellerPilot 멀티채널 커머스 운영센터" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SellerPilot | 멀티채널 커머스 운영센터",
    description: "한 번의 등록, 모든 마켓에.",
    images: ["/og-commerce.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={notoSansKr.variable}>{children}</body>
    </html>
  );
}
