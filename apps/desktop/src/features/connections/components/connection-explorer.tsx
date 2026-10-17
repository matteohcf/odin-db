import type { ConnectionProfile } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Kbd } from "@odin-db/ui/components/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { Plus, Search, Server } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useProfiles } from "../api/queries";
import { useHealthEvents } from "../hooks/use-health-events";
import { CommandPalette } from "./command-palette";
import { DeleteProfileDialog } from "./delete-profile-dialog";
import { ProfileDialog } from "./profile-dialog";
import { ProfileNode } from "./profile-node";

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
            <Button size="sm" onClick={() => setDialog({ type: "create" })}>
              <Plus />
              {t("explorer.new")}
            </Button>
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
