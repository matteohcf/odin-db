import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/** Live tool output, pinned to the latest line. */
export function ToolLog({ lines }: { lines: readonly string[] }) {
  const { t } = useTranslation("backup");
  const end = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever a line arrives.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  return (
    <div
      role="log"
      aria-label={t("log.label")}
      className="h-40 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground selectable"
    >
      {lines.map((line, index) => (
        // Log lines are append-only and never reordered.
        <div key={index} className="whitespace-pre-wrap break-all">
          {line}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
