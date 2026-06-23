import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Simple Translator",
  description: "音声翻訳アプリ（技術調査用）",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
