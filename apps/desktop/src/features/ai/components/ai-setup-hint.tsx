import { Button } from "@odin-db/ui/components/button";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTabs } from "@/features/workspace";
import { useSettings } from "@/lib/settings";

/** Shown instead of the prompt until a model or Ollama is chosen in settings. */
export function AiSetupHint({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation("ai");
  const openSettings = useTabs((s) => s.openSettings);
  const update = useSettings((s) => s.update);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="flex flex-col gap-1">
          <h2 className="font-medium text-sm">{t("setup.title")}</h2>
          <p className="text-muted-foreground text-xs">{t("setup.description")}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            update({ aiEnabled: false });
            onDone();
          }}
        >
          {t("setup.hide")}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            openSettings("ai");
            onDone();
          }}
        >
          {t("setup.open")}
        </Button>
      </div>
    </div>
  );
}
