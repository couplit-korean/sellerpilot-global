import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@puckeditor/core/puck.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SellerPilot | 멀티채널 커머스 운영센터",
  description: "Qoo10, Shopee, Lazada, 쿠팡, 11번가, 네이버 스마트스토어, eBay의 상품 등록, 매출, 주문, 재고와 CS를 한눈에 관리하는 AI 커머스 운영센터.",
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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
