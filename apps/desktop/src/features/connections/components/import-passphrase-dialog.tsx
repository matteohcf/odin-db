import type { ConnectionsFile, ImportedProfiles } from "@odin-db/bindings";
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
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/lib/ipc";
import { useImportConnections } from "../api/mutations";

/** Asks for the password a Compass export was protected with; a wrong one can be retried. */
export function ImportPassphraseDialog({
  file,
  onImported,
  onClose,
}: {
  file: ConnectionsFile;
  onImported: (result: ImportedProfiles) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("connections");
  const id = useId();
  const importMutation = useImportConnections();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      onImported(await importMutation.mutateAsync({ token: file.token, passphrase }));
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("importPassphrase.title")}</DialogTitle>
            <DialogDescription>
              {t("importPassphrase.description", { name: file.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-passphrase`}>{t("importPassphrase.label")}</Label>
            <Input
              id={`${id}-passphrase`}
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              aria-invalid={error !== null}
              autoFocus
            />
            {error && <p className="text-destructive text-xs">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button type="submit" disabled={importMutation.isPending || passphrase === ""}>
              {t("importPassphrase.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
