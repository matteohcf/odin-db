import { type ConnectionInfo, type CustomRole, commands } from "@odin-db/bindings";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@odin-db/ui/components/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { InlineError } from "@/components/inline-error";
import { call, errorMessage } from "@/lib/ipc";
import { resourceText } from "../lib/privileges";
import { RoleBadge } from "./role-badge";
import { RoleDialog } from "./role-dialog";

type Editing =
  | { kind: "create" }
  | { kind: "edit"; role: CustomRole }
  | { kind: "drop"; role: CustomRole };

/** The deployment's custom roles: what each allows and inherits. */
export function CustomRolesSection({ connection }: { connection: ConnectionInfo }) {
  const { t } = useTranslation("users");
  const queryClient = useQueryClient();
  const key = ["custom-roles", connection.id];
  const roles = useQuery({
    queryKey: key,
    queryFn: () => call(commands.listCustomRoles(connection.id)),
  });
  const [editing, setEditing] = useState<Editing | null>(null);
  const writable = !connection.readOnly;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    // Granting a role offers custom ones too.
    void queryClient.invalidateQueries({ queryKey: ["roles", connection.id] });
  };

  async function drop(role: CustomRole) {
    try {
      await call(commands.dropRole(connection.id, role.db, role.role));
      toast.success(t("customRoles.dropped", { name: role.role }));
    } catch (error) {
      toast.error(errorMessage(error));
    }
    setEditing(null);
    refresh();
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-sm">{t("customRoles.title")}</h2>
        {writable && (
          <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "create" })}>
            <Plus />
            {t("customRoles.new")}
          </Button>
        )}
      </div>
      {roles.error ? (
        <InlineError>{t("customRoles.failed", { message: errorMessage(roles.error) })}</InlineError>
      ) : roles.data?.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-xs">
          {t("customRoles.none")}
        </p>
      ) : roles.data ? (
        <div className="overflow-hidden rounded-lg border">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("customRoles.role")}</TableHead>
                <TableHead>{t("customRoles.privileges")}</TableHead>
                <TableHead>{t("customRoles.inherits")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.data.map((role) => (
                <TableRow key={`${role.db}.${role.role}`} className="group align-top">
                  <TableCell className="py-2.5">
                    <span className="font-medium selectable">{role.role}</span>
                    <span className="ml-1 font-mono text-muted-foreground text-xs">@{role.db}</span>
                  </TableCell>
                  <TableCell>
                    {role.privileges.length === 0 ? (
                      <span className="text-muted-foreground text-xs">
                        {t("customRoles.noPrivileges")}
                      </span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {role.privileges.map((privilege, index) => (
                          // Privileges have no identity of their own; the list is read-only.
                          <li key={index} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                            <span className="font-mono text-foreground">
                              {resourceText(privilege.resource)}
                            </span>
                            <span className="font-mono text-muted-foreground">
                              {privilege.actions.join(", ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {role.roles.length === 0 ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        role.roles.map((inherited) => (
                          <RoleBadge key={`${inherited.role}@${inherited.db}`} role={inherited} />
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
                          aria-label={t("customRoles.edit", { name: role.role })}
                          onClick={() => setEditing({ kind: "edit", role })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 hover:text-destructive"
                          aria-label={t("customRoles.drop", { name: role.role })}
                          onClick={() => setEditing({ kind: "drop", role })}
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
      ) : null}

      {(editing?.kind === "create" || editing?.kind === "edit") && (
        <RoleDialog
          connectionId={connection.id}
          role={editing.kind === "edit" ? editing.role : undefined}
          onSaved={refresh}
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
              {t("customRoles.dropTitle", {
                name: editing?.kind === "drop" ? editing.role.role : "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("customRoles.dropBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => editing?.kind === "drop" && void drop(editing.role)}
            >
              {t("customRoles.dropConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
