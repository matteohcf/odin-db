import { Button } from "@odin-db/ui/components/button";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { InlineError } from "@/components/inline-error";

/** A section whose polling stopped on an error: shows it and retries on demand. */
export function PollError({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  const { t } = useTranslation("common");
  return (
    <div className="flex items-start justify-between gap-3">
      <InlineError>{children}</InlineError>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw />
        {t("actions.retry")}
      </Button>
    </div>
  );
}
