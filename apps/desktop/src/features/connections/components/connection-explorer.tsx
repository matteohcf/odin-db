import {
  type ConnectionProfile,
  type ConnectionsFile,
  commands,
  type ImportedProfiles,
  type ProfileId,
} from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import { Kbd } from "@odin-db/ui/components/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import {
  ChevronsDownUp,
  FileDown,
  FileUp,
  ListFilter,
  LocateFixed,
  MoreHorizontal,
  Plus,
  Search,
  Server,
  Unplug,
  X,
} from "lucide-react";
import { type CSSProperties, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useTabs } from "@/features/workspace";
import { useShortcut } from "@/hooks/use-shortcut";
import { call, errorMessage } from "@/lib/ipc";
import { TREE_ROW_HEIGHTS, useSettings } from "@/lib/settings";
import { label, SHORTCUTS } from "@/lib/shortcuts";
import { useDisconnectAll, useExportConnections, useImportConnections } from "../api/mutations";
import { useConnections, useProfiles } from "../api/queries";
import { useHealthEvents } from "../hooks/use-health-events";
import { collapsedGroupKey } from "../lib/tree-rows";
import { useExplorer } from "../store/explorer-store";
import { CommandPalette } from "./command-palette";
import { DeleteProfileDialog } from "./delete-profile-dialog";
import { FavoritesSection } from "./favorites-section";
import { HostKeyDialog } from "./host-key-dialog";
import { ImportPassphraseDialog } from "./import-passphrase-dialog";
import { ProfileDialog } from "./profile-dialog";
import { TreeList } from "./tree-list";
import { TryLocalhostButton } from "./try-localhost-button";

type DialogState =
  | { type: "closed" }
  | { type: "create"; group?: string }
  | { type: "edit"; profile: ConnectionProfile }
  | { type: "delete"; profile: ConnectionProfile }
  | { type: "passphrase"; file: ConnectionsFile };

/** Sidebar: saved connections, expanding into databases and collections. */
export function ConnectionExplorer() {
  const { t } = useTranslation("connections");
  const { data: profiles, error, isPending } = useProfiles();
  const [dialog, setDialog] = useState<DialogState>({ type: "closed" });
  const closeDialog = () => setDialog({ type: "closed" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const filter = useExplorer((s) => s.filter);
  const setFilter = useExplorer((s) => s.setFilter);
  const collapseAll = useExplorer((s) => s.collapseAll);
  const reveal = useExplorer((s) => s.reveal);
  const activeCollection = useTabs((s) => {
    const tab = s.tabs.find((candidate) => candidate.id === s.activeTabId);
    return tab?.kind === "collection" ? tab : undefined;
  });
  const filterInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const density = useSettings((s) => s.sidebarDensity);
  useShortcut("filterSidebar", () => filterInput.current?.focus());
  useHealthEvents();
  const importMutation = useImportConnections();
  const { data: connections } = useConnections();
  const disconnectAll = useDisconnectAll();
  const exportMutation = useExportConnections();

  function reportImported(result: ImportedProfiles) {
    toast.success(
      t("explorer.imported", { count: result.created.length, skipped: result.skipped ?? 0 }),
    );
  }

  async function importConnections() {
    try {
      const file = await call(commands.chooseConnectionsFile());
      if (!file) return;
      if (file.needsPassphrase) {
        setDialog({ type: "passphrase", file });
        return;
      }
      reportImported(await importMutation.mutateAsync({ token: file.token, passphrase: null }));
    } catch (error) {
      toast.error(t("explorer.importFailed", { message: errorMessage(error) }));
    }
  }

  async function exportConnections(ids: ProfileId[]) {
    try {
      const path = await exportMutation.mutateAsync(ids);
      if (path) toast.success(t("explorer.exported", { path }));
    } catch (error) {
      toast.error(t("explorer.exportFailed", { message: errorMessage(error) }));
    }
  }

  return (
    <aside
      className="flex h-full flex-col bg-sidebar"
      aria-label={t("explorer.label")}
      style={{ "--tree-row": `${TREE_ROW_HEIGHTS[density]}px` } as CSSProperties}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b pr-1.5 pl-3">
        <h2 className="flex items-baseline gap-1.5 font-medium text-muted-foreground text-xs">
          {t("explorer.title")}
          {profiles && profiles.length > 0 && (
            <span className="font-normal tabular-nums opacity-70">{profiles.length}</span>
          )}
        </h2>
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={t("explorer.locate")}
                disabled={!activeCollection}
                onClick={() =>
                  activeCollection &&
                  reveal(
                    activeCollection.profileId,
                    activeCollection.database,
                    activeCollection.collection,
                  )
                }
              >
                <LocateFixed className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("explorer.locate")} <Kbd>{label(SHORTCUTS.revealInSidebar)}</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={t("explorer.collapseAll")}
                onClick={() =>
                  collapseAll(
                    [...new Set(profiles?.flatMap((profile) => profile.group ?? []))].map(
                      collapsedGroupKey,
                    ),
                  )
                }
              >
                <ChevronsDownUp className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("explorer.collapseAll")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={t("palette.title")}
                onClick={() => setPaletteOpen(true)}
              >
                <Search className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-2">
              {t("palette.hint")}
              <Kbd>{label(SHORTCUTS.palette)}</Kbd>
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={t("explorer.more")}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => void importConnections()}>
                <FileUp />
                {t("explorer.import")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!profiles?.length}
                onSelect={() => void exportConnections([])}
              >
                <FileDown />
                {t("explorer.exportAll")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!connections?.length}
                onSelect={() =>
                  disconnectAll.mutate((connections ?? []).map((connection) => connection.id))
                }
              >
                <Unplug />
                {t("explorer.disconnectAll")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={t("explorer.new")}
                onClick={() => setDialog({ type: "create" })}
              >
                <Plus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("explorer.new")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewConnection={() => setDialog({ type: "create" })}
      />

      {profiles && profiles.length > 0 && (
        <div className="relative shrink-0 px-1.5 pt-1.5">
          <ListFilter className="pointer-events-none absolute top-1/2 left-3.5 mt-[3px] size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={filterInput}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setFilter("");
                event.currentTarget.blur();
              }
              // From the filter straight into the (filtered) tree.
              if (event.key === "ArrowDown") {
                event.preventDefault();
                scroller.current
                  ?.querySelector<HTMLElement>("li[data-index] button:not([aria-haspopup])")
                  ?.focus();
              }
            }}
            placeholder={t("explorer.filter")}
            title={`${t("explorer.filterLabel")} (${label(SHORTCUTS.filterSidebar)})`}
            aria-label={t("explorer.filterLabel")}
            spellCheck={false}
            className="h-7 w-full rounded-md border bg-background pr-7 pl-7 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
          />
          {filter && (
            <button
              type="button"
              aria-label={t("explorer.clearFilter")}
              onClick={() => setFilter("")}
              className="absolute top-1/2 right-3 mt-[3px] -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      )}

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto p-1.5">
        {error ? (
          <p className="p-2 text-destructive text-xs">
            {t("explorer.loadFailed", { message: error.message })}
          </p>
        ) : isPending ? null : profiles.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-2 py-6">
            <Server className="size-5 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <p className="font-medium">{t("explorer.emptyTitle")}</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("explorer.emptyBody")}
              </p>
            </div>
            <div className="flex flex-col items-stretch gap-2 self-stretch">
              <Button size="sm" onClick={() => setDialog({ type: "create" })}>
                <Plus />
                {t("explorer.new")}
              </Button>
              <TryLocalhostButton />
            </div>
          </div>
        ) : (
          <>
            <FavoritesSection />
            <TreeList
              profiles={profiles}
              scrollRef={scroller}
              onExport={(profile) => void exportConnections([profile.id])}
              onEdit={(profile) => setDialog({ type: "edit", profile })}
              onDelete={(profile) => setDialog({ type: "delete", profile })}
              onNewConnection={(group) => setDialog({ type: "create", group })}
            />
          </>
        )}
      </div>

      <ProfileDialog
        open={dialog.type === "create" || dialog.type === "edit"}
        profile={dialog.type === "edit" ? dialog.profile : undefined}
        defaultGroup={dialog.type === "create" ? dialog.group : undefined}
        onClose={closeDialog}
      />
      <HostKeyDialog />
      <DeleteProfileDialog
        profile={dialog.type === "delete" ? dialog.profile : undefined}
        onClose={closeDialog}
      />
      {dialog.type === "passphrase" && (
        <ImportPassphraseDialog
          file={dialog.file}
          onImported={(result) => {
            closeDialog();
            reportImported(result);
          }}
          onClose={closeDialog}
        />
      )}
    </aside>
  );
}
