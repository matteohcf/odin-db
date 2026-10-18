import type { ConnectionInfo } from "@odin-db/bindings";
import { CompareCollectionsDialog } from "@/features/compare";
import { useCopyTargets } from "../hooks/use-copy-targets";

/** The compare dialog with this app's open connections to compare with. */
export function CompareDialogFor({
  connection,
  database,
  collection,
  onClose,
}: {
  connection: ConnectionInfo;
  database: string;
  collection: string;
  onClose: () => void;
}) {
  const targets = useCopyTargets();
  return (
    <CompareCollectionsDialog
      left={{ connectionId: connection.id, database, collection }}
      targets={targets}
      onClose={onClose}
    />
  );
}
