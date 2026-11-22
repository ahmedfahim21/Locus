"use client";

import { ArrowLeft, ArrowRight, ArrowsOut, Check, MapTrifold, Plus, VideoCamera, Warning, Binoculars } from "@phosphor-icons/react";
import { PhotoViewer } from "../PhotoViewer";
import { useEffect, useState, type ReactNode } from "react";
import { api, scriptNames, type LatLon, type RouteLeg, type Suggestion, type SuggestionSource, type Suggestions } from "../../lib/api";
import { AccountMenu } from "../AccountMenu";
import { RouteMap, StampPhoto } from "../RouteMap";

const SOURCE_LABEL: Record<SuggestionSource, string> = { map: "Map", video: "From you", street: "Street View" };
const SOURCE_ICON = { map: MapTrifold, video: VideoCamera, street: Binoculars } as const;

/**
 * Setup's suggestions: Locus drafts the route from the nearest main road and
 * proposes landmarks along it from the map, the walk video and Street View,
 * each with an instruction. The recipient keeps the ones that are right.
 */
export function SuggestStep({
  door,
  skippedProposals,
  renames,
  progress,
  onBack,
  onDone,
}: {
  door: LatLon;
  /** Walk proposals the recipient already skipped in the walk review. */
  skippedProposals: Set<string>;
  /** Names the recipient gave walk landmarks in review, by proposal id. */
  renames: Map<string, string>;
  progress: ReactNode;
  onBack: () => void;
  onDone: (kept: Suggestion[]) => void;
}) {
  const [data, setData] = useState<Suggestions | null>(null);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api<Suggestions>(`/me/suggestions?lat=${door.lat}&lon=${door.lon}`)
      .then((res) => {
        if (cancelled) return;
        // Skipped walk landmarks are left out; renamed ones keep the recipient's name, in the drafted words too.
        const named = (s: Suggestion) => {
          const renamed = s.proposalId ? renames.get(s.proposalId) : undefined;
          return renamed ? { ...s, name: renamed, text: s.text.split(s.name).join(renamed) } : s;
        };
        const usable = { ...res, suggestions: res.suggestions.filter((s) => !(s.proposalId && skippedProposals.has(s.proposalId))).map(named) };
        setData(usable);
        setKeep(new Set(usable.suggestions.filter((s) => s.recommended).map((s) => s.id)));
      })
      .catch((err: Error & { code?: string }) => {
        console.error("[api] GET /me/suggestions failed", err);
        if (!cancelled) setError({ code: err.code ?? null, message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [door.lat, door.lon, skippedProposals, renames]);

  const legs: RouteLeg[] | null = data ? [{ onRoads: true, line: data.route.line }] : null;
  const kept = data?.suggestions.filter((s) => keep.has(s.id)) ?? [];
  const toggle = (id: string) => setKeep((k) => (k.has(id) ? new Set([...k].filter((x) => x !== id)) : new Set([...k, id])));
  /** Index into `withPhotos` of the photo shown full screen, or null. */
  const [viewing, setViewing] = useState<number | null>(null);
  const withPhotos = data?.suggestions.filter((s) => s.photoUrl) ?? [];

  return (
    <main className="setup">
      <div className="setup-map">
        {data ? (
          <RouteMap
            stops={data.suggestions.map((s) => ({
              name: s.name,
              location: s.location,
              alt: scriptNames([s.nameHi ?? "", s.nameLocal ?? ""]),
              kind: s.kind,
              color: s.color,
            }))}
            door={door}
            legs={legs}
            drawIn
            className="fill"
            padding={{ top: 120, bottom: 60, left: 80, right: 80 }}
            label="Suggested landmarks along your route"
          />
        ) : (
          <div className="map fill skeleton" style={{ position: "absolute", inset: 0, borderRadius: 0 }} />
        )}
        <div className="poster glass">
          <div className="street">The way to your gate</div>
          <div className="label">
            {data
              ? `From ${data.route.entryStreet ?? "the main road"} · ${data.route.lengthM} m · ${data.route.turns.length} turn${data.route.turns.length === 1 ? "" : "s"}`
              : "Reading the map and your walk video…"}
          </div>
        </div>
      </div>

      <aside className="setup-panel">
        <div className="topbar">
          <button className="btn icon" type="button" onClick={onBack} aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <div className="row" style={{ gap: 12 }}>
            {progress}
            <AccountMenu />
          </div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="title">Landmarks we found</h1>
          <p className="muted">
            Along the way from the main road to your gate. Keep the ones a rider would notice; you can edit the words next.
          </p>
        </div>

        {!data && !error && (
          <div className="stack" aria-busy="true" role="status">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 72, borderRadius: "var(--radius)" }} />
            ))}
            <span className="label">Looking at the map and your walk video. This can take a few seconds.</span>
          </div>
        )}

        {error && (
          <>
            <div className="alert err" role="alert">
              <Warning size={18} />
              <span>{error.message}</span>
            </div>
            <button className="btn primary block" type="button" onClick={() => onDone([])}>
              <Plus size={18} />
              Add landmarks myself
            </button>
          </>
        )}

        {data && (
          <>
            {/* Street photos are optional; only a configured source that failed is worth mentioning. */}
            {data.streetView.status === "error" && (
              <div className="alert info small">
                <Binoculars size={18} />
                <span>Street photos didn&rsquo;t load this time ({data.streetView.message}). These come from the map and your video.</span>
              </div>
            )}
            {data.suggestions.length === 0 ? (
              <div className="alert info">
                <MapTrifold size={18} />
                <span>Nothing mapped along this way yet. Add the landmarks you know; filming your walk helps too.</span>
              </div>
            ) : (
              <ul className="group">
                {data.suggestions.map((s) => {
                  const on = keep.has(s.id);
                  return (
                    <li key={s.id} className="suggestion-item">
                      <button type="button" className="cell suggestion" aria-pressed={on} onClick={() => toggle(s.id)}>
                        <span className="suggestion-thumb" style={s.color ? { background: s.color } : undefined}>
                          {s.photoUrl ? <StampPhoto url={s.photoUrl} alt={s.name} /> : null}
                        </span>
                        <span className="cell-main">
                          <span>{s.name}</span>
                          <span className="cell-sub" style={{ whiteSpace: "normal" }}>&ldquo;{s.text}&rdquo;</span>
                          <span className="row" style={{ gap: 4, marginTop: 4 }}>
                            {s.sources.map((src) => {
                              const Icon = SOURCE_ICON[src];
                              return (
                                <span key={src} className="source-chip">
                                  <Icon size={12} />
                                  {SOURCE_LABEL[src]}
                                </span>
                              );
                            })}
                            <span className="label">{s.alongM} m in</span>
                          </span>
                        </span>
                        <span className={`check${on ? " on" : ""}`} aria-hidden="true">{on && <Check size={14} />}</span>
                      </button>
                      {/* Over the thumbnail, outside the row's button: tapping the photo expands it instead of toggling. */}
                      {s.photoUrl && (
                        <button
                          type="button"
                          className="suggestion-thumb photo-expand thumb-overlay"
                          aria-label={`Expand photo of ${s.name}`}
                          onClick={() => setViewing(withPhotos.findIndex((x) => x.id === s.id))}
                        >
                          <span className="expand-hint" aria-hidden="true">
                            <ArrowsOut size={12} />
                          </span>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <PhotoViewer
              photos={withPhotos.map((s) => ({ id: s.id, url: s.photoUrl!, name: s.name, detail: s.text }))}
              index={viewing}
              onIndex={setViewing}
              onClose={() => setViewing(null)}
              isKept={(id) => keep.has(id)}
              onToggle={toggle}
            />
            <button className="btn primary block" type="button" onClick={() => onDone(kept)}>
              {kept.length ? `Use ${kept.length} landmark${kept.length === 1 ? "" : "s"}` : "Add landmarks myself"}
              <ArrowRight size={18} />
            </button>
          </>
        )}
      </aside>
    </main>
  );
}
