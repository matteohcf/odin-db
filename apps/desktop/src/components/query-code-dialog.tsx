import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CODE_LANGUAGES, type CodeLanguage, type CodeSource, queryCode } from "@/lib/query-code";
import { useSettings } from "@/lib/settings";

const LANGUAGE_NAMES: Record<CodeLanguage, string> = {
  mongosh: "mongosh",
  javascript: "Node.js",
  python: "Python",
  java: "Java",
  csharp: "C#",
  go: "Go",
};

/** The current query as driver code, in the language the user last picked. */
export function QueryCodeDialog({ source, onClose }: { source: CodeSource; onClose: () => void }) {
  const { t } = useTranslation("common");
  const language = useSettings((s) => s.queryCodeLanguage);
  const update = useSettings((s) => s.update);
  const [copied, setCopied] = useState(false);
  const code = queryCode(source, language);

  const copy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("queryCode.title")}</DialogTitle>
          <DialogDescription>
            {t(
              source.kind === "find"
                ? "queryCode.findDescription"
                : "queryCode.aggregateDescription",
              {
                namespace: `${source.database}.${source.collection}`,
              },
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={language}
            onValueChange={(value) => value && update({ queryCodeLanguage: value as CodeLanguage })}
            aria-label={t("queryCode.language")}
          >
            {CODE_LANGUAGES.map((value) => (
              <ToggleGroupItem key={value} value={value} className="px-3">
                {LANGUAGE_NAMES[value]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? t("queryCode.copied") : t("queryCode.copy")}
          </Button>
        </div>
        <section
          aria-label={t("queryCode.code", { language: LANGUAGE_NAMES[language] })}
          className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40"
        >
          <pre className="p-3 font-mono text-[length:var(--editor-font-size,12.5px)] leading-relaxed selectable">
            {code}
          </pre>
        </section>
        <p className="text-muted-foreground text-xs">{t("queryCode.hint")}</p>
      </DialogContent>
    </Dialog>
  );
}
