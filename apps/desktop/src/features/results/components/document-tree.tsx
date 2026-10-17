import type { JsonValue } from "@odin-db/bindings";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@odin-db/ui/components/context-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { ChevronRight, ClipboardCopy, Copy, Filter } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { kindTextClass } from "@/components/ejson-cell";
import { describeEJson, type JsonObject } from "@/lib/ejson-display";
import { toShellSyntax } from "@/lib/shell-syntax";

/** Arrays longer than this show their first items and a "show all" button. */
const ARRAY_PREVIEW = 50;

/**
 * One document as an expandable tree: top-level fields are shown, nested
 * documents and arrays open on demand. EJSON wrappers (`{ $oid }`) are values.
 */
export function DocumentTree({
  document,
  expanded,
  onFilter,
}: {
  document: JsonObject;
  expanded: boolean;
  /** Offers "filter by this value" in the field menu; the menu exists only with it. */
  onFilter?: ((path: string, value: JsonValue) => void) | undefined;
}) {
  const fields = (
    <ul className="font-mono text-xs leading-5">
      {Object.entries(document).map(([key, value]) => (
        <Field key={key} name={key} path={key} value={value} depth={0} expandAll={expanded} />
      ))}
    </ul>
  );
  return onFilter ? (
    <FieldMenu document={document} onFilter={onFilter}>
      {fields}
    </FieldMenu>
  ) : (
    fields
  );
}

/**
 * One menu for the whole tree, aimed by the field under the pointer: a menu per field
 * would not scale to documents with hundreds of them.
 */
function FieldMenu({
  document,
  onFilter,
  children,
}: {
  document: JsonObject;
  onFilter: (path: string, value: JsonValue) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation("results");
  const [path, setPath] = useState<string | null>(null);
  const value = path === null ? undefined : valueAt(document, path);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) =>
          setPath(
            (event.target as HTMLElement).closest<HTMLElement>("[data-path]")?.dataset.path ?? null,
          )
        }
      >
        <div>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem
          disabled={path === null}
          onSelect={() => {
            if (path === null) return;
            void navigator.clipboard.writeText(path);
            toast.success(t("field.pathCopied", { path }));
          }}
        >
          <ClipboardCopy />
          <span className="truncate">{t("field.copyPath", { path: path ?? "" })}</span>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={value === undefined}
          onSelect={() => {
            if (value === undefined) return;
            void navigator.clipboard.writeText(toShellSyntax(value));
            toast.success(t("row.copied"));
          }}
        >
          <Copy />
          {t("field.copyValue")}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={path === null || value === undefined}
          onSelect={() => path !== null && value !== undefined && onFilter(path, value)}
        >
          <Filter />
          {t("field.filter")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The value at a dotted path, array indexes included: `items.0.sku`. */
function valueAt(document: JsonObject, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = document;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (current && typeof current === "object") current = (current as JsonObject)[segment];
    else return undefined;
  }
  return current;
}

function Field({
  name,
  path,
  value,
  depth,
  expandAll,
  index = false,
}: {
  name: string;
  path: string;
  value: JsonValue;
  depth: number;
  expandAll: boolean;
  index?: boolean;
}) {
  const { t } = useTranslation("common");
  const { kind, text } = describeEJson(value);
  const structure = kind === "document" || kind === "array";
  const [open, setOpen] = useState(expandAll);
  const [showAll, setShowAll] = useState(false);

  const entries: [string, JsonValue][] =
    kind === "array" && Array.isArray(value)
      ? value.map((item, position) => [String(position), item])
      : kind === "document" && typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.entries(value)
        : [];
  const visible = showAll ? entries : entries.slice(0, ARRAY_PREVIEW);
  const summary =
    kind === "array"
      ? t("value.items", { count: entries.length })
      : t("value.fields", { count: entries.length });

  return (
    <li>
      <div
        data-path={path}
        className="flex min-w-0 items-start gap-1"
        style={{ paddingLeft: depth * 16 }}
      >
        {structure ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={name}
            onClick={() => setOpen((value) => !value)}
            className="flex h-5 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className={cn("shrink-0", index ? "text-muted-foreground" : "text-foreground")}>
          {name}
          <span className="text-muted-foreground">:</span>
        </span>
        {structure ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className={cn("text-left", kindTextClass[kind], "hover:underline")}
          >
            {open ? (kind === "array" ? "[" : "{") : summary}
          </button>
        ) : (
          <span className={cn("min-w-0 break-all selectable", kindTextClass[kind])}>{text}</span>
        )}
      </div>
      {structure && open && (
        <ul>
          {visible.map(([key, item]) => (
            <Field
              key={key}
              name={key}
              path={`${path}.${key}`}
              value={item}
              depth={depth + 1}
              expandAll={expandAll}
              index={kind === "array"}
            />
          ))}
          {visible.length < entries.length && (
            <li style={{ paddingLeft: (depth + 1) * 16 + 20 }}>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="text-primary hover:underline"
              >
                {t("value.showAll", { count: entries.length })}
              </button>
            </li>
          )}
          <li className="text-muted-foreground" style={{ paddingLeft: depth * 16 + 20 }}>
            {kind === "array" ? "]" : "}"}
          </li>
        </ul>
      )}
    </li>
  );
}
