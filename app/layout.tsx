import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getChatGPTUser } from "./chatgpt-auth";

export const metadata: Metadata = {
  title: "工作台",
  description: "个人事务安排、材料索引与原对话成果同步。",
  appleWebApp: { capable: true, title: "工作台", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icons/app-icon.svg", type: "image/svg+xml" }],
    shortcut: "/icons/icon-192.png",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F4F3EF" };

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getChatGPTUser();
  return (
    <html lang="zh-CN">
      <head><link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />{user && <meta name="workspace-owner" content={user.userId} />}</head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
