import { Button } from "@odin-db/ui/components/button";
import { Input } from "@odin-db/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@odin-db/ui/components/popover";
import { Bookmark, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { formatRelativeTime } from "@/lib/format";
import type { Stage } from "../lib/pipeline";
import { type SavedPipeline, useSavedPipelines } from "../store/saved-pipelines-store";

const NO_PIPELINES: SavedPipeline[] = [];

interface SavedPipelinesMenuProps {
  storageKey: string;
  stages: readonly Stage[];
  onLoad: (pipeline: SavedPipeline) => void;
  /** Before opening, e.g. to turn edited text into stages; `false` keeps it closed. */
  onOpen?: () => Promise<boolean>;
}

/** Save the current pipeline under a name, or load one saved for this collection. */
export function SavedPipelinesMenu({
  storageKey,
  stages,
  onLoad,
  onOpen,
}: SavedPipelinesMenuProps) {
  const { t, i18n } = useTranslation("aggregation");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const pipelines = useSavedPipelines((s) => s.pipelines[storageKey] ?? NO_PIPELINES);
  const save = useSavedPipelines((s) => s.save);
  const remove = useSavedPipelines((s) => s.remove);
  const trimmed = name.trim();
  const replaces = pipelines.some((pipeline) => pipeline.name === trimmed);

  function onSave(event: FormEvent) {
    event.preventDefault();
    if (!trimmed) return;
    save(storageKey, trimmed, stages);
    toast.success(t("saved.done", { name: trimmed }));
    setName("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next || !onOpen) return setOpen(next);
        void onOpen().then((ready) => ready && setOpen(true));
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("saved.open")} title={t("saved.open")}>
          <Bookmark />
          {/* Its toolbar is a container that turns secondary labels into icons when narrow. */}
          <span className="hidden @4xl:inline">{t("saved.open")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <form onSubmit={onSave} className="flex items-center gap-2 border-b p-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("saved.namePlaceholder")}
            aria-label={t("saved.name")}
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={!trimmed}>
            {replaces ? t("saved.replace") : t("saved.save")}
          </Button>
        </form>
        {pipelines.length === 0 ? (
          <p className="p-4 text-center text-muted-foreground text-xs">{t("saved.empty")}</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto p-1">
            {pipelines.map((pipeline) => (
              <li
                key={pipeline.name}
                className="group flex items-center gap-1 rounded-sm hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={() => {
                    onLoad(pipeline);
                    setOpen(false);
                  }}
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2 py-1.5 text-left"
                >
                  <span className="flex w-full items-baseline gap-2">
                    <span className="truncate font-medium text-sm">{pipeline.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                      {formatRelativeTime(pipeline.savedAt, Date.now(), i18n.language)}
                    </span>
                  </span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {pipeline.stages.map((stage) => stage.operator).join(" → ")}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("saved.delete", { name: pipeline.name })}
                  onClick={() => remove(storageKey, pipeline.name)}
                  className="size-7 shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
