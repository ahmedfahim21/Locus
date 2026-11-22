import type { MetadataRoute } from "next";

/** Installable on Android and desktop (PWA); iOS reads the apple-* settings in layout.tsx. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Locus",
    short_name: "Locus",
    description: "Locus answers your delivery rider's call and talks them to your door.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#171b21",
    categories: ["lifestyle", "utilities"],
    icons: [
      { src: "/icon-192.png", type: "image/png", sizes: "192x192", purpose: "any" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/icon-maskable-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    shortcuts: [{ name: "Try a call", url: "/test-call", icons: [{ src: "/icon-192.png", sizes: "192x192" }] }],
  };
}
