import { Button } from "@odin-db/ui/components/button";
import { cn } from "@odin-db/ui/lib/utils";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { errorMessage, hostKeyError } from "@/lib/ipc";

/** The outcome of testing a connection: the server version, the error, or an SSH host key to trust. */
export function TestResult({
  pending,
  error,
  version,
  onTrustHostKey,
}: {
  pending: boolean;
  error: Error | null;
  version: string | undefined;
  onTrustHostKey: (fingerprint: string) => void;
}) {
  const { t } = useTranslation("connections");
  const hostKey = hostKeyError(error);
  if (!pending && hostKey) {
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-col gap-2 rounded-md border p-3 text-xs",
          hostKey.changed
            ? "border-destructive/50 bg-destructive/5"
            : "border-warning/50 bg-warning/5",
        )}
      >
        <p className="font-medium">
          {hostKey.changed ? t("hostKey.changedTitle") : t("hostKey.unknownTitle")}
        </p>
        <p className="text-muted-foreground">
          {hostKey.changed ? t("hostKey.changedShort") : t("hostKey.unknownShort")}
        </p>
        <code className="break-all font-mono selectable">{hostKey.fingerprint}</code>
        <Button
          type="button"
          size="sm"
          variant={hostKey.changed ? "destructive" : "outline"}
          className="self-start"
          onClick={() => onTrustHostKey(hostKey.fingerprint)}
        >
          {hostKey.changed ? t("hostKey.trustNewAndTest") : t("hostKey.trustAndTest")}
        </Button>
      </div>
    );
  }
  if (pending) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        {t("dialog.testing")}
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="flex items-start gap-2 text-destructive text-xs selectable">
        <CircleAlert className="mt-px size-3.5 shrink-0" />
        <span className="break-words">{errorMessage(error)}</span>
      </p>
    );
  }
  if (version) {
    return (
      <p className="flex items-center gap-2 text-success text-xs">
        <CircleCheck className="size-3.5" />
        {t("dialog.testOk", { version })}
      </p>
    );
  }
  return null;
}
