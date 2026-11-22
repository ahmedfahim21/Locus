"use client";

import { CaretLeft, CaretRight, Check, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

export type ViewerPhoto = { id: string; url: string; name: string; detail?: string | null };

/**
 * Full-screen view of landmark photos while choosing which to keep. Arrows or a swipe
 * step through them; Esc or a tap outside closes. With `isKept`/`onToggle` the
 * keep/skip choice can be made right here.
 */
export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
  isKept,
  onToggle,
}: {
  photos: ViewerPhoto[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  isKept?: (id: string) => boolean;
  onToggle?: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const swipeFrom = useRef<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const photo = index === null ? null : photos[index] ?? null;
  const step = (by: number) => {
    if (index === null) return;
    const next = index + by;
    if (next >= 0 && next < photos.length) onIndex(next);
  };

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (photo && !d.open) d.showModal();
    if (!photo && d.open) d.close();
  }, [photo]);

  // Each photo shows a skeleton until it has loaded.
  useEffect(() => setState("loading"), [photo?.url]);

  if (!photo) return <dialog ref={dialog} className="viewer" onClose={onClose} />;
  const kept = isKept?.(photo.id);

  return (
    <dialog
      ref={dialog}
      className="viewer"
      aria-label={`Photo of ${photo.name}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) dialog.current?.close();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") step(-1);
        if (e.key === "ArrowRight") step(1);
      }}
    >
      <div className="viewer-top">
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <span className="viewer-name">{photo.name}</span>
          {photo.detail && <span className="viewer-sub">&ldquo;{photo.detail}&rdquo;</span>}
        </div>
        <span className="viewer-sub mono">
          {index! + 1} of {photos.length}
        </span>
        <button type="button" className="viewer-icon" aria-label="Close" onClick={() => dialog.current?.close()}>
          <X size={20} />
        </button>
      </div>

      <div
        className="viewer-stage"
        onPointerDown={(e) => (swipeFrom.current = e.clientX)}
        onPointerUp={(e) => {
          if (swipeFrom.current === null) return;
          const dx = e.clientX - swipeFrom.current;
          swipeFrom.current = null;
          if (Math.abs(dx) > 48) step(dx < 0 ? 1 : -1);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        {state === "failed" ? (
          <p className="viewer-sub">Couldn&rsquo;t load this photo.</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs, not optimisable
          <img
            key={photo.url}
            src={photo.url}
            alt={`Photo of ${photo.name}`}
            className={state === "loading" ? "skeleton" : undefined}
            draggable={false}
            onLoad={() => setState("ready")}
            onError={() => {
              console.error("[photo-viewer] failed to load", photo.name);
              setState("failed");
            }}
          />
        )}
      </div>

      <div className="viewer-bar">
        <button type="button" className="viewer-icon" aria-label="Previous photo" onClick={() => step(-1)} disabled={index === 0}>
          <CaretLeft size={22} />
        </button>
        {onToggle ? (
          <button type="button" className="chip viewer-keep" aria-pressed={kept} onClick={() => onToggle(photo.id)}>
            {kept ? <Check size={16} /> : null}
            {kept ? "Keeping" : "Skipped"}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="viewer-icon" aria-label="Next photo" onClick={() => step(1)} disabled={index === photos.length - 1}>
          <CaretRight size={22} />
        </button>
      </div>
    </dialog>
  );
}
