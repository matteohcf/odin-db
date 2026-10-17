import { type ConnectionInfo, type ConnectionProfile, events } from "@odin-db/bindings";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { connectionKeys } from "../api/keys";
import { useConnectionHealth } from "../store/health-store";

/** Mirrors the backend's connection health events (ADR-0006) and tells the user. */
export function useHealthEvents() {
  const { t } = useTranslation("connections");
  const queryClient = useQueryClient();
  const setReachable = useConnectionHealth((s) => s.setReachable);

  useEffect(() => {
    const unlisten = events.connectionHealthChanged.listen(({ payload }) => {
      setReachable(payload.connectionId, payload.reachable);
      const connection = queryClient
        .getQueryData<ConnectionInfo[]>(connectionKeys.connections)
        ?.find((c) => c.id === payload.connectionId);
      const name = queryClient
        .getQueryData<ConnectionProfile[]>(connectionKeys.profiles)
        ?.find((profile) => profile.id === connection?.profileId)?.name;
      if (!name) return;
      if (payload.reachable) toast.success(t("health.restored", { name }));
      else toast.warning(t("health.lost", { name }), { duration: 8000 });
    });
    return () => void unlisten.then((stop) => stop());
  }, [queryClient, setReachable, t]);
}
