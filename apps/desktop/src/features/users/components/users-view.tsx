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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@odin-db/ui/components/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { InlineError } from "@/components/inline-error";
import { PageHeader } from "@/components/page-header";
import { call, errorMessage } from "@/lib/ipc";
import { generatePassword } from "../lib/password";
import { CustomRolesSection } from "./custom-roles-section";
import { RoleBadge } from "./role-badge";
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
      <PageHeader icon={UsersRound} title={t("title")} subtitle={profileName}>
        {writable && (
          <Button size="sm" onClick={() => setEditing({ kind: "create" })}>
            <Plus />
            {t("new")}
          </Button>
        )}
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-4">
        <section className="flex flex-col gap-3">
          <h2 className="font-medium text-sm">{t("usersTitle")}</h2>
          {users.isPending ? (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" />
              {t("loading")}
            </p>
          ) : users.error ? (
            <InlineError>{t("failed", { message: errorMessage(users.error) })}</InlineError>
          ) : users.data.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-xs">
              {t("none")}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("table.user")}</TableHead>
                    <TableHead>{t("table.database")}</TableHead>
                    <TableHead>{t("table.roles")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t("columns.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.data.map((user) => (
                    <TableRow key={`${user.db}.${user.user}`} className="group align-top">
                      <TableCell className="py-2.5 font-medium selectable">{user.user}</TableCell>
                      <TableCell className="py-2.5 font-mono text-muted-foreground text-xs">
                        {user.db}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {user.roles.length === 0 ? (
                            <span className="text-muted-foreground text-xs">
                              {t("table.noRoles")}
                            </span>
                          ) : (
                            user.roles.map((role) => (
                              <RoleBadge key={`${role.role}@${role.db}`} role={role} />
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-right">
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
        <CustomRolesSection connection={connection} />
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
