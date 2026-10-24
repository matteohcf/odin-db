import type { DroppedFile } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { cn } from "@odin-db/ui/lib/utils";
import {
  CircleAlert,
  FileArchive,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileUp,
  Folder,
  FolderUp,
  Loader2,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFileDrop } from "@/hooks/use-file-drop";
import { errorMessage } from "@/lib/ipc";

function iconFor(name: string, kind: "file" | "folder") {
  if (kind === "folder") return Folder;
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (extension === "csv") return FileSpreadsheet;
  if (extension === "json" || extension === "ndjson" || extension === "jsonl") return FileJson;
  if (extension === "gz" || extension === "archive") return FileArchive;
  return FileText;
}

interface FilePickerProps {
  kind: "file" | "folder";
  /** The empty state's invitation, e.g. "Drop a JSON, NDJSON or CSV file here". */
  title: string;
  /** What fits, e.g. "Documents are read and previewed before anything is written." */
  hint?: string;
  browseLabel: string;
  /** Opens the system dialog (from Rust) and uses what was chosen. */
  onBrowse: () => Promise<void>;
  /** Uses a file or folder dropped on the window; may throw to report it does not fit. */
  onDrop: (file: DroppedFile) => Promise<void>;
  /** What was chosen, shown instead of the drop area. */
  selected?: { name: string; detail?: ReactNode } | null;
  onClear?: () => void;
  /** A problem reported by the caller, e.g. the file could not be read. */
  error?: string | null;
  className?: string;
}

/**
 * Choosing a file or folder: drop it anywhere on the window or browse for it. The path stays in
 * the backend (ADR-0051); this only ever sees names and tokens.
 */
export function FilePicker({
  kind,
  title,
  hint,
  browseLabel,
  onBrowse,
  onDrop,
  selected,
  onClear,
  error,
  className,
}: FilePickerProps) {
  const { t } = useTranslation("common");
  const [working, setWorking] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  async function use(action: () => Promise<void>) {
    setDropError(null);
    setWorking(true);
    try {
      await action();
    } catch (reason) {
      setDropError(errorMessage(reason));
    } finally {
      setWorking(false);
    }
  }

  const { hovering } = useFileDrop((files) => {
    const [first] = files;
    if (!first) return;
    if (files.length > 1) {
      setDropError(t("filePicker.oneAtATime"));
      return;
    }
    if (first.directory !== (kind === "folder")) {
      setDropError(t(kind === "folder" ? "filePicker.needsFolder" : "filePicker.needsFile"));
      return;
    }
    void use(() => onDrop(first));
  });
  const problem = dropError ?? error ?? null;
  const Icon = selected ? iconFor(selected.name, kind) : kind === "folder" ? FolderUp : FileUp;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {selected ? (
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors",
            hovering && "border-primary bg-primary/5",
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            {working ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium text-sm" title={selected.name}>
              {selected.name}
            </span>
            {selected.detail && (
              <span className="truncate text-muted-foreground text-xs">{selected.detail}</span>
            )}
          </div>
          <Button variant="ghost" size="sm" disabled={working} onClick={() => void use(onBrowse)}>
            {t("filePicker.change")}
          </Button>
          {onClear && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("filePicker.clear", { name: selected.name })}
              onClick={() => {
                setDropError(null);
                onClear();
              }}
            >
              <X />
            </Button>
          )}
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors",
            hovering ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <span
            className={cn(
              "flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-[transform,background-color,color] duration-200 ease-out motion-reduce:transition-none",
              hovering && "scale-110 bg-primary/15 text-primary",
            )}
          >
            {working ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
          </span>
          <div className="flex flex-col gap-1">
            <p className="font-medium text-sm">{hovering ? t("filePicker.release") : title}</p>
            {hint && <p className="max-w-sm text-muted-foreground text-xs">{hint}</p>}
          </div>
          <Button variant="outline" size="sm" disabled={working} onClick={() => void use(onBrowse)}>
            {browseLabel}
          </Button>
        </div>
      )}
      {problem && (
        <p role="alert" className="flex items-start gap-2 text-destructive text-xs selectable">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {problem}
        </p>
      )}
    </div>
  );
}
