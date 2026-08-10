import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "셀러파일럿 | 글로벌 상품 등록 자동화",
  description: "상품 사진에서 동일상품 가격 비교, 마진 계산, 글로벌 마켓 등록 초안까지.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "셀러파일럿",
    description: "사진 한 장에서 3개 마켓 등록 초안까지",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "셀러파일럿 상품 등록 자동화" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "셀러파일럿",
    description: "사진 한 장에서 3개 마켓 등록 초안까지",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
