import { type ConnectionInfo, commands, type UserInfo } from "@odin-db/bindings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@odin-db/ui/components/alert-dialog";
import { Badge } from "@odin-db/ui/components/badge";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, KeyRound, Loader2, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { call, errorMessage } from "@/lib/ipc";
import { generatePassword } from "../lib/password";
import { UserDialog } from "./user-dialog";

type Editing =
  | { kind: "create" }
  | { kind: "roles"; user: UserInfo }
  | { kind: "password"; user: UserInfo }
  | { kind: "drop"; user: UserInfo };

/** Every user of the deployment, with their roles; read-only connections only look. */
export function UsersView({
  connection,
  profileName,
}: {
  connection: ConnectionInfo;
  profileName: string;
}) {
  const { t } = useTranslation("users");
  const queryClient = useQueryClient();
  const key = ["users", connection.id];
  const users = useQuery({ queryKey: key, queryFn: () => call(commands.listUsers(connection.id)) });
  const [editing, setEditing] = useState<Editing | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const writable = !connection.readOnly;

  async function drop(user: UserInfo) {
    try {
      await call(commands.dropUser(connection.id, user.db, user.user));
      toast.success(t("drop.done", { name: user.user }));
    } catch (error) {
      toast.error(errorMessage(error));
    }
    setEditing(null);
    refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="font-semibold text-base">{t("title")}</h1>
        <span className="truncate text-muted-foreground text-sm">{profileName}</span>
        {writable && (
          <Button size="sm" className="ml-auto" onClick={() => setEditing({ kind: "create" })}>
            <Plus />
            {t("new")}
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {users.isPending ? (
          <p className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t("loading")}
          </p>
        ) : users.error ? (
          <p role="alert" className="flex items-start gap-2 text-destructive text-sm selectable">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {t("failed", { message: errorMessage(users.error) })}
          </p>
        ) : users.data.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border p-8 text-center text-muted-foreground text-sm">
            <UserRound className="size-5" />
            {t("none")}
          </div>
        ) : (
          <table className="w-full overflow-hidden rounded-lg border text-sm">
            <thead className="bg-muted/40 text-left text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">{t("table.user")}</th>
                <th className="px-3 py-2 font-medium">{t("table.database")}</th>
                <th className="px-3 py-2 font-medium">{t("table.roles")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.data.map((user) => (
                <tr key={`${user.db}.${user.user}`} className="group border-t align-top">
                  <td className="px-3 py-2.5 font-medium selectable">{user.user}</td>
                  <td className="px-3 py-2.5 font-mono text-muted-foreground text-xs">{user.db}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.length === 0 ? (
                        <span className="text-muted-foreground text-xs">{t("table.noRoles")}</span>
                      ) : (
                        user.roles.map((role) => (
                          <Badge
                            key={`${role.role}@${role.db}`}
                            variant="secondary"
                            className="font-mono text-[11px]"
                          >
                            {role.role}
                            <span className="text-muted-foreground">@{role.db}</span>
                          </Badge>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {writable && (
                      <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={t("actions.roles", { name: user.user })}
                          onClick={() => setEditing({ kind: "roles", user })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={t("actions.password", { name: user.user })}
                          onClick={() => setEditing({ kind: "password", user })}
                        >
                          <KeyRound />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 hover:text-destructive"
                          aria-label={t("actions.drop", { name: user.user })}
                          onClick={() => setEditing({ kind: "drop", user })}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(editing?.kind === "create" || editing?.kind === "roles") && (
        <UserDialog
          connectionId={connection.id}
          user={editing.kind === "roles" ? editing.user : undefined}
          onSaved={refresh}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === "password" && (
        <PasswordDialog
          connection={connection}
          user={editing.user}
          onClose={() => setEditing(null)}
        />
      )}
      <AlertDialog
        open={editing?.kind === "drop"}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("drop.title", { name: editing?.kind === "drop" ? editing.user.user : "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("drop.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => editing?.kind === "drop" && void drop(editing.user)}
            >
              {t("drop.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PasswordDialog({
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
        {error && (
          <p role="alert" className="text-destructive text-xs selectable">
            {error}
          </p>
        )}
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
