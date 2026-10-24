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
export const PROFILE_COLOR_CLASS: Record<
  ProfileColor,
  { bg: string; border: string; tint: string }
> = {
  red: { bg: "bg-red-500", border: "border-red-500", tint: "bg-red-500/14 dark:bg-red-500/25" },
  orange: {
    bg: "bg-orange-500",
    border: "border-orange-500",
    tint: "bg-orange-500/14 dark:bg-orange-500/25",
  },
  yellow: {
    bg: "bg-yellow-400",
    border: "border-yellow-400",
    tint: "bg-yellow-400/14 dark:bg-yellow-400/25",
  },
  green: {
    bg: "bg-green-500",
    border: "border-green-500",
    tint: "bg-green-500/14 dark:bg-green-500/25",
  },
  teal: {
    bg: "bg-teal-500",
    border: "border-teal-500",
    tint: "bg-teal-500/14 dark:bg-teal-500/25",
  },
  blue: {
    bg: "bg-blue-500",
    border: "border-blue-500",
    tint: "bg-blue-500/14 dark:bg-blue-500/25",
  },
  purple: {
    bg: "bg-purple-500",
    border: "border-purple-500",
    tint: "bg-purple-500/14 dark:bg-purple-500/25",
  },
  pink: {
    bg: "bg-pink-500",
    border: "border-pink-500",
    tint: "bg-pink-500/14 dark:bg-pink-500/25",
  },
  gray: {
    bg: "bg-zinc-400",
    border: "border-zinc-400",
    tint: "bg-zinc-400/14 dark:bg-zinc-400/25",
  },
};
