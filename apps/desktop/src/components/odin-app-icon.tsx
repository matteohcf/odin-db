import { useId } from "react";

/** The app icon, drawn as in branding/icon.svg, for the welcome page and About. */
export function OdinAppIcon({ className }: { className?: string }) {
  const gradient = useId();
  return (
    <svg viewBox="100 100 824 824" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f1f5f3" />
        </linearGradient>
      </defs>
      <rect
        x="102"
        y="102"
        width="820"
        height="820"
        rx="188"
        fill={`url(#${gradient})`}
        stroke="#dfe6e2"
        strokeWidth="5"
      />
      <g transform="translate(512 512) scale(0.92) translate(-512 -540)">
        <path fill="#00A35C" d="M300 640 C210 642 160 690 128 712 C200 724 262 718 316 700 Z" />
        <rect x="318" y="660" width="70" height="128" rx="32" fill="#00684A" />
        <rect x="600" y="660" width="70" height="128" rx="32" fill="#00684A" />
        <path fill="#00A35C" d="M282 714 C276 556 392 476 520 482 C650 488 732 572 736 714 Z" />
        <rect x="402" y="672" width="72" height="128" rx="32" fill="#00A35C" />
        <rect x="660" y="664" width="70" height="128" rx="32" fill="#00A35C" />
        <path
          d="M640 560 C706 470 690 380 760 292"
          fill="none"
          stroke="#00A35C"
          strokeWidth="96"
          strokeLinecap="round"
        />
        <ellipse cx="770" cy="282" rx="92" ry="66" fill="#00A35C" />
        <circle cx="452" cy="560" r="26" fill="#00684A" />
        <circle cx="530" cy="530" r="18" fill="#00684A" />
        <circle cx="380" cy="620" r="16" fill="#00684A" />
        <circle cx="792" cy="262" r="20" fill="#023430" />
        <circle cx="799" cy="255" r="7" fill="#ffffff" />
        <path
          d="M776 312 Q812 328 846 304"
          fill="none"
          stroke="#023430"
          strokeWidth="11"
          strokeLinecap="round"
        />
        <circle cx="830" cy="290" r="11" fill="#71F6BA" />
      </g>
    </svg>
  );
}
