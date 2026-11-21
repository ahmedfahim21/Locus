import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { Anek_Devanagari, Anek_Kannada, Anek_Latin, JetBrains_Mono, Kalam } from "next/font/google";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// DESIGN.md: one family (Anek) at weight 400; hierarchy comes from the width axis.
const anekLatin = Anek_Latin({ subsets: ["latin"], weight: "variable", axes: ["wdth"], variable: "--font-anek-latin" });
const anekDevanagari = Anek_Devanagari({ subsets: ["devanagari"], weight: "variable", axes: ["wdth"], variable: "--font-anek-devanagari" });
const anekKannada = Anek_Kannada({ subsets: ["kannada"], weight: "variable", axes: ["wdth"], variable: "--font-anek-kannada" });
const kalam = Kalam({ subsets: ["latin"], weight: "400", variable: "--font-kalam" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: "400", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Locus",
  description: "When a delivery rider calls, Locus answers and talks them to your door.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#E3ECD0" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1A2E" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const fonts = [anekLatin, anekDevanagari, anekKannada, kalam, mono].map((f) => f.variable).join(" ");
  return (
    <html lang="en" className={fonts}>
      <body>{children}</body>
    </html>
  );
}
