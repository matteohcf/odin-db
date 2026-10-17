import type { CopyTarget } from "@/features/transfer";
import { useConnections, useProfiles } from "../api/queries";

/** Open connections, named after their profile, as copy destinations. */
export function useCopyTargets(): CopyTarget[] {
  const { data: connections = [] } = useConnections();
  const { data: profiles = [] } = useProfiles();
  return connections.map((connection) => ({
    connectionId: connection.id,
    name: profiles.find((profile) => profile.id === connection.profileId)?.name ?? "",
    readOnly: connection.readOnly,
  }));
}
