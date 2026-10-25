import type { ConnectionProfile } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import { Input } from "@odin-db/ui/components/input";
import { FileDown, FileUp, MoreHorizontal, Plus, Search, Server } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/empty-state";
import { TREE_ROW_HEIGHTS, useSettings } from "@/lib/settings";
import { buildTreeRows } from "../lib/tree-rows";
import { useExplorer } from "../store/explorer-store";
import { GroupNode } from "./group-node";
import { SavedProfileRow } from "./saved-profile-row";

interface ConnectionManagerProps {
  /** Undefined while loading. */
  profiles: readonly ConnectionProfile[] | undefined;
  onEdit: (profile: ConnectionProfile) => void;
  onDelete: (profile: ConnectionProfile) => void;
  onExport: (profile: ConnectionProfile) => void;
  onExportAll: () => void;
  onImport: () => void;
  onNewConnection: (group?: string) => void;
}

// A row's own button, not its "…" menu.
const MAIN_BUTTON = "button:not([aria-haspopup])";

/** Every saved connection, in its group; picking one connects it (ADR-0058). */
export function ConnectionManager(props: ConnectionManagerProps) {
  const { t } = useTranslation("connections");
  const open = useExplorer((s) => s.managerOpen);
  const setOpen = useExplorer((s) => s.setManagerOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("manager.title")}</DialogTitle>
          <DialogDescription>{t("manager.description")}</DialogDescription>
        </DialogHeader>
        {/* Mounted while open only, so the search starts empty each time. */}
        {open && <ManagerBody {...props} onOpened={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ManagerBody({
  profiles,
  onEdit,
  onDelete,
  onExport,
  onExportAll,
  onImport,
  onNewConnection,
  onOpened,
}: ConnectionManagerProps & { onOpened: () => void }) {
  const { t } = useTranslation("connections");
  const [search, setSearch] = useState("");
  const filter = search.trim().toLowerCase();
  const expanded = useExplorer((s) => s.expanded);
  const density = useSettings((s) => s.sidebarDensity);
  const list = useRef<HTMLUListElement>(null);
  // The tree's rows without any catalog: groups and profiles, filtered the same way.
  const rows = useMemo(
    () =>
      buildTreeRows({
        profiles: profiles ?? [],
        connectionOf: () => undefined,
        expanded,
        filter,
        databases: () => ({ data: undefined, error: null }),
        collections: () => ({ data: undefined, error: null }),
      }),
    [profiles, expanded, filter],
  );

  const buttons = () => [
    ...(list.current?.querySelectorAll<HTMLElement>(`li ${MAIN_BUTTON}`) ?? []),
  ];

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if ((event.target as HTMLElement).closest("[aria-haspopup]")) return;
    const all = buttons();
    const index = all.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    all[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                buttons()[0]?.focus();
              }
              // Enter picks the first connection that matches.
              if (event.key === "Enter" && filter) {
                event.preventDefault();
                const index = rows.findIndex((row) => row.kind === "profile");
                list.current
                  ?.querySelector<HTMLElement>(`li[data-index="${index}"] ${MAIN_BUTTON}`)
                  ?.click();
              }
            }}
            placeholder={t("manager.search")}
            aria-label={t("manager.search")}
            spellCheck={false}
            className="h-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <Button size="sm" onClick={() => onNewConnection()}>
          <Plus />
          {t("explorer.new")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-8" aria-label={t("explorer.more")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={onImport}>
              <FileUp />
              {t("explorer.import")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!profiles?.length} onSelect={onExportAll}>
              <FileDown />
              {t("explorer.exportAll")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        className="min-h-48 flex-1 overflow-y-auto rounded-md border bg-sidebar py-1"
        style={{ "--tree-row": `${TREE_ROW_HEIGHTS[density]}px` } as CSSProperties}
      >
        {!profiles ? null : profiles.length === 0 ? (
          <EmptyState icon={Server} title={t("explorer.emptyTitle")}>
            {t("explorer.emptyBody")}
          </EmptyState>
        ) : rows.length === 0 ? (
          <p className="p-3 text-muted-foreground text-xs">
            {t("explorer.noMatch", { filter: search.trim() })}
          </p>
        ) : (
          <ul
            ref={list}
            aria-label={t("manager.title")}
            className="flex flex-col gap-px"
            onKeyDown={onListKeyDown}
          >
            {rows.map((row, index) => (
              <li key={row.key} data-index={index}>
                {row.kind === "group" ? (
                  <GroupNode
                    name={row.name}
                    count={row.count}
                    collapsed={row.collapsed}
                    onNewConnection={onNewConnection}
                  />
                ) : row.kind === "profile" ? (
                  <SavedProfileRow
                    indent={row.indent}
                    profile={row.profile}
                    onOpened={onOpened}
                    onEdit={() => onEdit(row.profile)}
                    onDelete={() => onDelete(row.profile)}
                    onExport={() => onExport(row.profile)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
