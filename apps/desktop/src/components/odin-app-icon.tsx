import { useId } from "react";
import { RAVEN_EYE, RAVEN_PATH } from "@/lib/brand";

/** The app icon (branding/icon.svg) for the welcome page and About. */
export function OdinAppIcon({ className }: { className?: string }) {
  const gradient = useId();
  return (
    <svg viewBox="100 100 824 824" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b3591" />
          <stop offset="1" stopColor="#16133f" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="190" fill={`url(#${gradient})`} />
      <g transform="translate(-66 -50)">
        <path fill="#ffffff" d={RAVEN_PATH} />
        <path fill="#241f63" d={RAVEN_EYE} />
      </g>
    </svg>
  );
}
