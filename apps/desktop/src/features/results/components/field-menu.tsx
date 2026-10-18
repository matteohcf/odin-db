import type { JsonValue } from "@odin-db/bindings";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@odin-db/ui/components/context-menu";
import { ClipboardCopy, Copy, Filter } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { JsonObject } from "@/lib/ejson-display";
import { toShellSyntax } from "@/lib/shell-syntax";

/**
 * One menu for the whole tree, aimed by the field under the pointer: a menu per field
 * would not scale to documents with hundreds of them.
 */
export function FieldMenu({
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
