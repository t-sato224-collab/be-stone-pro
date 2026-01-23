import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// --- アイコンとAndroid用マニフェストの設定 ---
export const metadata: Metadata = {
  title: "BE STONE 業務アプリ",
  description: "BE STONE 業務管理システム",
  manifest: "/manifest.json", // <--- この1行を確実に追加してください
  icons: {
    icon: "/icon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className={inter.className}>{children}</body>
    </html>
  );
}