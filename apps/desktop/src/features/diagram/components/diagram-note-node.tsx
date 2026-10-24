import { cn } from "@odin-db/ui/lib/utils";
import { type Node, type NodeProps, NodeResizer } from "@xyflow/react";
import { GripHorizontal, X } from "lucide-react";
import { memo, useContext, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { IconAction } from "@/components/icon-action";
import { NOTE_MIN } from "../lib/annotations";
import { DiagramActions } from "./diagram-actions";

export type DiagramNoteNode = Node<{ text: string; autoFocus: boolean }, "note">;

/** A sticky note on the diagram: dragged by its top strip, resized when selected. */
export const DiagramNoteNodeView = memo(function DiagramNoteNodeView({
  id,
  data,
  selected,
}: NodeProps<DiagramNoteNode>) {
  const { t } = useTranslation("diagram");
  const { onNoteChange, onNoteResize, onRemoveNote, onFocused } = useContext(DiagramActions);
  const input = useRef<HTMLTextAreaElement>(null);
  // A note just added is ready to type into.
  useEffect(() => {
    if (!data.autoFocus) return;
    input.current?.focus();
    onFocused(id);
  }, [data.autoFocus, id, onFocused]);

  return (
    <div
      className={cn(
        "group flex size-full flex-col rounded-lg border border-warning/45 bg-[color-mix(in_oklab,var(--warning)_16%,var(--card))] shadow-sm",
        selected && "ring-2 ring-warning/30",
      )}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={NOTE_MIN.width}
        minHeight={NOTE_MIN.height}
        onResizeEnd={(_, box) => onNoteResize(id, box)}
        lineClassName="!border-transparent"
        handleClassName="!size-2 !rounded-sm !border-warning !bg-card"
      />
      <div className="flex h-6 shrink-0 cursor-grab items-center justify-between pr-0.5 pl-2 text-warning/70 active:cursor-grabbing">
        <GripHorizontal className="size-3.5" />
        <IconAction
          label={t("removeNote")}
          onClick={() => onRemoveNote(id)}
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <X />
        </IconAction>
      </div>
      <textarea
        ref={input}
        value={data.text}
        onChange={(event) => onNoteChange(id, event.target.value)}
        placeholder={t("notePlaceholder")}
        aria-label={t("note")}
        className="nodrag nowheel min-h-0 flex-1 resize-none bg-transparent px-2.5 pb-2 text-[13px] text-foreground leading-snug outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
});
