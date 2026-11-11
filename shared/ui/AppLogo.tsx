// An app's logo (shared/brand/marks.ts): the same mark as its favicon, drawn inline.
import type { AppId } from "../supabase/hosted";
import { APP_NAMES } from "../apps";
import { MARK_COLORS, MARK_DOT, MARK_PATHS, MARK_STROKE } from "../brand/marks";

export function AppLogo({
  app,
  size = 28,
  label = false,
  className = "",
}: {
  app: AppId;
  size?: number;
  /** true: announce the app's name; false (default): decorative, next to its visible name */
  label?: boolean;
  className?: string;
}) {
  const c = MARK_COLORS[app];
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      {...(label
        ? { role: "img", "aria-label": `${APP_NAMES[app]} logo` }
        : { "aria-hidden": true })}
    >
      <rect width="64" height="64" rx="14" fill={c.tile} />
      <path
        d={MARK_PATHS[app]}
        fill="none"
        stroke={c.glyph}
        strokeWidth={MARK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r} fill={c.dot} />
    </svg>
  );
}
