import type { ConnectionInfo } from "@odin-db/bindings";
import { CompareSchemaDialog } from "@/features/compare";
import { useCopyTargets } from "../hooks/use-copy-targets";

/** The schema comparison with this app's open connections to compare with. */
export function CompareSchemaDialogFor({
  connection,
  database,
  onClose,
}: {
  connection: ConnectionInfo;
  database: string;
  onClose: () => void;
}) {
  const targets = useCopyTargets();
  return (
    <CompareSchemaDialog
      left={{ connectionId: connection.id, database }}
      targets={targets}
      onClose={onClose}
    />
  );
}
