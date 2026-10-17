import type { ConnectionProfile } from "@odin-db/bindings";
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
import { toast } from "sonner";
import { errorMessage } from "@/lib/ipc";
import { useSetGroup } from "../api/mutations";

/** Renames a group by moving its connections; a name in use merges the two. */
export function RenameGroupDialog({
  group,
  members,
  onClose,
}: {
  group: string;
  members: ConnectionProfile[];
  onClose: () => void;
}) {
  const { t } = useTranslation("connections");
  const id = useId();
  const setGroup = useSetGroup();
  const [name, setName] = useState(group);
  const newName = name.trim();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await setGroup.mutateAsync({ profiles: members, group: newName });
    } catch (error) {
      toast.error(errorMessage(error));
      return;
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("group.renameTitle", { name: group })}</DialogTitle>
            <DialogDescription>
              {t("group.renameDescription", { count: members.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>{t("group.name")}</Label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.target.select()}
              autoFocus
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button
              type="submit"
              disabled={setGroup.isPending || newName === "" || newName === group}
            >
              {t("group.renameSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
