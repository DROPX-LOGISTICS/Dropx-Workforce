import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DropX Connect",
    template: "%s"
  },
  description: "Mobile access for DropX employees, field executives, vendors, and contractors.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "DropX Connect",
    statusBarStyle: "default"
  },
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
