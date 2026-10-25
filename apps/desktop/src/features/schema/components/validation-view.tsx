import {
  type ConnectionInfo,
  commands,
  type Namespace,
  type ValidationAction,
  type ValidationLevel,
} from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Loader2, ShieldX, Sparkles } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { useQueryCompletions } from "@/hooks/use-query-completions";
import { call, errorMessage } from "@/lib/ipc";
import { parseShellDocument, toShellSyntax } from "@/lib/shell-syntax";
import { useSchema } from "../api/use-schema";
import { jsonSchemaFromFields } from "../lib/json-schema";

const LEVELS: ValidationLevel[] = ["strict", "moderate", "off"];
const ACTIONS: ValidationAction[] = ["error", "warn"];

interface ValidationViewProps {
  connection: ConnectionInfo;
  namespace: Namespace;
  editable: boolean;
  /** Shows the documents the rules reject; takes them as a mongosh validator. */
  onFindInvalid?: ((validator: string) => void) | undefined;
}

/** The rules documents must follow: a validator, with its level and action. */
export function ValidationView({
  connection,
  namespace,
  editable,
  onFindInvalid,
}: ValidationViewProps) {
  const { t } = useTranslation("schema");
  const id = useId();
  const queryClient = useQueryClient();
  const key = ["validation", connection.id, namespace.database, namespace.collection];
  const rules = useQuery({
    queryKey: key,
    queryFn: () => call(commands.getValidation(connection.id, namespace)),
  });
  const schema = useSchema(connection.id, namespace, null);
  const completionsFor = useQueryCompletions(schema.data ?? []);
  const [text, setText] = useState<string | null>(null);
  // Remounts the editor when its content is replaced from outside.
  const [editorKey, setEditorKey] = useState(0);
  const [level, setLevel] = useState<ValidationLevel>("strict");
  const [action, setAction] = useState<ValidationAction>("error");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rules.data) return;
    setText(toShellSyntax(rules.data.validator));
    setLevel(rules.data.level);
    setAction(rules.data.action);
    setEditorKey((value) => value + 1);
  }, [rules.data]);

  /** The rules as written in the editor, saved or not, checked before they filter anything. */
  async function findInvalid() {
    try {
      const validator = await parseShellDocument(text ?? "");
      setError(null);
      onFindInvalid?.(toShellSyntax(validator, 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const validator = await parseShellDocument(text ?? "");
      await call(commands.setValidation(connection.id, namespace, { validator, level, action }));
    },
    meta: { handlesErrors: true },
  });

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync();
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    toast.success(t("validation.saved"));
    void queryClient.invalidateQueries({ queryKey: key });
  }

  function generate() {
    if (!schema.data) return;
    setText(toShellSyntax(jsonSchemaFromFields(schema.data)));
    setEditorKey((value) => value + 1);
  }

  if (rules.isPending || text === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }
  if (rules.error) {
    return (
      <p role="alert" className="flex items-start gap-2 p-6 text-destructive text-sm selectable">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        {errorMessage(rules.error)}
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2.5 text-sm">
        <label htmlFor={`${id}-level`} className="text-muted-foreground text-xs">
          {t("validation.level")}
        </label>
        <Select
          value={level}
          onValueChange={(value) => setLevel(value as ValidationLevel)}
          disabled={!editable}
        >
          <SelectTrigger id={`${id}-level`} size="sm" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`validation.levels.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label htmlFor={`${id}-action`} className="text-muted-foreground text-xs">
          {t("validation.action")}
        </label>
        <Select
          value={action}
          onValueChange={(value) => setAction(value as ValidationAction)}
          disabled={!editable}
        >
          <SelectTrigger id={`${id}-action`} size="sm" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`validation.actions.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          {onFindInvalid && (
            <Button
              variant="ghost"
              size="sm"
              disabled={(text ?? "").trim() === "" || (text ?? "").trim() === "{}"}
              title={t("validation.findInvalidHint")}
              onClick={() => void findInvalid()}
            >
              <ShieldX />
              {t("validation.findInvalid")}
            </Button>
          )}
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={generate}
              disabled={!schema.data?.length}
              title={t("validation.generateHint")}
            >
              <Sparkles />
              {t("validation.generate")}
            </Button>
          )}
          {editable && (
            <Button size="sm" onClick={() => void submit()} disabled={save.isPending}>
              {t("validation.save")}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 border-b px-3 py-2 text-destructive text-xs selectable"
        >
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
      <CodeEditor
        key={editorKey}
        initialValue={text}
        onChange={setText}
        onSubmit={() => editable && void submit()}
        readOnly={!editable}
        completions={completionsFor("filter")}
        ariaLabel={t("validation.validator")}
        className="min-h-0 flex-1"
      />
      <p className="shrink-0 border-t px-3 py-2 text-muted-foreground text-xs">
        {editable ? t("validation.hint") : t("validation.readOnly")}
      </p>
    </div>
  );
}
