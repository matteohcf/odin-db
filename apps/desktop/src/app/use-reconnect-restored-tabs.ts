import i18n from "i18next";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useConnect, useConnections, useProfiles } from "@/features/connections";
import { useTabs } from "@/features/workspace";
import { errorMessage, hostKeyError } from "@/lib/ipc";
import { useSettings } from "@/lib/settings";

/** Reconnects, once at launch, the connections that tabs restored from the last session use. */
export function useReconnectRestoredTabs() {
  const { data: profiles } = useProfiles();
  const { data: connections } = useConnections();
  const connect = useConnect();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !profiles || !connections) return;
    done.current = true;
    if (!useSettings.getState().reconnectOnLaunch) return;
    const connected = new Set(connections.map((connection) => connection.profileId));
    const used = new Set(
      useTabs.getState().tabs.flatMap((tab) => ("profileId" in tab ? [tab.profileId] : [])),
    );
    for (const profile of profiles) {
      if (!used.has(profile.id) || connected.has(profile.id)) continue;
      connect.mutate(profile.id, {
        onError: (error) => {
          // Host keys get their own dialog, opened by `useConnect`.
          if (hostKeyError(error)) return;
          toast.error(i18n.t("profile.connectFailed", { ns: "connections", name: profile.name }), {
            description: errorMessage(error),
          });
        },
      });
    }
  }, [profiles, connections, connect]);
}
