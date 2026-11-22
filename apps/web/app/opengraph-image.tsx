import { ImageResponse } from "next/og";

// Link previews (WhatsApp, X, LinkedIn, Slack). DESIGN.md: ink on grey chrome, colour only on the map, weight 400.
export const alt = "Locus: talks your rider to your door";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Inter 400 as TTF (the renderer can't read woff2); fetched once at build, and the build fails if it can't be. */
async function inter(): Promise<ArrayBuffer> {
  const css = await (await fetch("https://fonts.googleapis.com/css2?family=Inter:wght@400")).text();
  const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
  if (!url) throw new Error("Couldn't find Inter's TTF in the Google Fonts CSS");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Inter font download failed: ${res.status}`);
  return res.arrayBuffer();
}

const ink = "#000000";
const muted = "#6e6e73";
const map = { ground: "#20252c", building: "#363e49", edge: "#262c34", casing: "#0f1216", gold: "#f0c75e", lane: "#a3adb8", secondary: "#e3e8ee", route: "#5ab0ff", landmark: "#f3d27a", door: "#ffffff" };

function Mark({ size: s }: { size: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 64 64">
      <rect x="0.5" y="0.5" width="63" height="63" rx="14.5" fill="#171b21" />
      <path d="M6 54H58M10 24H30M52 6V30" stroke="#262b33" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M20 15V35a11 11 0 0 0 11 11H45" fill="none" stroke="#0b0d10" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 15V35a11 11 0 0 0 11 11H45" fill="none" stroke="#5ab0ff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="15" r="6.5" fill="#5ab0ff" stroke="#ffffff" strokeWidth="2.6" />
      <circle cx="20" cy="31" r="3.8" fill="#f3d27a" stroke="#0b0d10" strokeWidth="2" />
      <circle cx="46" cy="46" r="7.5" fill="#ffffff" stroke="#0b0d10" strokeWidth="3" />
    </svg>
  );
}

/** A small dark-map tile: main road, lanes, blocks, and the route from rider past a landmark to the door. */
function MapTile() {
  return (
    <svg width="460" height="486" viewBox="0 0 460 486">
      <rect width="460" height="486" fill={map.ground} />
      {/* Blocks */}
      {[
        [20, 140, 104, 124], [20, 304, 104, 200], [178, 140, 150, 124], [178, 304, 150, 200], [388, 140, 90, 124], [388, 304, 90, 200],
        [20, 0, 160, 84], [208, 0, 130, 84], [388, 0, 90, 84],
      ].map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx="6" fill={map.building} stroke={map.edge} strokeWidth="2" />
      ))}
      {/* Lanes and a secondary road, in casings */}
      <path d="M150 112V500M150 284H470" stroke={map.casing} strokeWidth="16" />
      <path d="M150 112V500M150 284H470" stroke={map.lane} strokeWidth="9" />
      <path d="M360 0V500" stroke={map.casing} strokeWidth="18" />
      <path d="M360 0V500" stroke={map.secondary} strokeWidth="11" />
      {/* Main road */}
      <path d="M-10 112H470" stroke={map.casing} strokeWidth="28" />
      <path d="M-10 112H470" stroke={map.gold} strokeWidth="19" />
      {/* Route: rider → landmark → door */}
      <path d="M150 112V250a34 34 0 0 0 34 34H300" fill="none" stroke="#0b0d10" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M150 112V250a34 34 0 0 0 34 34H300" fill="none" stroke={map.route} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="150" cy="112" r="15" fill={map.route} stroke="#ffffff" strokeWidth="5" />
      <circle cx="150" cy="192" r="10" fill={map.landmark} stroke="#0b0d10" strokeWidth="4" />
      <circle cx="300" cy="284" r="17" fill={map.door} stroke="#0b0d10" strokeWidth="5" />
    </svg>
  );
}

function Bubble({ from, text }: { from: "rider" | "locus"; text: string }) {
  const rider = from === "rider";
  return (
    <div style={{ display: "flex", justifyContent: rider ? "flex-end" : "flex-start", width: "100%" }}>
      <div
        style={{
          display: "flex",
          padding: "14px 20px",
          borderRadius: 22,
          fontSize: 24,
          letterSpacing: "-0.01em",
          background: rider ? "#000000" : "#e5e5ea",
          color: rider ? "#ffffff" : "#000000",
        }}
      >
        {text}
      </div>
    </div>
  );
}

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#f5f5f7", padding: 72, fontFamily: "Inter" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, paddingRight: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Mark size={64} />
            <div style={{ fontSize: 46, letterSpacing: "-0.03em", color: ink }}>Locus</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 66, lineHeight: 1.04, letterSpacing: "-0.035em", color: ink }}>
              <span>Talks your rider</span>
              <span>to your door.</span>
            </div>
            <div style={{ fontSize: 26, lineHeight: 1.4, color: muted, maxWidth: 520 }}>
              Answers the delivery call in Hinglish and guides the rider, landmark by landmark.
            </div>
          </div>
          <div style={{ fontSize: 22, color: muted, letterSpacing: "0.01em" }}>locus.ahmedfahim.dev</div>
        </div>
        <div style={{ display: "flex", position: "relative", width: 460, height: 486, borderRadius: 32, overflow: "hidden" }}>
          <MapTile />
          <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "absolute", left: 24, right: 24, bottom: 24 }}>
            <Bubble from="rider" text="Qualcomm ke saamne hoon." />
            <Bubble from="locus" text="Bas, aap pahunch gaye!" />
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Inter", data: await inter(), weight: 400, style: "normal" }] },
  );
}
