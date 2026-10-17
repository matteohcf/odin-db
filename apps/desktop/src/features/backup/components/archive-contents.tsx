import type { ConnectionId, RestoreSource } from "@odin-db/bindings";
import { commands } from "@odin-db/bindings";
import { Checkbox } from "@odin-db/ui/components/checkbox";
import { Label } from "@odin-db/ui/components/label";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Database, Loader2, Table2 } from "lucide-react";
import { useEffect, useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { call, errorMessage } from "@/lib/ipc";

interface ArchiveContentsProps {
  connectionId: ConnectionId;
  token: string;
  source: RestoreSource;
  selected: ReadonlySet<string> | null;
  /** `null` until the contents are known; then the namespaces to restore. */
  onChange: (selected: Set<string>, all: readonly string[]) => void;
  /** Preselects only this database's collections. */
  database?: string | undefined;
}

/** What a backup contains, as a checklist of databases and collections. */
export function ArchiveContents({
  connectionId,
  token,
  source,
  selected,
  onChange,
  database,
}: ArchiveContentsProps) {
  const { t } = useTranslation("backup");
  const base = useId();
  const contents = useQuery({
    queryKey: ["restore-contents", token],
    queryFn: () => call(commands.restoreContents(connectionId, token, source)),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const namespaces = contents.data;

  const groups = useMemo(() => {
    const byDatabase = new Map<string, string[]>();
    for (const namespace of namespaces ?? []) {
      const [db = ""] = namespace.split(".");
      byDatabase.set(db, [...(byDatabase.get(db) ?? []), namespace]);
    }
    return [...byDatabase].sort(([a], [b]) => a.localeCompare(b));
  }, [namespaces]);

  // Start with everything, or with the database the dialog was opened from.
  useEffect(() => {
    if (!namespaces || selected) return;
    const initial = database
      ? namespaces.filter((namespace) => namespace.startsWith(`${database}.`))
      : namespaces;
    onChange(new Set(initial.length > 0 ? initial : namespaces), namespaces);
  }, [namespaces, selected, database, onChange]);

  if (contents.isPending) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        {t("contents.reading")}
      </p>
    );
  }
  if (contents.error) {
    return (
      <p className="flex items-start gap-1.5 text-warning text-xs selectable">
        <CircleAlert className="mt-px size-3.5 shrink-0" />
        {t("contents.failed", { message: errorMessage(contents.error) })}
      </p>
    );
  }
  if (!namespaces || !selected) return null;
  if (namespaces.length === 0) {
    return <p className="text-muted-foreground text-xs">{t("contents.empty")}</p>;
  }

  const toggle = (items: readonly string[], on: boolean) => {
    const next = new Set(selected);
    for (const item of items) {
      if (on) next.add(item);
      else next.delete(item);
    }
    onChange(next, namespaces);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-xs">
        {t("contents.summary", {
          count: namespaces.length,
          databases: groups.length,
          selected: selected.size,
        })}
      </p>
      <ul className="max-h-48 overflow-y-auto rounded-md border p-1.5 text-sm">
        {groups.map(([db, items]) => {
          const chosen = items.filter((item) => selected.has(item)).length;
          const state = chosen === items.length ? true : chosen === 0 ? false : "indeterminate";
          return (
            <li key={db}>
              <div className="flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-accent/60">
                <Checkbox
                  id={`${base}-${db}`}
                  checked={state}
                  onCheckedChange={() => toggle(items, state !== true)}
                />
                <Database className="size-3.5 text-muted-foreground" />
                <Label htmlFor={`${base}-${db}`} className="flex-1 font-medium">
                  {db}
                </Label>
                <span className="text-muted-foreground text-xs">
                  {chosen}/{items.length}
                </span>
              </div>
              <ul>
                {items.map((item) => (
                  <li key={item}>
                    <div className="flex items-center gap-2 rounded-sm py-0.5 pr-1.5 pl-7 hover:bg-accent/60">
                      <Checkbox
                        id={`${base}-${item}`}
                        checked={selected.has(item)}
                        onCheckedChange={(checked) => toggle([item], checked === true)}
                      />
                      <Table2 className="size-3.5 text-muted-foreground" />
                      <Label
                        htmlFor={`${base}-${item}`}
                        className="flex-1 truncate font-mono font-normal text-xs"
                      >
                        {item.slice(db.length + 1)}
                      </Label>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
