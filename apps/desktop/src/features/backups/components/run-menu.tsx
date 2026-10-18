import type { BackupRun } from "@odin-db/bindings";
import { commands } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import { FolderOpen, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { call, errorMessage } from "@/lib/ipc";

export function RunMenu({
  run,
  onRestore,
  onDelete,
}: {
  run: BackupRun;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("backups");
  const usable = run.status === "completed" && run.archiveExists;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label={t("run.actions")}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem disabled={!usable} onSelect={onRestore}>
          <RotateCcw />
          {t("run.restore")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!usable}
          onSelect={() =>
            void call(commands.revealBackup(run.id)).catch((error: unknown) =>
              toast.error(errorMessage(error)),
            )
          }
        >
          <FolderOpen />
          {t("run.reveal")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={run.status === "running"}
          onSelect={onDelete}
        >
          <Trash2 />
          {t("run.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
