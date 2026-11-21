"use client";

import { useState } from "react";
import type { LatLon, RouteLeg } from "../lib/api";
import { FitTo, Map, MapMarker, MapRoute } from "./mapcn/Map";

export type Stop = {
  name: string;
  /** Other scripts for the same place (Hindi, Kannada). Shown under the name. */
  alt?: { text: string; script: "deva" | "knda" }[];
  location: LatLon;
  /** The walk-video frame showing this landmark. */
  photoUrl?: string | null;
};

/**
 * The route map: the route in blue over the Sadak-coloured city, numbered
 * landmark pins, the door, and (during a call) the rider and Locus's last line.
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
  const last = stops[stops.length - 1];
  // A last landmark at the door already marks it; the × alone avoids a label on top of its stamp.
  const doorIsLastStop =
    last !== undefined &&
    Math.hypot((last.location.lat - door.lat) * 111_320, (last.location.lon - door.lon) * 111_320 * Math.cos((door.lat * Math.PI) / 180)) <= 15;

  return (
    <Map center={door} zoom={16} interactive={interactive} className={className} label={label}>
      <FitTo points={points} padding={padding} />
      {legs && <MapRoute legs={legs} walkedLegs={walkedLegs} drawIn={drawIn} />}
      {stops.map((stop, i) => (
        <MapMarker key={`${i}-${stop.name}`} at={stop.location} anchor="left" offset={[stop.photoUrl ? -23 : -14, 0]}>
          <Stamp stop={stop} index={i} reached={arrived || i < reached} />
        </MapMarker>
      ))}
      <MapMarker at={door} anchor="bottom" offset={[0, 9]}>
        <DoorPin label={doorIsLastStop ? null : "Door"} />
      </MapMarker>
      {rider && (
        <MapMarker at={rider}>
          <div className="rider-dot" aria-label="Rider" />
        </MapMarker>
      )}
      {note && noteAt && (
        <MapMarker key={note} at={noteAt} anchor="bottom" offset={[0, -16]}>
          <div className="map-callout">
            <span>{note}</span>
          </div>
        </MapMarker>
      )}
    </Map>
  );
}

/** A landmark pin: number pip, name, other scripts, and the walk photo when there is one. */
export function Stamp({ stop, index, reached = false, draft = false }: { stop: Stop; index: number; reached?: boolean; draft?: boolean }) {
  const classes = `pin${stop.photoUrl ? " has-photo" : ""}${reached ? " reached" : ""}${draft ? " draft" : ""}`;
  const pip = <span className="pip">{index + 1}</span>;
  return (
    <div className={classes}>
      {stop.photoUrl ? (
        <span className="pin-photo">
          <StampPhoto url={stop.photoUrl} alt={stop.name} />
          {pip}
        </span>
      ) : (
        pip
      )}
      <span className="pin-text">
        <span className="pin-name">{stop.name}</span>
        {stop.alt && stop.alt.length > 0 && (
          <span className="pin-alt">
            {stop.alt.map((a, i) => (
              <span key={a.text} className={a.script}>
                {i > 0 ? " · " : ""}
                {a.text}
              </span>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

export function DoorPin({ label }: { label: string | null }) {
  return (
    <div className="door-pin" aria-label="Door">
      {label && <small>{label}</small>}
      <span className="door-dot" />
    </div>
  );
}

/** The landmark's real frame, with a shimmer until it loads (never a stand-in photo). */
export function StampPhoto({ url, alt }: { url: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  if (state === "failed") return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs, not optimisable
    <img
      src={url}
      alt={`Photo of ${alt} from your walk`}
      className={state === "loading" ? "skeleton" : undefined}
      onLoad={() => setState("ready")}
      onError={() => {
        console.error("[photo] failed to load", alt);
        setState("failed");
      }}
    />
  );
}
