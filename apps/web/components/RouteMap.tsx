"use client";

import type { LatLon, RouteLeg } from "../lib/api";
import { FitTo, Map, MapMarker, MapRoute } from "./mapcn/Map";

export type Stop = {
  name: string;
  /** Other scripts for the same place (Hindi, Kannada). Shown under the name. */
  alt?: { text: string; script: "deva" | "knda" }[];
  location: LatLon;
};

/**
 * The wedding-card route map: inked route, numbered landmark stamps, the door,
 * and (during a call) the rider and the direction Locus just gave.
 */
export function RouteMap({
  stops,
  door,
  legs,
  reached = 0,
  arrived = false,
  note,
  drawIn = false,
  interactive = true,
  className,
  padding = 64,
  label,
}: {
  stops: Stop[];
  door: LatLon;
  legs: RouteLeg[] | null;
  /** How many stops the rider has reached (the rider stands at stop `reached`). */
  reached?: number;
  arrived?: boolean;
  /** Kalam line written next to the stretch the rider walks next. */
  note?: string | null;
  drawIn?: boolean;
  interactive?: boolean;
  className?: string;
  padding?: number | { top: number; bottom: number; left: number; right: number };
  label: string;
}) {
  const rider = arrived ? door : reached > 0 ? stops[reached - 1]?.location ?? null : null;
  const walkedLegs = arrived ? (legs?.length ?? 0) : Math.max(0, reached - 1);
  const nextLeg = legs && !arrived && reached > 0 ? legs[reached - 1] : undefined;
  const noteAt = nextLeg ? nextLeg.line[Math.floor(nextLeg.line.length / 2)] : undefined;
  const points = [...stops.map((s) => s.location), door];

  return (
    <Map center={door} zoom={16} interactive={interactive} className={className} label={label}>
      <FitTo points={points} padding={padding} />
      {legs && <MapRoute legs={legs} walkedLegs={walkedLegs} drawIn={drawIn} />}
      {stops.map((stop, i) => (
        <MapMarker key={`${i}-${stop.name}`} at={stop.location} anchor={i % 2 ? "left" : "right"} offset={[i % 2 ? 14 : -14, 0]}>
          <Stamp stop={stop} index={i} reached={arrived || i < reached} />
        </MapMarker>
      ))}
      <MapMarker at={door} anchor="bottom" offset={[0, 14]}>
        <div className="door" aria-label="Door">
          ×<small>door</small>
        </div>
      </MapMarker>
      {rider && (
        <MapMarker at={rider}>
          <div className="rider-dot" aria-label="Rider" />
        </MapMarker>
      )}
      {note && noteAt && (
        <MapMarker key={note} at={noteAt} anchor="bottom" offset={[0, -16]}>
          <div className="map-note">
            <span>{note}</span>
          </div>
        </MapMarker>
      )}
    </Map>
  );
}

export function Stamp({ stop, index, reached = false, draft = false }: { stop: Stop; index: number; reached?: boolean; draft?: boolean }) {
  const rotation = index % 2 ? 2.5 : -2.5;
  return (
    <div className={`stamp${reached ? " reached" : ""}${draft ? " draft" : ""}`} style={{ ["--r" as string]: `${rotation}deg` }}>
      <span className="num">{index + 1}</span> <span className="name">{stop.name}</span>
      {stop.alt?.map((a) => (
        <span key={a.text} className={`alt ${a.script}`}>
          {a.text}
        </span>
      ))}
    </div>
  );
}
