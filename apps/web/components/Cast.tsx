/**
 * Locus's cast, from the brand mark: the rider (blue dot), a landmark (gold) and
 * the door (white). Little faces for the landing page; they blink now and then.
 */
export type CastMember = "rider" | "landmark" | "door";

export function Cast({ who, size = 56 }: { who: CastMember; size?: number }) {
  return (
    <svg className={`cast cast-${who}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      {who === "rider" && <circle cx="32" cy="34" r="24" className="cast-body" />}
      {who === "landmark" && <rect x="10" y="12" width="44" height="44" rx="14" className="cast-body" />}
      {who === "door" && (
        <>
          <rect x="14" y="8" width="36" height="50" rx="10" className="cast-body" />
          <circle cx="42" cy="36" r="2.6" className="cast-knob" />
        </>
      )}
      <g className="cast-eyes">
        <ellipse cx={who === "door" ? 25 : 25} cy="33" rx="3.2" ry="4.2" />
        <ellipse cx={who === "door" ? 35 : 39} cy="33" rx="3.2" ry="4.2" />
      </g>
      <ellipse cx="21" cy="41" rx="3.4" ry="2" className="cast-blush" />
      <ellipse cx={who === "door" ? 39 : 43} cy="41" rx="3.4" ry="2" className="cast-blush" />
    </svg>
  );
}
