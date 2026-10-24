import type { JsonValue } from "@odin-db/bindings";
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@odin-db/ui/components/context-menu";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CopyFormat } from "@/lib/copy-formats";

const FORMATS: readonly CopyFormat[] = ["shell", "json", "relaxed", "canonical"];

/** "Copy as" with every text format, for one document or several. */
export function CopyAsMenu({ value, label }: { value: JsonValue; label: string }) {
  const { t } = useTranslation("results");
  return (
    <ContextMenuSub>
      {/* shadcn's sub-trigger has no gap of its own, unlike its items. */}
      <ContextMenuSubTrigger className="gap-2">
        <Copy />
        {label}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-56">
        {FORMATS.map((format) => (
          <ContextMenuItem
            key={format}
            onSelect={() =>
              // The converters bring bson along: loaded on first use, not at startup.
              void import("@/lib/copy-formats").then(async ({ formatValue }) => {
                await navigator.clipboard.writeText(formatValue(value, format));
                toast.success(t("row.copied"));
              })
            }
          >
            <span className="flex flex-col">
              <span>{t(`copyAs.${format}`)}</span>
              <span className="text-muted-foreground text-xs">{t(`copyAs.${format}Hint`)}</span>
            </span>
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
