import type { ConnectionProfile } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Kbd } from "@odin-db/ui/components/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { ChevronsDownUp, ListFilter, Plus, Search, Server, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShortcut } from "@/hooks/use-shortcut";
import { label, SHORTCUTS } from "@/lib/shortcuts";
import { useProfiles } from "../api/queries";
import { useHealthEvents } from "../hooks/use-health-events";
import { useExplorer } from "../store/explorer-store";
import { CommandPalette } from "./command-palette";
import { DeleteProfileDialog } from "./delete-profile-dialog";
import { ProfileDialog } from "./profile-dialog";
import { ProfileNode } from "./profile-node";
import { TryLocalhostButton } from "./try-localhost-button";

const isMac = navigator.userAgent.includes("Mac");

type DialogState =
  | { type: "closed" }
  | { type: "create" }
  | { type: "edit"; profile: ConnectionProfile }
  | { type: "delete"; profile: ConnectionProfile };

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
  const filterInput = useRef<HTMLInputElement>(null);
  useShortcut("filterSidebar", () => filterInput.current?.focus());
  useHealthEvents();

  return (
    <aside className="flex h-full flex-col bg-sidebar" aria-label={t("explorer.label")}>
      <div className="flex h-9 shrink-0 items-center justify-between border-b pr-1.5 pl-3">
        <h2 className="font-medium text-muted-foreground text-xs">{t("explorer.title")}</h2>
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={t("explorer.collapseAll")}
                onClick={collapseAll}
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
              <Kbd>{isMac ? "⌘K" : "Ctrl K"}</Kbd>
            </TooltipContent>
          </Tooltip>
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
            }}
            placeholder={t("explorer.filter", { shortcut: label(SHORTCUTS.filterSidebar) })}
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

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
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
          <ul className="flex flex-col gap-px">
            {profiles.map((profile) => (
              <li key={profile.id}>
                <ProfileNode
                  profile={profile}
                  onEdit={() => setDialog({ type: "edit", profile })}
                  onDelete={() => setDialog({ type: "delete", profile })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ProfileDialog
        open={dialog.type === "create" || dialog.type === "edit"}
        profile={dialog.type === "edit" ? dialog.profile : undefined}
        onClose={closeDialog}
      />
      <DeleteProfileDialog
        profile={dialog.type === "delete" ? dialog.profile : undefined}
        onClose={closeDialog}
      />
    </aside>
  );
}
