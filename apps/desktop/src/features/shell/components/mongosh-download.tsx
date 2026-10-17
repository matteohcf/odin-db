import { commands, type DownloadProgress } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Progress } from "@odin-db/ui/components/progress";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOperation } from "@/hooks/use-operation";
import { formatBytes } from "@/lib/format";
import { mongoshStatusKey } from "../api/use-mongosh-status";

/** Downloads the pinned mongosh into the app's data directory, with progress. */
export function MongoshDownload({ version }: { version: string }) {
  const { t, i18n } = useTranslation("shell");
  const queryClient = useQueryClient();
  const operation = useOperation<DownloadProgress>();
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const { state } = operation;

  async function download() {
    setProgress(null);
    await operation.start((channel) => commands.downloadMongosh(channel), setProgress);
    await queryClient.invalidateQueries({ queryKey: mongoshStatusKey });
  }

  if (state.status === "running") {
    const total = progress?.total ?? null;
    const received = progress?.received ?? 0;
    const done = total !== null && received >= total;
    const size = (bytes: number) => formatBytes(bytes, i18n.language);
    return (
      <div className="flex w-80 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span>{done ? t("missing.verifying") : t("missing.downloading", { version })}</span>
          <span className="text-muted-foreground tabular-nums">
            {total === null
              ? t("missing.progressUnknown", { received: size(received) })
              : t("missing.progress", { received: size(received), total: size(total) })}
          </span>
        </div>
        <Progress
          value={total ? (received / total) * 100 : null}
          aria-label={t("missing.downloading", { version })}
        />
        <Button size="sm" variant="ghost" className="self-center" onClick={operation.cancel}>
          {t("missing.cancel")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {state.status === "failed" && (
        <p role="alert" className="flex items-center gap-1.5 text-destructive text-xs selectable">
          <CircleAlert className="size-3.5 shrink-0" />
          {t("missing.failed", { message: state.error })}
        </p>
      )}
      <Button size="sm" onClick={() => void download()}>
        <Download />
        {state.status === "failed" ? t("missing.retry") : t("missing.download", { version })}
      </Button>
      <p className="text-muted-foreground text-xs">{t("missing.verified")}</p>
    </div>
  );
}
