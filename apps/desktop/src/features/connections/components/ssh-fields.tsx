import { commands } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Input } from "@odin-db/ui/components/input";
import { Label } from "@odin-db/ui/components/label";
import { Switch } from "@odin-db/ui/components/switch";
import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import { FileKey2, ShieldCheck } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { call, errorMessage } from "@/lib/ipc";

export interface SshForm {
  enabled: boolean;
  host: string;
  port: string;
  username: string;
  auth: "password" | "privateKey";
  keyPath: string;
  /** Password or passphrase typed now; empty keeps the saved one. */
  secret: string;
}

interface SshFieldsProps {
  value: SshForm;
  onChange: (patch: Partial<SshForm>) => void;
  /** A password or passphrase is already in the keychain. */
  hasSavedSecret: boolean;
  /** The trusted host key fingerprint, when there is one. */
  trustedKey: string | null;
}

/** An optional SSH bastion to reach the server through (ADR-0036). */
export function SshFields({ value, onChange, hasSavedSecret, trustedKey }: SshFieldsProps) {
  const { t } = useTranslation("connections");
  const id = useId();

  async function chooseKey() {
    try {
      const path = await call(commands.chooseSshKey());
      if (path) onChange({ keyPath: path });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-enabled`}>{t("ssh.enable")}</Label>
          <p className="text-muted-foreground text-xs">{t("ssh.enableHint")}</p>
        </div>
        <Switch
          id={`${id}-enabled`}
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ enabled })}
        />
      </div>
      {value.enabled && (
        <>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-host`}>{t("ssh.host")}</Label>
              <Input
                id={`${id}-host`}
                value={value.host}
                onChange={(event) => onChange({ host: event.target.value })}
                placeholder="bastion.example.com"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-port`}>{t("ssh.port")}</Label>
              <Input
                id={`${id}-port`}
                inputMode="numeric"
                value={value.port}
                onChange={(event) => onChange({ port: event.target.value.replace(/\D/g, "") })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-user`}>{t("ssh.username")}</Label>
            <Input
              id={`${id}-user`}
              value={value.username}
              onChange={(event) => onChange({ username: event.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label id={`${id}-auth`}>{t("ssh.auth")}</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              aria-labelledby={`${id}-auth`}
              value={value.auth}
              onValueChange={(auth) =>
                auth && onChange({ auth: auth as SshForm["auth"], secret: "" })
              }
              className="w-full"
            >
              <ToggleGroupItem value="password" className="flex-1">
                {t("ssh.password")}
              </ToggleGroupItem>
              <ToggleGroupItem value="privateKey" className="flex-1">
                {t("ssh.privateKey")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {value.auth === "privateKey" && (
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
                {value.keyPath || <span className="text-muted-foreground">{t("ssh.noKey")}</span>}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void chooseKey()}>
                <FileKey2 />
                {t("ssh.chooseKey")}
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-secret`}>
              {value.auth === "password" ? t("ssh.sshPassword") : t("ssh.passphrase")}
            </Label>
            <Input
              id={`${id}-secret`}
              type="password"
              value={value.secret}
              onChange={(event) => onChange({ secret: event.target.value })}
              placeholder={
                hasSavedSecret
                  ? "••••••••"
                  : value.auth === "password"
                    ? ""
                    : t("ssh.passphraseOptional")
              }
              autoComplete="new-password"
            />
            {hasSavedSecret && (
              <p className="text-muted-foreground text-xs">{t("ssh.secretSaved")}</p>
            )}
          </div>
          {trustedKey && (
            <p className="flex items-start gap-1.5 text-muted-foreground text-xs">
              <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" />
              <span className="min-w-0 break-all">
                {t("ssh.trusted", { fingerprint: trustedKey })}
              </span>
            </p>
          )}
          <p className="text-muted-foreground text-xs">{t("ssh.limits")}</p>
        </>
      )}
    </div>
  );
}
