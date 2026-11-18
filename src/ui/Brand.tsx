const RED = '#D9352B';

/** Brand mark: a single-colour red 2-stud brick in profile. */
export function Mark({ size = 34, color = RED }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size * 0.78} viewBox="0 0 46 36" aria-hidden>
      <g fill={color}>
        <rect x="9" y="2" width="10" height="8" rx="2.2" />
        <rect x="27" y="2" width="10" height="8" rx="2.2" />
        <rect x="3" y="8" width="40" height="26" rx="5" />
      </g>
    </svg>
  );
}
export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 select-none">
      <Mark />
      <span className={`display text-[18px] leading-none ${dark ? 'text-white' : 'text-ink'}`}>Brick Atelier</span>
    </span>
  );
}
