import { CircleAlert, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useToolsStatus } from "../api/use-tools-status";

const DOWNLOAD_URL = "https://www.mongodb.com/try/download/database-tools";

/** Renders `children` only when mongodump/mongorestore are available, otherwise explains how to get them. */
export function ToolsGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation("backup");
  const status = useToolsStatus();

  if (status.isPending) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin" />
        {t("tools.checking")}
      </p>
    );
  }
  if (!status.data?.available) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-warning">
          <CircleAlert className="size-4" />
          {t("tools.missingTitle")}
        </p>
        <p className="text-muted-foreground">{t("tools.missingBody")}</p>
        <p className="font-mono text-xs selectable">{t("tools.download", { url: DOWNLOAD_URL })}</p>
      </div>
    );
  }
  return (
    <>
      {children}
      {status.data.version && (
        <p className="text-muted-foreground text-xs">
          {t("tools.version", { version: status.data.version })}
        </p>
      )}
    </>
  );
}
