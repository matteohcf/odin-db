import type {
  BackupSchedule,
  BackupScope,
  ConnectionProfile,
  Frequency,
  ProfileId,
} from "@odin-db/bindings";
import { commands } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { Switch } from "@odin-db/ui/components/switch";
import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import { FolderOpen } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormField } from "@/components/form-field";
import { InlineError } from "@/components/inline-error";
import { call, errorMessage } from "@/lib/ipc";
import { useSaveSchedule } from "../api/backups";
import { clockTime, weekdayName } from "../lib/describe";

type ScopeKind = BackupScope["kind"];

interface ScheduleDialogProps {
  profiles: readonly ConnectionProfile[];
  /** Present when editing. */
  schedule?: BackupSchedule | undefined;
  /** Preselected connection for a new schedule. */
  profileId?: ProfileId | undefined;
  onClose: () => void;
}

/** Creates or edits a recurring backup: what, when, where, and how many to keep. */
export function ScheduleDialog({ profiles, schedule, profileId, onClose }: ScheduleDialogProps) {
  const { t, i18n } = useTranslation("backups");
  const id = useId();
  const save = useSaveSchedule();
  const scope = schedule?.scope;
  const [profile, setProfile] = useState<string>(
    schedule?.profileId ?? profileId ?? profiles[0]?.id ?? "",
  );
  const [scopeKind, setScopeKind] = useState<ScopeKind>(scope?.kind ?? "deployment");
  const [database, setDatabase] = useState(
    scope && scope.kind !== "deployment" ? scope.database : "",
  );
  const [collection, setCollection] = useState(
    scope?.kind === "collection" ? scope.collection : "",
  );
  const [frequency, setFrequency] = useState<Frequency>(schedule?.timing.frequency ?? "daily");
  const [time, setTime] = useState(
    schedule && schedule.timing.frequency !== "hourly"
      ? clockTime(schedule.timing.minute)
      : "02:00",
  );
  const [minuteOfHour, setMinuteOfHour] = useState(
    schedule?.timing.frequency === "hourly" ? String(schedule.timing.minute) : "0",
  );
  const [weekday, setWeekday] = useState(String(schedule?.timing.weekday ?? 1));
  const [keep, setKeep] = useState(String(schedule?.keep ?? 7));
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [folder, setFolder] = useState<{ token: string | null; path: string } | null>(
    schedule ? { token: null, path: schedule.folder } : null,
  );
  const [error, setError] = useState<string | null>(null);

  async function chooseFolder() {
    try {
      const picked = await call(commands.chooseBackupFolder());
      if (picked) setFolder(picked);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function buildScope(): BackupScope | null {
    if (scopeKind === "deployment") return { kind: "deployment" };
    if (!database.trim()) return null;
    if (scopeKind === "database") return { kind: "database", database: database.trim() };
    if (!collection.trim()) return null;
    return { kind: "collection", database: database.trim(), collection: collection.trim() };
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const builtScope = buildScope();
    if (!builtScope) {
      setError(t("schedule.scopeRequired"));
      return;
    }
    if (!folder) {
      setError(t("schedule.folderRequired"));
      return;
    }
    const [hours = "0", minutes = "0"] = time.split(":");
    const minute =
      frequency === "hourly" ? Number(minuteOfHour) : Number(hours) * 60 + Number(minutes);
    try {
      await save.mutateAsync({
        id: schedule?.id ?? null,
        input: {
          profileId: profile,
          scope: builtScope,
          timing: { frequency, minute, weekday: frequency === "weekly" ? Number(weekday) : null },
          keep: Number(keep),
          enabled,
        },
        folderToken: folder.token,
      });
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    toast.success(schedule ? t("schedule.updated") : t("schedule.created"));
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {schedule ? t("schedule.editTitle") : t("schedule.createTitle")}
            </DialogTitle>
            <DialogDescription>{t("schedule.description")}</DialogDescription>
          </DialogHeader>

          <FormField id={`${id}-profile`} label={t("schedule.connection")}>
            <Select value={profile} onValueChange={setProfile}>
              <SelectTrigger id={`${id}-profile`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField id={`${id}-scope`} label={t("schedule.what")}>
            <ToggleGroup
              id={`${id}-scope`}
              type="single"
              variant="outline"
              value={scopeKind}
              onValueChange={(value) => value && setScopeKind(value as ScopeKind)}
              className="w-full"
            >
              <ToggleGroupItem value="deployment" className="flex-1">
                {t("scope.deploymentShort")}
              </ToggleGroupItem>
              <ToggleGroupItem value="database" className="flex-1">
                {t("scope.databaseShort")}
              </ToggleGroupItem>
              <ToggleGroupItem value="collection" className="flex-1">
                {t("scope.collectionShort")}
              </ToggleGroupItem>
            </ToggleGroup>
            {scopeKind !== "deployment" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Input
                  aria-label={t("schedule.database")}
                  placeholder={t("schedule.database")}
                  value={database}
                  onChange={(event) => setDatabase(event.target.value)}
                  className="font-mono text-xs"
                />
                {scopeKind === "collection" && (
                  <Input
                    aria-label={t("schedule.collection")}
                    placeholder={t("schedule.collection")}
                    value={collection}
                    onChange={(event) => setCollection(event.target.value)}
                    className="font-mono text-xs"
                  />
                )}
              </div>
            )}
          </FormField>

          <FormField id={`${id}-frequency`} label={t("schedule.when")}>
            <ToggleGroup
              id={`${id}-frequency`}
              type="single"
              variant="outline"
              value={frequency}
              onValueChange={(value) => value && setFrequency(value as Frequency)}
              className="w-full"
            >
              {(["hourly", "daily", "weekly"] as const).map((value) => (
                <ToggleGroupItem key={value} value={value} className="flex-1">
                  {t(`frequency.${value}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="mt-2 flex items-center gap-2 text-sm">
              {frequency === "weekly" && (
                <Select value={weekday} onValueChange={setWeekday}>
                  <SelectTrigger aria-label={t("schedule.weekday")} className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {weekdayName(day, i18n.language)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {frequency === "hourly" ? (
                <>
                  <span className="text-muted-foreground">{t("schedule.atMinute")}</span>
                  <Input
                    aria-label={t("schedule.minute")}
                    type="number"
                    min={0}
                    max={59}
                    value={minuteOfHour}
                    onChange={(event) => setMinuteOfHour(event.target.value)}
                    className="w-20"
                  />
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">{t("schedule.at")}</span>
                  <Input
                    aria-label={t("schedule.time")}
                    type="time"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                    className="w-32"
                  />
                </>
              )}
            </div>
          </FormField>

          <FormField id={`${id}-folder`} label={t("schedule.folder")}>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
                {folder?.path ?? (
                  <span className="text-muted-foreground">{t("schedule.noFolder")}</span>
                )}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void chooseFolder()}>
                <FolderOpen />
                {t("schedule.chooseFolder")}
              </Button>
            </div>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField id={`${id}-keep`} label={t("schedule.keep")}>
              <Input
                id={`${id}-keep`}
                type="number"
                min={1}
                max={1000}
                value={keep}
                onChange={(event) => setKeep(event.target.value)}
              />
            </FormField>
            <div className="flex items-end justify-between gap-2 pb-2">
              <Label htmlFor={`${id}-enabled`}>{t("schedule.enabled")}</Label>
              <Switch id={`${id}-enabled`} checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>
          <p className="-mt-2 text-muted-foreground text-xs">{t("schedule.keepHint")}</p>

          {error && <InlineError>{error}</InlineError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button type="submit" disabled={save.isPending || !profile}>
              {schedule ? t("schedule.save") : t("schedule.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
