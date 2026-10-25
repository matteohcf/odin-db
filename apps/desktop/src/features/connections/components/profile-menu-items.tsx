import type { ConnectionProfile } from "@odin-db/bindings";
import { DropdownMenuItem, DropdownMenuSeparator } from "@odin-db/ui/components/dropdown-menu";
import { CopyPlus, FileDown, Link, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDuplicateProfile } from "../api/mutations";

interface ProfileMenuItemsProps {
  profile: ConnectionProfile;
  onEdit: () => void;
  onDelete: () => void;
  onExport: () => void;
}

/** The saved profile's own actions, the same in the tree and in the connection manager. */
export function ProfileMenuItems({ profile, onEdit, onDelete, onExport }: ProfileMenuItemsProps) {
  const { t } = useTranslation("connections");
  const duplicate = useDuplicateProfile();
  return (
    <>
      <DropdownMenuItem onSelect={onEdit}>
        <Pencil />
        {t("profile.edit")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() =>
          // The menu unmounts as it closes, so per-call callbacks would never run: await instead.
          void duplicate
            .mutateAsync({ id: profile.id, name: t("profile.copyName", { name: profile.name }) })
            .then(
              (copy) => toast.success(t("profile.duplicated", { name: copy.name })),
              () => {},
            )
        }
      >
        <CopyPlus />
        {t("profile.duplicate")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          void navigator.clipboard.writeText(profile.connectionString);
          toast.success(t("profile.uriCopied"));
        }}
      >
        <Link />
        {t("profile.copyUri")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onExport}>
        <FileDown />
        {t("profile.export")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={onDelete}>
        <Trash2 />
        {t("profile.delete")}
      </DropdownMenuItem>
    </>
  );
}
