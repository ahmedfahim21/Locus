/**
 * The Locus mark (DESIGN.md "Brand"): a route bending into an "L", from the
 * rider (blue) past a landmark (gold) to the door (white), on a Sadak-dark tile.
 * Same drawing as app/icon.svg.
 */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect x="0.5" y="0.5" width="63" height="63" rx="14.5" fill="#171b21" stroke="#ffffff" strokeOpacity="0.1" />
      <path d="M6 54H58M10 24H30M52 6V30" stroke="#262b33" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M20 15V35a11 11 0 0 0 11 11H45" fill="none" stroke="#0b0d10" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 15V35a11 11 0 0 0 11 11H45" fill="none" stroke="#5ab0ff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="15" r="6.5" fill="#5ab0ff" stroke="#ffffff" strokeWidth="2.6" />
      <circle cx="20" cy="31" r="3.8" fill="#f3d27a" stroke="#0b0d10" strokeWidth="2" />
      <circle cx="46" cy="46" r="7.5" fill="#ffffff" stroke="#0b0d10" strokeWidth="3" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-word" style={{ fontSize: size * 0.72 }}>Locus</span>
    </span>
  );
}
