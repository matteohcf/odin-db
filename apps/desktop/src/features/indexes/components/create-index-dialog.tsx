import type { ConnectionId, FieldSummary, Namespace } from "@odin-db/bindings";
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
import { CircleAlert } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormField } from "@/components/form-field";
import { QueryEditor } from "@/components/query-editor";
import { useQueryCompletions } from "@/hooks/use-query-completions";
import { useSampleFields } from "@/hooks/use-sample-fields";
import { errorMessage } from "@/lib/ipc";
import { parseShellDocument } from "@/lib/shell-syntax";
import { useCreateIndex } from "../api/indexes";

interface CreateIndexDialogProps {
  connectionId: ConnectionId;
  namespace: Namespace;
  /** Keys to start from, e.g. suggested by a query plan. */
  initialKeys?: string;
  onClose: () => void;
}

type Flag = "unique" | "sparse" | "hidden";

const NO_FIELDS: FieldSummary[] = [];
/** The look of an input, around a single-line query editor. */
const EDITOR_FRAME =
  "flex h-9 items-center rounded-md border px-3 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30";

export function CreateIndexDialog({
  connectionId,
  namespace,
  initialKeys = "",
  onClose,
}: CreateIndexDialogProps) {
  const { t } = useTranslation("indexes");
  const id = useId();
  const create = useCreateIndex(connectionId, namespace);
  const [keys, setKeys] = useState(initialKeys);
  const form = useRef<HTMLFormElement>(null);
  // Keys read like a sort: field paths, then 1 or -1.
  const fields = useSampleFields(connectionId, namespace);
  const completionsFor = useQueryCompletions(fields.data ?? NO_FIELDS);
  const [name, setName] = useState("");
  const [flags, setFlags] = useState<Record<Flag, boolean>>({
    unique: false,
    sparse: false,
    hidden: false,
  });
  const [ttl, setTtl] = useState("");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (keys.trim() === "") throw new Error(t("create.keysRequired"));
      const parsedKeys = await parseShellDocument(keys);
      if (Object.keys(parsedKeys as object).length === 0) throw new Error(t("create.keysRequired"));
      const ttlSeconds = ttl.trim() === "" ? null : Number(ttl);
      if (ttlSeconds !== null && (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 0)) {
        throw new Error(t("query.invalidNumber", { ns: "documents" }));
      }
      const created = await create.mutateAsync({
        keys: parsedKeys,
        name: name.trim() === "" ? null : name.trim(),
        ...flags,
        expireAfterSeconds: ttlSeconds,
        partialFilter: partial.trim() === "" ? null : await parseShellDocument(partial),
      });
      toast.success(t("create.created", { name: created }));
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  const flag = (key: Flag) => (
    <div key={key} className="flex items-start gap-2.5 rounded-md border p-2.5">
      <Checkbox
        id={`${id}-${key}`}
        checked={flags[key]}
        onCheckedChange={(checked) =>
          setFlags((current) => ({ ...current, [key]: checked === true }))
        }
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={`${id}-${key}`}>{t(`create.${key}`)}</Label>
        <span className="text-muted-foreground text-xs">{t(`create.${key}Hint`)}</span>
      </div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{t("create.title")}</DialogTitle>
            <DialogDescription>{t("create.description")}</DialogDescription>
          </DialogHeader>

          <FormField id={`${id}-keys`} label={t("create.keys")} hint={t("create.keysHint")}>
            <div className={EDITOR_FRAME}>
              <QueryEditor
                value={keys}
                onChange={setKeys}
                onSubmit={() => form.current?.requestSubmit()}
                completions={completionsFor("sort")}
                placeholder="{ email: 1 }"
                ariaLabel={t("create.keys")}
                autoFocus
              />
            </div>
          </FormField>

          <FormField id={`${id}-name`} label={t("create.name")}>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("create.namePlaceholder")}
              autoComplete="off"
            />
          </FormField>

          <div className="grid grid-cols-3 gap-2">
            {(["unique", "sparse", "hidden"] as const).map(flag)}
          </div>

          <FormField id={`${id}-ttl`} label={t("create.ttl")} hint={t("create.ttlHint")}>
            <Input
              id={`${id}-ttl`}
              value={ttl}
              onChange={(event) => setTtl(event.target.value)}
              inputMode="numeric"
              placeholder="86400"
              className="w-40"
            />
          </FormField>

          <FormField
            id={`${id}-partial`}
            label={t("create.partial")}
            hint={t("create.partialHint")}
          >
            <div className={EDITOR_FRAME}>
              <QueryEditor
                value={partial}
                onChange={setPartial}
                onSubmit={() => form.current?.requestSubmit()}
                completions={completionsFor("filter")}
                placeholder='{ status: "active" }'
                ariaLabel={t("create.partial")}
              />
            </div>
          </FormField>

          {error && (
            <p role="alert" className="flex items-start gap-2 text-destructive text-xs selectable">
              <CircleAlert className="mt-px size-3.5 shrink-0" />
              <span className="break-words">{error}</span>
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t("create.creating") : t("create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
