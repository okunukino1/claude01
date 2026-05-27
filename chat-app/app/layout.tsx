import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "社内チャット",
  description: "社内コミュニケーションツール",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full bg-white">{children}</body>
    </html>
  );
}
