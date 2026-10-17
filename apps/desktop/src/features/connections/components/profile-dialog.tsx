import type { ConnectionProfile, ProfileColor, ProfileInput } from "@odin-db/bindings";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@odin-db/ui/components/tabs";
import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import { cn } from "@odin-db/ui/lib/utils";
import { Ban, CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage, hostKeyError } from "@/lib/ipc";
import { PROFILE_COLOR_CLASS, PROFILE_COLORS } from "@/lib/profile-colors";
import { useConnect, useSaveProfile, useTestConnection } from "../api/mutations";
import { useExplorer } from "../store/explorer-store";
import { ConnectionFormFields } from "./connection-form-fields";
import { SshFields, type SshForm } from "./ssh-fields";

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
  color: ProfileColor | null;
  ssh: SshForm;
  /** A host key fingerprint confirmed while testing, saved as trusted. */
  sshHostKey: string | null;
}

function initialState(profile: ConnectionProfile | undefined): FormState {
  return {
    name: profile?.name ?? "",
    connectionString: profile?.connectionString ?? "mongodb://localhost:27017",
    password: "",
    readOnly: profile?.readOnly ?? false,
    color: profile?.color ?? null,
    ssh: {
      enabled: profile?.ssh != null,
      host: profile?.ssh?.host ?? "",
      port: String(profile?.ssh?.port ?? 22),
      username: profile?.ssh?.username ?? "",
      auth: profile?.ssh?.auth.kind ?? "password",
      keyPath: profile?.ssh?.auth.kind === "privateKey" ? profile.ssh.auth.path : "",
      secret: "",
    },
    sshHostKey: null,
  };
}

function toInput(form: FormState): ProfileInput {
  return {
    name: form.name,
    connectionString: form.connectionString,
    // Empty means "no new password": the saved one is kept.
    password: form.password === "" ? null : form.password,
    readOnly: form.readOnly,
    color: form.color,
    ssh: form.ssh.enabled
      ? {
          host: form.ssh.host.trim(),
          port: Number(form.ssh.port) || 22,
          username: form.ssh.username.trim(),
          auth:
            form.ssh.auth === "password"
              ? { kind: "password" }
              : { kind: "privateKey", path: form.ssh.keyPath },
        }
      : null,
    sshSecret: form.ssh.secret === "" ? null : form.ssh.secret,
    sshHostKey: form.sshHostKey,
  };
}

export function ProfileDialog({ open, profile, onClose }: ProfileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto sm:max-w-lg">
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
        onSuccess: async (saved) => {
          onClose();
          if (!profile) {
            // The dialog has unmounted by now; its per-call callbacks would never run.
            // A failure is already reported by the app-wide mutation error toast.
            const connected = await connect.mutateAsync(saved.id).then(
              () => true,
              () => false,
            );
            if (connected) setExpanded(saved.id, true);
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

      <Tabs defaultValue="string" className="gap-3">
        <TabsList className="w-full">
          <TabsTrigger value="string">{t("form.tabString")}</TabsTrigger>
          <TabsTrigger value="form">{t("form.tabForm")}</TabsTrigger>
          <TabsTrigger value="ssh">{t("ssh.tab")}</TabsTrigger>
        </TabsList>
        <TabsContent value="string">
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
        </TabsContent>
        <TabsContent value="form">
          <ConnectionFormFields
            connectionString={form.connectionString}
            onChange={(value) => update("connectionString", value)}
          />
        </TabsContent>
        <TabsContent value="ssh">
          <SshFields
            value={form.ssh}
            onChange={(patch) => update("ssh", { ...form.ssh, ...patch })}
            hasSavedSecret={profile?.hasSshSecret ?? false}
            trustedKey={form.sshHostKey ?? profile?.sshHostKey ?? null}
          />
        </TabsContent>
      </Tabs>

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

      <div className="flex flex-col gap-1.5">
        <Label id={`${id}-color`}>{t("dialog.color")}</Label>
        <ToggleGroup
          type="single"
          aria-labelledby={`${id}-color`}
          value={form.color ?? "none"}
          onValueChange={(value) =>
            value && update("color", value === "none" ? null : (value as ProfileColor))
          }
          className="justify-start gap-1.5"
        >
          <ToggleGroupItem
            value="none"
            aria-label={t("dialog.colors.none")}
            title={t("dialog.colors.none")}
            className="size-7 min-w-7 rounded-full border p-0 data-[state=on]:ring-2 data-[state=on]:ring-ring"
          >
            <Ban className="size-3.5 text-muted-foreground" />
          </ToggleGroupItem>
          {PROFILE_COLORS.map((color) => (
            <ToggleGroupItem
              key={color}
              value={color}
              aria-label={t(`dialog.colors.${color}`)}
              title={t(`dialog.colors.${color}`)}
              className="size-7 min-w-7 rounded-full p-0 data-[state=on]:ring-2 data-[state=on]:ring-ring data-[state=on]:ring-offset-2 data-[state=on]:ring-offset-background"
            >
              <span className={cn("size-5 rounded-full", PROFILE_COLOR_CLASS[color].bg)} />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-muted-foreground text-xs">{t("dialog.colorHint")}</p>
      </div>

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
        onTrustHostKey={(fingerprint) => {
          const next = { ...form, sshHostKey: fingerprint };
          setForm(next);
          test.mutate({ input: toInput(next), ...(profile ? { profileId: profile.id } : {}) });
        }}
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
  onTrustHostKey,
}: {
  pending: boolean;
  error: Error | null;
  version: string | undefined;
  onTrustHostKey: (fingerprint: string) => void;
}) {
  const { t } = useTranslation("connections");
  const hostKey = hostKeyError(error);
  if (!pending && hostKey) {
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-col gap-2 rounded-md border p-3 text-xs",
          hostKey.changed
            ? "border-destructive/50 bg-destructive/5"
            : "border-warning/50 bg-warning/5",
        )}
      >
        <p className="font-medium">
          {hostKey.changed ? t("hostKey.changedTitle") : t("hostKey.unknownTitle")}
        </p>
        <p className="text-muted-foreground">
          {hostKey.changed ? t("hostKey.changedShort") : t("hostKey.unknownShort")}
        </p>
        <code className="break-all font-mono selectable">{hostKey.fingerprint}</code>
        <Button
          type="button"
          size="sm"
          variant={hostKey.changed ? "destructive" : "outline"}
          className="self-start"
          onClick={() => onTrustHostKey(hostKey.fingerprint)}
        >
          {hostKey.changed ? t("hostKey.trustNewAndTest") : t("hostKey.trustAndTest")}
        </Button>
      </div>
    );
  }
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
