import { lazy, Suspense } from "react";
import type { ShellTab as ShellTabModel } from "@/features/workspace";

// xterm.js and its WebGL renderer are large: they load with the first shell tab.
const ShellTabView = lazy(() =>
  import("./shell-tab").then((module) => ({ default: module.ShellTab })),
);

export function LazyShellTab({ tab }: { tab: ShellTabModel }) {
  return (
    <Suspense fallback={null}>
      <ShellTabView tab={tab} />
    </Suspense>
  );
}
