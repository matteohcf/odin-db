import { cn } from "@odin-db/ui/lib/utils";
import { type KeyboardEvent, type PointerEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { clampSidebarWidth, DEFAULT_SETTINGS, SIDEBAR_WIDTH, useSettings } from "@/lib/settings";

const KEY_STEP = 16;

/** The sidebar's right edge: drag, or focus and use the arrow keys, to resize it. */
export function SidebarResizer() {
  const { t } = useTranslation("app");
  const width = clampSidebarWidth(useSettings((s) => s.sidebarWidth));
  const update = useSettings((s) => s.update);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    // The sidebar starts at the window's left edge, so the pointer's x is its width.
    update({ sidebarWidth: clampSidebarWidth(event.clientX) });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      update({ sidebarWidth: clampSidebarWidth(width + step) });
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      update({ sidebarWidth: event.key === "Home" ? SIDEBAR_WIDTH.min : SIDEBAR_WIDTH.max });
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter has no native element.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("sidebar.resize")}
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      tabIndex={0}
      title={t("sidebar.resizeHint")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => update({ sidebarWidth: DEFAULT_SETTINGS.sidebarWidth })}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-primary/50 focus-visible:after:bg-primary",
        dragging && "after:bg-primary",
      )}
    />
  );
}
