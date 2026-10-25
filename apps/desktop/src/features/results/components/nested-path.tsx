import { Button } from "@odin-db/ui/components/button";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

interface NestedPathProps {
  label: string;
  path: readonly string[];
  count: number;
  onOpen: (path: readonly string[]) => void;
}

/** Where the table stands inside the documents, with a way back up. */
export function NestedPath({ label, path, count, onOpen }: NestedPathProps) {
  const { t } = useTranslation("results");
  return (
    <nav
      aria-label={t("nested.label")}
      className="flex h-8 shrink-0 items-center gap-1 border-b bg-muted/30 px-2 text-xs"
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5"
        onClick={() => onOpen(path.slice(0, -1))}
        aria-label={t("nested.up")}
        title={t("nested.up")}
      >
        <ArrowLeft />
      </Button>
      <button
        type="button"
        onClick={() => onOpen([])}
        className="rounded-sm px-1 text-muted-foreground hover:text-foreground"
      >
        {t("nested.documents")}
      </button>
      {path.map((field, index) => (
        <Fragment key={`${index}-${field}`}>
          <ChevronRight className="size-3 text-muted-foreground" />
          <button
            type="button"
            onClick={() => onOpen(path.slice(0, index + 1))}
            aria-current={index === path.length - 1 ? "location" : undefined}
            className="rounded-sm px-1 font-mono hover:text-foreground aria-[current]:font-medium aria-[current]:text-foreground"
          >
            {field}
          </button>
        </Fragment>
      ))}
      <span className="ml-auto text-muted-foreground">
        {t("nested.count", { count, collection: label })}
      </span>
    </nav>
  );
}
