import type { ProfileColor } from "@odin-db/bindings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { type Node, type NodeProps, NodeResizer } from "@xyflow/react";
import { X } from "lucide-react";
import { memo, useContext, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { IconAction } from "@/components/icon-action";
import { PROFILE_COLOR_CLASS, PROFILE_COLORS } from "@/lib/profile-colors";
import { AREA_MIN } from "../lib/annotations";
import { DiagramActions } from "./diagram-actions";

export type DiagramAreaNode = Node<
  { label: string; color: ProfileColor; autoFocus: boolean },
  "area"
>;

/** The strip an area is dragged by; the rest lets clicks and drags through to the canvas. */
export const AREA_HANDLE = "diagram-area-handle";

/** A named, tinted frame behind a group of collections. */
export const DiagramAreaNodeView = memo(function DiagramAreaNodeView({
  id,
  data,
  selected,
}: NodeProps<DiagramAreaNode>) {
  const { t } = useTranslation("diagram");
  const { onAreaChange, onAreaResize, onRemoveArea } = useContext(DiagramActions);
  const input = useRef<HTMLInputElement>(null);
  // An area just added is ready to be named.
  useEffect(() => {
    if (data.autoFocus) input.current?.focus();
  }, [data.autoFocus]);
  const colors = PROFILE_COLOR_CLASS[data.color];

  return (
    <div
      className={cn(
        "group size-full rounded-xl border",
        colors.wash,
        selected && "ring-2 ring-primary/30",
      )}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={AREA_MIN.width}
        minHeight={AREA_MIN.height}
        lineClassName="!border-transparent"
        handleClassName="!pointer-events-auto !size-2 !rounded-sm !border-primary !bg-card"
        onResizeEnd={(_, box) => onAreaResize(id, box)}
      />
      <div
        className={cn(
          AREA_HANDLE,
          "pointer-events-auto flex h-9 cursor-grab items-center gap-1.5 pr-1 pl-2.5 active:cursor-grabbing",
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            className="nodrag flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-foreground/10"
            aria-label={t("areaColor")}
          >
            <span className={cn("size-2.5 rounded-full", colors.bg)} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="grid grid-cols-5 gap-1 p-1.5">
            {PROFILE_COLORS.map((color) => (
              <DropdownMenuItem
                key={color}
                aria-label={t(`colors.${color}`)}
                className="size-7 justify-center p-0"
                onSelect={() => onAreaChange(id, { color })}
              >
                <span className={cn("size-3.5 rounded-full", PROFILE_COLOR_CLASS[color].bg)} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={input}
          value={data.label}
          onChange={(event) => onAreaChange(id, { label: event.target.value })}
          placeholder={t("areaPlaceholder")}
          aria-label={t("areaName")}
          // As wide as its text, so the rest of the strip still drags the area.
          size={Math.max(data.label.length, t("areaPlaceholder").length, 1)}
          className="nodrag min-w-0 max-w-full bg-transparent font-semibold text-[13px] text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground"
        />
        <span className="flex-1" />
        <IconAction
          label={t("removeArea")}
          onClick={() => onRemoveArea(id)}
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <X />
        </IconAction>
      </div>
    </div>
  );
});
