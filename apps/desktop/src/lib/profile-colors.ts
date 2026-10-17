import type { ProfileColor } from "@odin-db/bindings";

export const PROFILE_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "gray",
] as const satisfies readonly ProfileColor[];

/** Literal class names, so Tailwind finds them when scanning the sources. */
export const PROFILE_COLOR_CLASS: Record<ProfileColor, { bg: string; border: string }> = {
  red: { bg: "bg-red-500", border: "border-red-500" },
  orange: { bg: "bg-orange-500", border: "border-orange-500" },
  yellow: { bg: "bg-yellow-400", border: "border-yellow-400" },
  green: { bg: "bg-green-500", border: "border-green-500" },
  teal: { bg: "bg-teal-500", border: "border-teal-500" },
  blue: { bg: "bg-blue-500", border: "border-blue-500" },
  purple: { bg: "bg-purple-500", border: "border-purple-500" },
  pink: { bg: "bg-pink-500", border: "border-pink-500" },
  gray: { bg: "bg-zinc-400", border: "border-zinc-400" },
};
