import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { Anek_Devanagari, Anek_Kannada } from "next/font/google";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { THEME_BOOT_SCRIPT } from "../lib/theme";

// DESIGN.md: the system font carries the UI; Anek covers Hindi and Kannada landmark names.
const anekDevanagari = Anek_Devanagari({ subsets: ["devanagari"], weight: "400", variable: "--font-anek-devanagari" });
const anekKannada = Anek_Kannada({ subsets: ["kannada"], weight: "400", variable: "--font-anek-kannada" });

export const metadata: Metadata = {
  title: { default: "Locus · Talks your rider to your door", template: "%s · Locus" },
  description: "When a delivery rider calls, Locus answers in Hinglish and guides them landmark by landmark to your door.",
  applicationName: "Locus",
  openGraph: { title: "Locus", description: "Talks your rider to your door.", type: "website" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${anekDevanagari.variable} ${anekKannada.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies a saved light/dark choice before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
