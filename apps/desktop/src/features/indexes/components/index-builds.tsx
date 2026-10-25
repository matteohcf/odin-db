import { type ConnectionId, commands, type Namespace } from "@odin-db/bindings";
import { Progress } from "@odin-db/ui/components/progress";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { call } from "@/lib/ipc";
import { indexBuildsKey } from "../api/indexes";

interface IndexBuildsProps {
  connectionId: ConnectionId;
  namespace: Namespace;
  /** A build ended: the index list has a new entry. */
  onFinished: () => void;
  /** An index is being created from here: watch closely, its build shows up any moment. */
  watching: boolean;
}

/** Index builds running on the collection, with their progress; nothing when there are none. */
export function IndexBuilds({ connectionId, namespace, onFinished, watching }: IndexBuildsProps) {
  const { t, i18n } = useTranslation("indexes");
  const builds = useQuery({
    queryKey: indexBuildsKey(connectionId, namespace),
    queryFn: () => call(commands.indexBuilds(connectionId, namespace)),
    // Close watch while a build runs; an occasional look otherwise, to notice one started elsewhere.
    refetchInterval: (query) => (watching || (query.state.data?.length ?? 0) > 0 ? 2_000 : 15_000),
    refetchIntervalInBackground: false,
  });
  const running = builds.data?.length ?? 0;
  const previous = useRef(running);
  useEffect(() => {
    if (previous.current > running) onFinished();
    previous.current = running;
  }, [running, onFinished]);

  if (!builds.data?.length) return null;
  const percent = (done: number | null, total: number | null) =>
    done != null && total ? Math.min(100, (done / total) * 100) : null;

  return (
    <ul
      className="flex flex-col gap-2 border-b bg-muted/30 px-3 py-2.5"
      aria-label={t("builds.label")}
    >
      {builds.data.map((build) => {
        const progress = percent(build.done, build.total);
        return (
          <li key={build.names.join(",")} className="flex items-center gap-3 text-xs">
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            <span className="font-medium">
              {t("builds.building", { names: build.names.join(", ") || "…" })}
            </span>
            <span className="truncate text-muted-foreground">{build.phase}</span>
            <Progress value={progress} className="ml-auto h-1.5 w-40 shrink-0" />
            <span className="w-24 shrink-0 text-right text-muted-foreground tabular-nums">
              {progress != null &&
                `${progress.toLocaleString(i18n.language, { maximumFractionDigits: 0 })}% · `}
              {t("builds.seconds", { count: Math.round(build.seconds ?? 0) })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
