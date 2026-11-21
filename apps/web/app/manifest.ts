import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Locus",
    short_name: "Locus",
    description: "Locus answers your delivery rider's call and talks them to your door.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#171b21",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon.png", type: "image/png", sizes: "180x180" },
    ],
  };
}
