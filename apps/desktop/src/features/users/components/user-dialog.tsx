import { type ConnectionId, commands, type RoleRef, type UserInfo } from "@odin-db/bindings";
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
import { useQuery } from "@tanstack/react-query";
import { Copy, RefreshCw } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { InlineError } from "@/components/inline-error";
import { call, errorMessage } from "@/lib/ipc";
import { generatePassword } from "../lib/password";
import { RolesEditor } from "./roles-editor";

interface UserDialogProps {
  connectionId: ConnectionId;
  /** Present to edit this user's roles; absent to create a user. */
  user?: UserInfo | undefined;
  onSaved: () => void;
  onClose: () => void;
}

/** Creates a user, or changes an existing user's roles. */
export function UserDialog({ connectionId, user, onSaved, onClose }: UserDialogProps) {
  const { t } = useTranslation("users");
  const id = useId();
  const [database, setDatabase] = useState(user?.db ?? "admin");
  const [name, setName] = useState(user?.user ?? "");
  const [password, setPassword] = useState(() => (user ? "" : generatePassword()));
  const [roles, setRoles] = useState<RoleRef[]>(user?.roles ?? [{ role: "readWrite", db: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const known = useQuery({
    queryKey: ["roles", connectionId, database],
    queryFn: () => call(commands.listRoles(connectionId, database || "admin")),
    enabled: database.trim() !== "",
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const chosen = roles
      .map((role) => ({ role: role.role.trim(), db: role.db.trim() || database.trim() }))
      .filter((role) => role.role !== "");
    setPending(true);
    try {
      if (user) {
        await call(commands.setUserRoles(connectionId, user.db, user.user, chosen));
        toast.success(t("dialog.rolesSaved", { name: user.user }));
      } else {
        await call(commands.createUser(connectionId, database.trim(), name, password, chosen));
        toast.success(t("dialog.created", { name: name.trim() }));
      }
    } catch (cause) {
      setError(errorMessage(cause));
      setPending(false);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {user ? t("dialog.editTitle", { name: user.user }) : t("dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {user ? t("dialog.editDescription", { db: user.db }) : t("dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          {!user && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-name`}>{t("dialog.name")}</Label>
                  <Input
                    id={`${id}-name`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-db`}>{t("dialog.database")}</Label>
                  <Input
                    id={`${id}-db`}
                    value={database}
                    onChange={(event) => setDatabase(event.target.value)}
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-password`}>{t("dialog.password")}</Label>
                <div className="flex gap-2">
                  <Input
                    id={`${id}-password`}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="font-mono text-xs"
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("dialog.generate")}
                    title={t("dialog.generate")}
                    onClick={() => setPassword(generatePassword())}
                  >
                    <RefreshCw />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("dialog.copyPassword")}
                    title={t("dialog.copyPassword")}
                    onClick={() => {
                      void navigator.clipboard.writeText(password);
                      toast.success(t("dialog.passwordCopied"));
                    }}
                  >
                    <Copy />
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">{t("dialog.passwordHint")}</p>
              </div>
            </>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-sm">{t("dialog.roles")}</span>
            <RolesEditor
              roles={roles}
              onChange={setRoles}
              suggestions={(known.data ?? []).map((role) => role.role)}
              defaultDb={database}
            />
            <p className="text-muted-foreground text-xs">{t("dialog.rolesHint")}</p>
          </div>
          {error && <InlineError>{error}</InlineError>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button type="submit" disabled={pending || (!user && (!name.trim() || !password))}>
              {user ? t("dialog.saveRoles") : t("dialog.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
