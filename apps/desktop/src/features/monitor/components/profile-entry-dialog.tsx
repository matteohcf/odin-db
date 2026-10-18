import type { ProfileEntry } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toShellSyntax } from "@/lib/shell-syntax";
import { profiledQuery } from "../lib/profile";

/** One recorded operation in full: its numbers and the command as the server received it. */
export function ProfileEntryDialog({
  entry,
  onOpenQuery,
  onClose,
}: {
  entry: ProfileEntry;
  /** Reruns the operation's query in its collection, where Explain can suggest an index. */
  onOpenQuery: (query: NonNullable<ReturnType<typeof profiledQuery>>) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("monitor");
  const number = (value: number | null) =>
    value === null ? "—" : value.toLocaleString(i18n.language);
  const facts = [
    ["profiler.when", new Date(entry.at ?? 0).toLocaleString(i18n.language)],
    ["profiler.duration", `${number(entry.millis)} ms`],
    ["profiler.docsExamined", number(entry.docsExamined)],
    ["profiler.keysExamined", number(entry.keysExamined)],
    ["profiler.returned", number(entry.returned)],
    ["profiler.plan", entry.planSummary ?? "—"],
    ["profiler.app", entry.appName ?? "—"],
  ] as const;
  const query = profiledQuery(entry);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {entry.op} <span className="font-mono font-normal text-sm">{entry.ns}</span>
          </DialogTitle>
          <DialogDescription>{t("profiler.detailsHint")}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-xs">
          {facts.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{t(key)}</dt>
              <dd className="font-mono selectable">{value}</dd>
            </div>
          ))}
        </dl>
        {entry.command && (
          <pre className="min-h-0 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs selectable">
            {toShellSyntax(entry.command)}
          </pre>
        )}
        {query && (
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => {
                onOpenQuery(query);
                onClose();
              }}
            >
              <ExternalLink />
              {t("profiler.openQuery")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
