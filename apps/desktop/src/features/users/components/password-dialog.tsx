import { type ConnectionInfo, commands, type UserInfo } from "@odin-db/bindings";
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
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { InlineError } from "@/components/inline-error";
import { call, errorMessage } from "@/lib/ipc";
import { generatePassword } from "../lib/password";

/** Sets a new password for the user, random by default and copied once saved. */
export function PasswordDialog({
  connection,
  user,
  onClose,
}: {
  connection: ConnectionInfo;
  user: UserInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation("users");
  const [password, setPassword] = useState(generatePassword);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      await call(commands.changeUserPassword(connection.id, user.db, user.user, password));
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    void navigator.clipboard.writeText(password);
    toast.success(t("password.changed", { name: user.user }));
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("password.title", { name: user.user })}</DialogTitle>
          <DialogDescription>{t("password.description")}</DialogDescription>
        </DialogHeader>
        <Input
          aria-label={t("password.new")}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="font-mono text-xs"
          spellCheck={false}
          autoComplete="new-password"
        />
        {error && <InlineError>{error}</InlineError>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <Button onClick={() => void save()} disabled={!password}>
            {t("password.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
