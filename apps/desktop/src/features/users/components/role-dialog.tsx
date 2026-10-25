import {
  type ConnectionId,
  type CustomRole,
  commands,
  type Privilege,
  type RoleRef,
} from "@odin-db/bindings";
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
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormField } from "@/components/form-field";
import { InlineError } from "@/components/inline-error";
import { call, errorMessage } from "@/lib/ipc";
import { cleanPrivileges } from "../lib/privileges";
import { PrivilegesEditor } from "./privileges-editor";
import { RolesEditor } from "./roles-editor";

/** Creates a custom role, or replaces an existing one's privileges and inherited roles. */
export function RoleDialog({
  connectionId,
  role,
  onSaved,
  onClose,
}: {
  connectionId: ConnectionId;
  /** Present to edit this role; absent to create one. */
  role?: CustomRole | undefined;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("users");
  const id = useId();
  const [database, setDatabase] = useState(role?.db ?? "admin");
  const [name, setName] = useState(role?.role ?? "");
  const [privileges, setPrivileges] = useState<Privilege[]>(
    role?.privileges ?? [{ resource: { kind: "namespace", db: "", collection: "" }, actions: [] }],
  );
  const [inherited, setInherited] = useState<RoleRef[]>(role?.roles ?? []);
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
    const db = role?.db ?? database.trim();
    const chosenPrivileges = cleanPrivileges(privileges);
    const chosenRoles = inherited
      .map((r) => ({ role: r.role.trim(), db: r.db.trim() || db }))
      .filter((r) => r.role !== "");
    setPending(true);
    try {
      if (role) {
        await call(commands.updateRole(connectionId, db, role.role, chosenPrivileges, chosenRoles));
        toast.success(t("roleDialog.saved", { name: role.role }));
      } else {
        await call(commands.createRole(connectionId, db, name, chosenPrivileges, chosenRoles));
        toast.success(t("roleDialog.created", { name: name.trim() }));
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
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {role ? t("roleDialog.editTitle", { name: role.role }) : t("roleDialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {role
                ? t("roleDialog.editDescription", { db: role.db })
                : t("roleDialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          {!role && (
            <div className="grid grid-cols-2 gap-3">
              <FormField id={`${id}-name`} label={t("roleDialog.name")}>
                <Input
                  id={`${id}-name`}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                />
              </FormField>
              <FormField id={`${id}-db`} label={t("roleDialog.database")}>
                <Input
                  id={`${id}-db`}
                  value={database}
                  onChange={(event) => setDatabase(event.target.value)}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
              </FormField>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-sm">{t("roleDialog.privileges")}</span>
            <PrivilegesEditor
              privileges={privileges}
              onChange={setPrivileges}
              defaultDb={database === "admin" ? "" : database}
            />
            <p className="text-muted-foreground text-xs">{t("roleDialog.privilegesHint")}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-sm">{t("roleDialog.inherits")}</span>
            <RolesEditor
              roles={inherited}
              onChange={setInherited}
              suggestions={(known.data ?? [])
                .map((r) => r.role)
                .filter((r) => r !== (role?.role ?? name))}
              defaultDb={database}
            />
          </div>
          {error && <InlineError>{error}</InlineError>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button type="submit" disabled={pending || (!role && !name.trim())}>
              {role ? t("roleDialog.save") : t("roleDialog.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
