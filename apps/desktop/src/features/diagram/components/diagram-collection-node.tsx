import { cn } from "@odin-db/ui/lib/utils";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { ArrowUpRight, Clock, Eye, Folder, KeyRound, Link2 } from "lucide-react";
import { memo, useContext } from "react";
import { useTranslation } from "react-i18next";
import { kindTextClass } from "@/components/ejson-cell";
import { IconAction } from "@/components/icon-action";
import { kindOfBsonType } from "@/lib/ejson-display";
import { formatCompact } from "@/lib/format";
import {
  type DiagramNodeData,
  HEADER_HANDLE,
  HEADER_HEIGHT,
  NODE_WIDTH,
  ROW_HEIGHT,
} from "../lib/diagram-graph";
import { DiagramActions } from "./diagram-actions";

const kindIcon = { collection: Folder, view: Eye, timeseries: Clock } as const;
// Handles sit on the card's edge; React Flow needs them, the user does not.
const handleClass = "!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent";

export type DiagramCollectionNode = Node<DiagramNodeData, "collection">;

/** One collection in the diagram: its name and size, then its fields and their types. */
export const DiagramCollectionNodeView = memo(function DiagramCollectionNodeView({
  data,
  selected,
}: NodeProps<DiagramCollectionNode>) {
  const { t, i18n } = useTranslation("diagram");
  const { onOpen } = useContext(DiagramActions);
  const Icon = kindIcon[data.kind];

  return (
    <div
      className={cn(
        "group rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow",
        selected ? "border-primary ring-2 ring-primary/30" : "hover:shadow-md",
      )}
      style={{ width: NODE_WIDTH }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={handleClass}
        style={{ top: HEADER_HEIGHT / 2 }}
      />
      <Handle
        type="source"
        id={HEADER_HANDLE}
        position={Position.Right}
        className={handleClass}
        style={{ top: HEADER_HEIGHT / 2 }}
      />
      <div
        className="flex items-center gap-2 border-b px-3"
        style={{ height: HEADER_HEIGHT }}
        title={data.incoming > 0 ? t("incoming", { count: data.incoming }) : undefined}
      >
        <Icon className="size-3.5 shrink-0 text-foreground/60" />
        <span className="min-w-0 flex-1 truncate font-semibold text-[13px]">{data.name}</span>
        {data.kind !== "collection" && (
          <span className="shrink-0 text-[11px] text-muted-foreground">{t(data.kind)}</span>
        )}
        <span
          className="shrink-0 text-[11px] text-muted-foreground tabular-nums group-hover:hidden"
          title={t("documents", { count: data.documents })}
        >
          {formatCompact(data.documents, i18n.language)}
        </span>
        <span className="hidden group-hover:flex">
          <IconAction
            label={t("open", { collection: data.name })}
            onClick={() => onOpen(data.name)}
          >
            <ArrowUpRight />
          </IconAction>
        </span>
      </div>
      <ul className="py-1 font-mono text-xs">
        {data.fields.map((field) => {
          const kind = kindOfBsonType(field.type);
          return (
            <li
              key={field.path}
              className="relative flex items-center gap-1.5 pr-3"
              style={{ height: ROW_HEIGHT, paddingLeft: 12 + field.depth * 12 }}
              title={
                field.references
                  ? `${field.path} → ${field.references}${field.many ? ` (${t("many")})` : ""}`
                  : `${field.path}: ${field.type} · ${Math.round(field.frequency * 100)}%`
              }
            >
              {field.path === "_id" ? (
                <KeyRound className="size-3 shrink-0 text-type-object-id" />
              ) : field.references ? (
                <Link2 className="size-3 shrink-0 text-primary" />
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  // Fields missing from part of the sample read as optional.
                  field.frequency < 1 ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {field.label ?? field.path.split(".").at(-1)}
                {field.many && <span className="text-muted-foreground">[]</span>}
              </span>
              {field.references ? (
                <span className="max-w-24 shrink-0 truncate rounded-sm bg-primary/10 px-1 text-[11px] text-primary">
                  {t("references", { collection: field.references })}
                </span>
              ) : (
                <span className={cn("shrink-0 text-[11px]", kindTextClass[kind])}>
                  {field.type}
                </span>
              )}
              {field.references && (
                <Handle
                  type="source"
                  id={field.path}
                  position={Position.Right}
                  className={handleClass}
                />
              )}
            </li>
          );
        })}
        {data.error ? (
          <li
            className="flex items-center px-3 font-sans text-[11px] text-destructive"
            style={{ height: ROW_HEIGHT }}
            title={data.error}
          >
            <span className="truncate">{t("notSampled", { message: data.error })}</span>
          </li>
        ) : (
          data.hidden > 0 && (
            <li
              className="flex items-center px-3 font-sans text-[11px] text-muted-foreground"
              style={{ height: ROW_HEIGHT }}
            >
              {t("more", { count: data.hidden })}
            </li>
          )
        )}
      </ul>
    </div>
  );
});
