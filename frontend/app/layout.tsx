import type { Metadata } from "next";
import { Inter } from "next/font/google";
import RootErrorBoundary from "@/components/RootErrorBoundary";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Category Intelligence Agent",
  description: "AI-Powered Retail Decision Platform — ctoteam",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="h-screen overflow-hidden bg-[#0d1117] text-slate-200">
        <RootErrorBoundary>{children}</RootErrorBoundary>
      </body>
    </html>
  );
}
