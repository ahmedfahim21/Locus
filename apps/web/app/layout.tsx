import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { Anek_Devanagari, Anek_Kannada, Google_Sans } from "next/font/google";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorker } from "../components/ServiceWorker";
import { THEME_BOOT_SCRIPT } from "../lib/theme";

// DESIGN.md: the system font carries the UI; Anek covers Hindi and Kannada landmark names.
const anekDevanagari = Anek_Devanagari({ subsets: ["devanagari"], weight: "400", variable: "--font-anek-devanagari" });
const anekKannada = Anek_Kannada({ subsets: ["kannada"], weight: "400", variable: "--font-anek-kannada" });
// Google's sign-in branding requires Google Sans Medium on the "Continue with Google" button; used nowhere else.
const googleSans = Google_Sans({
  subsets: ["latin"],
  weight: "500",
  variable: "--font-google-sans",
  // Next has no metrics to size-match a fallback for Google Sans; only one button uses it, so don't preload it everywhere.
  adjustFontFallback: false,
  fallback: ["Roboto", "Arial", "sans-serif"],
  preload: false,
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://locus.ahmedfahim.dev";
const DESCRIPTION = "When a delivery rider calls, Locus answers in Hinglish and guides them landmark by landmark to your door.";

export const metadata: Metadata = {
  // Absolute URLs for the link-preview image (app/opengraph-image.tsx) and canonical links.
  metadataBase: new URL(SITE_URL),
  title: { default: "Locus · Talks your rider to your door", template: "%s · Locus" },
  description: DESCRIPTION,
  applicationName: "Locus",
  keywords: ["delivery", "last mile", "voice AI", "Hinglish", "directions", "landmarks", "Swiggy", "Zomato"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Locus",
    title: "Locus · Talks your rider to your door",
    description: DESCRIPTION,
    locale: "en_IN",
  },
  twitter: { card: "summary_large_image", title: "Locus · Talks your rider to your door", description: DESCRIPTION },
  // Added to the iOS home screen, Locus opens full screen like an app.
  appleWebApp: { capable: true, title: "Locus", statusBarStyle: "default" },
  formatDetection: { telephone: false },
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
    <html lang="en" className={`${anekDevanagari.variable} ${anekKannada.variable} ${googleSans.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies a saved light/dark choice before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
