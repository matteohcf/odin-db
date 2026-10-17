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
import { TriangleAlert } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import {
  AUTH_MECHANISMS,
  buildConnectionString,
  type ConnectionFields,
  parseConnectionString,
  READ_PREFERENCES,
} from "../lib/connection-uri";

/** Radix Select needs a non-empty value for "not set". */
const DEFAULT = "default";

/**
 * The connection string as a form. The string stays the single source of truth:
 * every change rebuilds it, keeping the options the form does not show.
 */
export function ConnectionFormFields({
  connectionString,
  onChange,
}: {
  connectionString: string;
  onChange: (connectionString: string) => void;
}) {
  const { t } = useTranslation("connections");
  const id = useId();
  const fields = parseConnectionString(connectionString);

  if (!fields) {
    return (
      <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
        <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
        {t("form.unsupported")}
      </p>
    );
  }

  const set = <K extends keyof ConnectionFields>(key: K, value: ConnectionFields[K]) =>
    onChange(buildConnectionString({ ...fields, [key]: value }));

  return (
    <div className="flex flex-col gap-3">
      <Toggle
        id={`${id}-srv`}
        label={t("form.srv")}
        hint={t("form.srvHint")}
        checked={fields.srv}
        onChange={(srv) => onChange(buildConnectionString({ ...fields, srv, tls: srv }))}
      />
      <FormField id={`${id}-hosts`} label={fields.srv ? t("form.srvHost") : t("form.hosts")}>
        <Input
          id={`${id}-hosts`}
          value={fields.hosts}
          placeholder={fields.srv ? "cluster0.abcde.mongodb.net" : "localhost:27017"}
          onChange={(event) => set("hosts", event.target.value)}
          className="font-mono text-xs"
          spellCheck={false}
          autoComplete="off"
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField id={`${id}-user`} label={t("form.username")}>
          <Input
            id={`${id}-user`}
            value={fields.username}
            placeholder={t("form.optional")}
            onChange={(event) => set("username", event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </FormField>
        <FormField id={`${id}-auth-db`} label={t("form.authSource")}>
          <Input
            id={`${id}-auth-db`}
            value={fields.authSource}
            placeholder="admin"
            onChange={(event) => set("authSource", event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </FormField>
        <FormField id={`${id}-mechanism`} label={t("form.authMechanism")}>
          <Select
            value={fields.authMechanism || DEFAULT}
            onValueChange={(value) => set("authMechanism", value === DEFAULT ? "" : value)}
          >
            <SelectTrigger id={`${id}-mechanism`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{t("form.automatic")}</SelectItem>
              {AUTH_MECHANISMS.map((mechanism) => (
                <SelectItem key={mechanism} value={mechanism}>
                  {mechanism}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id={`${id}-read`} label={t("form.readPreference")}>
          <Select
            value={fields.readPreference || DEFAULT}
            onValueChange={(value) => set("readPreference", value === DEFAULT ? "" : value)}
          >
            <SelectTrigger id={`${id}-read`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{t("form.automatic")}</SelectItem>
              {READ_PREFERENCES.map((preference) => (
                <SelectItem key={preference} value={preference}>
                  {preference}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id={`${id}-rs`} label={t("form.replicaSet")}>
          <Input
            id={`${id}-rs`}
            value={fields.replicaSet}
            placeholder={t("form.optional")}
            onChange={(event) => set("replicaSet", event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </FormField>
        <FormField id={`${id}-db`} label={t("form.database")}>
          <Input
            id={`${id}-db`}
            value={fields.database}
            placeholder={t("form.optional")}
            onChange={(event) => set("database", event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </FormField>
      </div>
      <div className="flex flex-col divide-y rounded-md border">
        <Toggle
          id={`${id}-tls`}
          label={t("form.tls")}
          checked={fields.tls}
          onChange={(tls) => set("tls", tls)}
          inset
        />
        {fields.tls && (
          <Toggle
            id={`${id}-invalid`}
            label={t("form.allowInvalid")}
            hint={fields.tlsAllowInvalidCertificates ? t("form.allowInvalidWarning") : undefined}
            warning
            checked={fields.tlsAllowInvalidCertificates}
            onChange={(allow) => set("tlsAllowInvalidCertificates", allow)}
            inset
          />
        )}
        {!fields.srv && (
          <Toggle
            id={`${id}-direct`}
            label={t("form.directConnection")}
            hint={t("form.directConnectionHint")}
            checked={fields.directConnection}
            onChange={(direct) => set("directConnection", direct)}
            inset
          />
        )}
      </div>
    </div>
  );
}

function FormField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
  warning = false,
  inset = false,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
  warning?: boolean;
  inset?: boolean;
}) {
  return (
    <div
      className={
        inset
          ? "flex items-start justify-between gap-4 p-3"
          : "flex items-start justify-between gap-4"
      }
    >
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        {hint && (
          <p className={warning ? "text-warning text-xs" : "text-muted-foreground text-xs"}>
            {hint}
          </p>
        )}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
