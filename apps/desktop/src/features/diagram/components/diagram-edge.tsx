import type { DiagramLink } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
} from "@xyflow/react";
import { EyeOff, Trash2 } from "lucide-react";
import { memo, useContext } from "react";
import { useTranslation } from "react-i18next";
import { DiagramActions } from "./diagram-actions";

export type DiagramEdge = Edge<{ link: DiagramLink; manual: boolean; active: boolean }, "link">;

/**
 * A reference between two collections. Its field shows while either end is in focus; a selected
 * reference offers to remove it (drawn by hand) or hide it (inferred, but wrong).
 */
export const DiagramEdgeView = memo(function DiagramEdgeView({
  id,
  data,
  selected,
  markerEnd,
  style,
  ...geometry
}: EdgeProps<DiagramEdge>) {
  const { t } = useTranslation("diagram");
  const { onRemoveLink, onHideLink } = useContext(DiagramActions);
  const [path, labelX, labelY] = getSmoothStepPath(geometry);
  if (!data) return null;
  const { link, manual, active } = data;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={16}
        {...(markerEnd ? { markerEnd } : {})}
        {...(style ? { style } : {})}
      />
      {(active || selected) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex items-center gap-1 rounded-md border bg-card py-0.5 pr-0.5 pl-2 text-[11px] text-foreground shadow-xs"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              // Above the cards, which React Flow stacks from 0 (1000 when selected).
              zIndex: 1001,
            }}
          >
            <span className="font-mono">
              {link.field}
              {link.many && <span className="text-muted-foreground"> · 1:N</span>}
            </span>
            {manual && <span className="text-muted-foreground">· {t("drawn")}</span>}
            {selected ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 gap-1 px-1.5 text-[11px]"
                onClick={(event) => {
                  // The label is portalled, but React still bubbles the click to the edge.
                  event.stopPropagation();
                  if (manual) onRemoveLink(id);
                  else onHideLink(id);
                }}
              >
                {manual ? <Trash2 className="size-3" /> : <EyeOff className="size-3" />}
                {manual ? t("removeLink") : t("hideLink")}
              </Button>
            ) : (
              <span className="w-1.5" />
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
