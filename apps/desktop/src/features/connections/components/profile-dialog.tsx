import type { ConnectionProfile, ProfileInput } from "@odin-db/bindings";
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
import { Switch } from "@odin-db/ui/components/switch";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/lib/ipc";
import { useConnect, useSaveProfile, useTestConnection } from "../api/mutations";
import { useExplorer } from "../store/explorer-store";

interface ProfileDialogProps {
  open: boolean;
  /** Present when editing an existing profile. */
  profile?: ConnectionProfile | undefined;
  onClose: () => void;
}

interface FormState {
  name: string;
  connectionString: string;
  password: string;
  readOnly: boolean;
}

function initialState(profile: ConnectionProfile | undefined): FormState {
  return {
    name: profile?.name ?? "",
    connectionString: profile?.connectionString ?? "mongodb://localhost:27017",
    password: "",
    readOnly: profile?.readOnly ?? false,
  };
}

function toInput(form: FormState): ProfileInput {
  return {
    name: form.name,
    connectionString: form.connectionString,
    // Empty means "no new password": the saved one is kept.
    password: form.password === "" ? null : form.password,
    readOnly: form.readOnly,
  };
}

export function ProfileDialog({ open, profile, onClose }: ProfileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Radix unmounts closed content, so the form starts fresh on every open. */}
        <ProfileForm profile={profile} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function ProfileForm({ profile, onClose }: Omit<ProfileDialogProps, "open">) {
  const { t } = useTranslation("connections");
  const id = useId();
  const [form, setForm] = useState(() => initialState(profile));
  const [submitted, setSubmitted] = useState(false);
  const save = useSaveProfile();
  const test = useTestConnection();
  const connect = useConnect();
  const setExpanded = useExplorer((s) => s.setExpanded);

  const errors = {
    name: form.name.trim() === "" ? t("dialog.nameRequired") : undefined,
    connectionString:
      form.connectionString.trim() === "" ? t("dialog.connectionStringRequired") : undefined,
  };
  const invalid = errors.name !== undefined || errors.connectionString !== undefined;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    test.reset();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    save.mutate(
      { ...(profile ? { id: profile.id } : {}), input: toInput(form) },
      {
        onSuccess: (saved) => {
          onClose();
          if (!profile) {
            connect.mutate(saved.id, { onSuccess: () => setExpanded(saved.id, true) });
          }
        },
      },
    );
  }

  function onTest() {
    setSubmitted(true);
    if (errors.connectionString) return;
    test.mutate({ input: toInput(form), ...(profile ? { profileId: profile.id } : {}) });
  }

  const busy = save.isPending;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{profile ? t("dialog.editTitle") : t("dialog.createTitle")}</DialogTitle>
        <DialogDescription>{t("dialog.description")}</DialogDescription>
      </DialogHeader>

      <Field id={`${id}-name`} label={t("dialog.name")} error={submitted ? errors.name : undefined}>
        <Input
          id={`${id}-name`}
          value={form.name}
          placeholder={t("dialog.namePlaceholder")}
          onChange={(event) => update("name", event.target.value)}
          autoFocus
          autoComplete="off"
        />
      </Field>

      <Field
        id={`${id}-uri`}
        label={t("dialog.connectionString")}
        hint={t("dialog.connectionStringHint")}
        error={submitted ? errors.connectionString : undefined}
      >
        <Input
          id={`${id}-uri`}
          value={form.connectionString}
          onChange={(event) => update("connectionString", event.target.value)}
          className="font-mono text-xs"
          spellCheck={false}
          autoComplete="off"
        />
      </Field>

      <Field
        id={`${id}-password`}
        label={t("dialog.password")}
        hint={profile?.hasPassword ? t("dialog.passwordSaved") : undefined}
      >
        <Input
          id={`${id}-password`}
          type="password"
          value={form.password}
          placeholder={profile?.hasPassword ? "••••••••" : t("dialog.passwordPlaceholder")}
          onChange={(event) => update("password", event.target.value)}
          autoComplete="new-password"
        />
      </Field>

      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-ro`}>{t("dialog.readOnly")}</Label>
          <p className="text-muted-foreground text-xs">{t("dialog.readOnlyHint")}</p>
        </div>
        <Switch
          id={`${id}-ro`}
          checked={form.readOnly}
          onCheckedChange={(checked) => update("readOnly", checked)}
        />
      </div>

      <TestResult
        pending={test.isPending}
        error={test.error ?? save.error}
        version={test.data?.serverVersion}
      />

      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="outline" onClick={onTest} disabled={test.isPending}>
          {test.isPending ? t("dialog.testing") : t("dialog.test")}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t("dialog.saving") : profile ? t("dialog.save") : t("dialog.saveAndConnect")}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

function TestResult({
  pending,
  error,
  version,
}: {
  pending: boolean;
  error: Error | null;
  version: string | undefined;
}) {
  const { t } = useTranslation("connections");
  if (pending) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        {t("dialog.testing")}
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="flex items-start gap-2 text-destructive text-xs selectable">
        <CircleAlert className="mt-px size-3.5 shrink-0" />
        <span className="break-words">{errorMessage(error)}</span>
      </p>
    );
  }
  if (version) {
    return (
      <p className="flex items-center gap-2 text-success text-xs">
        <CircleCheck className="size-3.5" />
        {t("dialog.testOk", { version })}
      </p>
    );
  }
  return null;
}
