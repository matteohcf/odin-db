import type { ConnectionId, ConnectionInfo } from "@odin-db/bindings";
import { useQueryClient } from "@tanstack/react-query";
import { CopyDialog } from "@/features/transfer";
import { connectionKeys } from "../api/keys";
import { useCopyTargets } from "../hooks/use-copy-targets";

/** The copy dialog with this app's connections as targets; refreshes the target's tree. */
export function CopyDialogFor({
  connection,
  database,
  collection,
  target,
  onClose,
}: {
  connection: ConnectionInfo;
  database: string;
  collection?: string | undefined;
  target?: { connectionId: ConnectionId; database: string } | undefined;
  onClose: () => void;
}) {
  const targets = useCopyTargets();
  const queryClient = useQueryClient();
  return (
    <CopyDialog
      sourceConnectionId={connection.id}
      database={database}
      collection={collection}
      targets={targets}
      target={target}
      onCopied={(target) =>
        void queryClient.invalidateQueries({ queryKey: connectionKeys.connection(target) })
      }
      onClose={onClose}
    />
  );
}
