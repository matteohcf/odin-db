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
import { COPY_FORMATS, formatValue } from "@/lib/copy-formats";

/** "Copy as" with every text format, for one document or several. */
export function CopyAsMenu({ value, label }: { value: JsonValue; label: string }) {
  const { t } = useTranslation("results");
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Copy />
        {label}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-56">
        {COPY_FORMATS.map((format) => (
          <ContextMenuItem
            key={format}
            onSelect={() => {
              void navigator.clipboard.writeText(formatValue(value, format));
              toast.success(t("row.copied"));
            }}
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
