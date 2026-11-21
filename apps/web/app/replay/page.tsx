import type { Metadata } from "next";
import { DemoCall } from "../../components/DemoCall";
import { TopBar } from "../../components/TopBar";

export const metadata: Metadata = {
  title: "Demo call · Locus",
  description: "Listen to a rider get guided from the wrong gate to the right one, on a real Bengaluru street map.",
};

export default function ReplayPage() {
  return (
    <main className="page">
      <TopBar back={{ href: "/", label: "Home" }} />
      <div className="stack" style={{ gap: 8, maxWidth: 680 }}>
        <p className="label">Demo call · Hebbal, Bengaluru</p>
        <h1 className="display">From the wrong gate to the right one.</h1>
        <p className="muted" style={{ fontSize: 18 }}>
          The rider names what they can see. Locus places them on the route and talks them to the door, one landmark at a
          time. Press play to hear it.
        </p>
      </div>
      <DemoCall />
      <p className="label">
        Scripted audio. Street geometry is real (OpenStreetMap via OSRM); the landmark names are sample data.
      </p>
    </main>
  );
}
