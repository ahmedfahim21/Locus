import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { Anek_Devanagari, Anek_Kannada } from "next/font/google";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// DESIGN.md: the system font carries the UI; Anek covers Hindi and Kannada landmark names.
const anekDevanagari = Anek_Devanagari({ subsets: ["devanagari"], weight: "400", variable: "--font-anek-devanagari" });
const anekKannada = Anek_Kannada({ subsets: ["kannada"], weight: "400", variable: "--font-anek-kannada" });

export const metadata: Metadata = {
  title: "Locus",
  description: "When a delivery rider calls, Locus answers and talks them to your door.",
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
    <html lang="en" className={`${anekDevanagari.variable} ${anekKannada.variable}`}>
      <body>{children}</body>
    </html>
  );
}
