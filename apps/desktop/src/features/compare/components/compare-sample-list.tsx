import type { EJsonValue } from "@odin-db/bindings";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { compactEJson } from "@/lib/ejson-display";

interface CompareSampleListProps {
  ids: readonly EJsonValue[];
  /** How many documents are in this group, of which `ids` are the first. */
  count: number;
  /** Opens the two versions side by side; only differing documents have both. */
  onOpen?: (id: EJsonValue) => void;
}

/** The `_id`s of one group of compared documents. */
export function CompareSampleList({ ids, count, onOpen }: CompareSampleListProps) {
  const { t } = useTranslation("compare");
  if (count === 0) {
    return <p className="py-6 text-center text-muted-foreground text-xs">{t("summary.none")}</p>;
  }
  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <ul className="max-h-64 divide-y overflow-y-auto rounded-md border font-mono text-xs selectable">
        {ids.map((id) => {
          const text = compactEJson(id).text;
          return (
            <li key={text}>
              {onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(id)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  {text}
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                </button>
              ) : (
                <span className="block px-3 py-1.5">{text}</span>
              )}
            </li>
          );
        })}
      </ul>
      {count > ids.length && (
        <p className="text-muted-foreground text-xs">
          {t("summary.firstOf", { shown: ids.length, count })}
        </p>
      )}
    </div>
  );
}
