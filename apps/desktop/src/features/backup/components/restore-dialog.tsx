import { type ConnectionId, commands, type RestoreSource } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Checkbox } from "@odin-db/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { Input } from "@odin-db/ui/components/input";
import { Label } from "@odin-db/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@odin-db/ui/components/radio-group";
import { CircleAlert, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { call, errorMessage } from "@/lib/ipc";
import { useToolRun } from "../hooks/use-tool-run";
import { ToolLog } from "./tool-log";
import { ToolsGate } from "./tools-gate";

interface RestoreDialogProps {
  connectionId: ConnectionId;
  profileName: string;
  readOnly: boolean;
  /** Pre-fills "Only this database" when opened from a database. */
  database?: string | undefined;
  /** Called after a restore that ran, e.g. to refresh the tree. */
  onRestored: () => void;
  onClose: () => void;
}

export function RestoreDialog({
  connectionId,
  profileName,
  readOnly,
  database,
  onRestored,
  onClose,
}: RestoreDialogProps) {
  const { t } = useTranslation("backup");
  const id = useId();
  const [source, setSource] = useState<RestoreSource>("archive");
  const [picked, setPicked] = useState<{ token: string; name: string } | null>(null);
  const [onlyDatabase, setOnlyDatabase] = useState(database ?? "");
  const [renameTo, setRenameTo] = useState("");
  const [drop, setDrop] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const run = useToolRun();
  const { state, summary } = run;
  const busy = state.status === "running";
  const done = state.status !== "idle" && !busy;

  // What a destructive restore would overwrite: the user types it to confirm (ADR-0017).
  const dropTarget = renameTo.trim() || onlyDatabase.trim() || profileName;
  const confirmed = !drop || confirmation === dropTarget;

  async function choose() {
    setPickError(null);
    try {
      const file = await call(commands.chooseRestoreSource(source));
      if (file) setPicked(file);
    } catch (error) {
      setPickError(errorMessage(error));
    }
  }

  async function submit() {
    if (!picked) return;
    const ran = await run.start((channel) =>
      call(
        commands.restoreDatabase(
          connectionId,
          picked.token,
          {
            source,
            drop,
            database: onlyDatabase.trim() || null,
            renameTo: renameTo.trim() || null,
          },
          channel,
        ),
      ),
    );
    if (ran) onRestored();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("restore.title", { name: profileName })}</DialogTitle>
          <DialogDescription>{t("restore.description")}</DialogDescription>
        </DialogHeader>

        {readOnly ? (
          <p className="text-muted-foreground text-sm">{t("restore.readOnly")}</p>
        ) : (
          <ToolsGate>
            {state.status === "idle" ? (
              <div className="flex flex-col gap-4">
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 font-medium text-sm">{t("restore.source")}</legend>
                  <RadioGroup
                    value={source}
                    onValueChange={(value) => {
                      setSource(value as RestoreSource);
                      setPicked(null);
                    }}
                  >
                    {(["archive", "directory"] as const).map((kind) => (
                      <div key={kind} className="flex items-start gap-2.5">
                        <RadioGroupItem id={`${id}-${kind}`} value={kind} className="mt-0.5" />
                        <div className="flex flex-col gap-0.5">
                          <Label htmlFor={`${id}-${kind}`} className="font-normal">
                            {t(`restore.${kind}`)}
                          </Label>
                          <span className="text-muted-foreground text-xs">
                            {t(`restore.${kind}Hint`)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </RadioGroup>
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" onClick={() => void choose()}>
                      {t("restore.choose")}
                    </Button>
                    {picked && (
                      <span className="truncate text-sm">
                        {t("restore.chosen", { name: picked.name })}
                      </span>
                    )}
                  </div>
                  {pickError && <p className="text-destructive text-xs selectable">{pickError}</p>}
                </fieldset>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-db`}>{t("restore.database")}</Label>
                    <Input
                      id={`${id}-db`}
                      value={onlyDatabase}
                      onChange={(e) => setOnlyDatabase(e.target.value)}
                      placeholder={t("restore.databasePlaceholder")}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-rename`}>{t("restore.renameTo")}</Label>
                    <Input
                      id={`${id}-rename`}
                      value={renameTo}
                      onChange={(e) => setRenameTo(e.target.value)}
                      placeholder={t("restore.renamePlaceholder")}
                      disabled={onlyDatabase.trim() === ""}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-start gap-2.5">
                    <Checkbox
                      id={`${id}-drop`}
                      checked={drop}
                      onCheckedChange={(checked) => {
                        setDrop(checked === true);
                        setConfirmation("");
                      }}
                      className="mt-0.5"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor={`${id}-drop`} className="font-normal">
                        {t("restore.drop")}
                      </Label>
                      <span className="text-muted-foreground text-xs">{t("restore.dropHint")}</span>
                    </div>
                  </div>
                  {drop && (
                    <div className="flex flex-col gap-1.5 pl-6">
                      <Label htmlFor={`${id}-confirm`} className="text-destructive text-xs">
                        {t("restore.confirmLabel", { target: dropTarget })}
                      </Label>
                      <Input
                        id={`${id}-confirm`}
                        value={confirmation}
                        onChange={(e) => setConfirmation(e.target.value)}
                        className="font-mono text-xs"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {busy && (
                  <p role="status" className="flex items-center gap-2 font-medium text-sm">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    {t("restore.running")}
                  </p>
                )}
                {state.status === "completed" && summary && (
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="text-success">
                      {t("restore.done", {
                        documents: summary.documents ?? 0,
                        collections: summary.collections ?? 0,
                      })}
                    </p>
                    {(summary.failures ?? 0) > 0 && (
                      <p className="text-destructive">
                        {t("restore.failures", { count: summary.failures ?? 0 })}
                      </p>
                    )}
                  </div>
                )}
                {state.status === "cancelled" && (
                  <p className="text-muted-foreground text-sm">{t("restore.cancelled")}</p>
                )}
                {state.status === "failed" && (
                  <p
                    role="alert"
                    className="flex items-start gap-2 text-destructive text-sm selectable"
                  >
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    {t("restore.failed", { message: state.error })}
                  </p>
                )}
                <ToolLog lines={run.lines} />
              </div>
            )}
          </ToolsGate>
        )}

        <DialogFooter>
          {busy ? (
            <Button variant="outline" onClick={run.cancel}>
              {t("actions.stop")}
            </Button>
          ) : done || readOnly ? (
            <Button onClick={onClose}>{t("actions.close")}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t("actions.cancel")}
              </Button>
              <Button
                variant={drop ? "destructive" : "default"}
                onClick={() => void submit()}
                disabled={!picked || !confirmed}
              >
                {t("restore.submit")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
