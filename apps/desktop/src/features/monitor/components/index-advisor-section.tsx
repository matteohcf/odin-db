import { type ConnectionInfo, commands, type IndexAdvice } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCopy, Lightbulb, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { IconAction } from "@/components/icon-action";
import { InlineError } from "@/components/inline-error";
import { CreateIndexDialog } from "@/features/indexes";
import { useTabs } from "@/features/workspace";
import { formatCount } from "@/lib/format";
import { call } from "@/lib/ipc";
import { toShellSyntax } from "@/lib/shell-syntax";
import { createIndexCommand, formatMillis } from "../lib/advice";
import { MonitorSection } from "./monitor-section";
import { SectionNote } from "./section-note";

/** Indexes the server's slow operations ask for, with one click to create them. */
export function IndexAdvisorSection({ connection }: { connection: ConnectionInfo }) {
  const { t, i18n } = useTranslation("monitor");
  const openCollection = useTabs((s) => s.openCollection);
  const [creating, setCreating] = useState<IndexAdvice | null>(null);
  const report = useQuery({
    queryKey: ["index-advice", connection.id],
    queryFn: () => call(commands.indexAdvice(connection.id)),
  });
  const count = (n: number | null) => formatCount(Math.round(n ?? 0), i18n.language);
  const readable = report.data?.sources.filter((source) => !source.error) ?? [];
  const sourceText = readable
    .map((source) =>
      source.name === "log"
        ? t("advisor.fromLog", { count: Math.round(source.operations ?? 0) })
        : t("advisor.fromProfiler", { database: source.name }),
    )
    .join(" · ");

  return (
    <MonitorSection
      title={t("advisor.title")}
      icon={Lightbulb}
      detail={<span className="truncate text-muted-foreground text-xs">{sourceText}</span>}
      actions={
        <Button
          size="sm"
          variant="ghost"
          disabled={report.isFetching}
          onClick={() => void report.refetch()}
        >
          <RefreshCw className={report.isFetching ? "animate-spin" : undefined} />
          {t("advisor.refresh")}
        </Button>
      }
    >
      {report.error ? (
        <InlineError>{report.error.message}</InlineError>
      ) : !report.data ? (
        <SectionNote>{t("advisor.loading")}</SectionNote>
      ) : readable.length === 0 ? (
        <SectionNote>{t("advisor.noSources")}</SectionNote>
      ) : report.data.advice.length === 0 ? (
        <SectionNote>{t("advisor.none")}</SectionNote>
      ) : (
        <ul className="divide-y rounded-lg border">
          {report.data.advice.map((advice) => {
            const keys = toShellSyntax(advice.keys, 0);
            return (
              <li
                key={`${advice.database}.${advice.collection} ${keys}`}
                className="flex items-center gap-4 px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      className="truncate font-medium text-sm hover:underline"
                      onClick={() =>
                        openCollection({
                          profileId: connection.profileId,
                          database: advice.database,
                          collection: advice.collection,
                          collectionKind: "collection",
                        })
                      }
                    >
                      {advice.database}.{advice.collection}
                    </button>
                    <code className="truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs selectable">
                      {keys}
                    </code>
                    {advice.collectionScan && (
                      <Badge variant="warning" className="shrink-0">
                        {t("advisor.collectionScan")}
                      </Badge>
                    )}
                    {advice.existing && (
                      <Badge variant="outline" className="shrink-0">
                        {t("advisor.existing", { name: advice.existing })}
                      </Badge>
                    )}
                  </div>
                  <p
                    className="truncate text-muted-foreground text-xs"
                    title={toShellSyntax(advice.example, 0)}
                  >
                    {t("advisor.stats", {
                      count: Math.round(advice.occurrences ?? 0),
                      total: formatMillis(advice.totalMillis ?? 0, i18n.language),
                      examined: count(advice.docsExamined),
                      returned: count(advice.returned),
                    })}
                  </p>
                </div>
                <IconAction
                  label={t("advisor.copy")}
                  onClick={() => {
                    void navigator.clipboard.writeText(createIndexCommand(advice, keys));
                    toast.success(t("advisor.copied"));
                  }}
                >
                  <ClipboardCopy />
                </IconAction>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={connection.readOnly}
                  title={connection.readOnly ? t("advisor.readOnly") : undefined}
                  onClick={() => setCreating(advice)}
                >
                  <Plus />
                  {t("advisor.create")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {creating && (
        <CreateIndexDialog
          connectionId={connection.id}
          namespace={{ database: creating.database, collection: creating.collection }}
          initialKeys={toShellSyntax(creating.keys, 0)}
          onClose={() => {
            setCreating(null);
            void report.refetch();
          }}
        />
      )}
    </MonitorSection>
  );
}
