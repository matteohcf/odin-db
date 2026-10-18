import type { EJsonValue, CompareSummary as Summary } from "@odin-db/bindings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@odin-db/ui/components/tabs";
import { cn } from "@odin-db/ui/lib/utils";
import { useTranslation } from "react-i18next";
import { CompareSampleList } from "./compare-sample-list";

interface CompareSummaryProps {
  summary: Summary;
  leftName: string;
  rightName: string;
  onOpenDifference: (id: EJsonValue) => void;
}

/** The counts of each kind of document, then the ids of each group. */
export function CompareSummary({
  summary,
  leftName,
  rightName,
  onOpenDifference,
}: CompareSummaryProps) {
  const { t, i18n } = useTranslation("compare");
  const number = (value: number | null) => (value ?? 0).toLocaleString(i18n.language);
  const different = summary.different ?? 0;
  const onlyLeft = summary.onlyLeft ?? 0;
  const onlyRight = summary.onlyRight ?? 0;
  const stats = [
    { key: "identical", value: summary.identical, tone: "" },
    { key: "different", value: different, tone: different ? "text-warning" : "" },
    { key: "onlyLeft", value: onlyLeft, tone: onlyLeft ? "text-destructive" : "" },
    { key: "onlyRight", value: onlyRight, tone: onlyRight ? "text-success" : "" },
  ] as const;
  const first = different ? "different" : onlyLeft ? "onlyLeft" : "onlyRight";

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-4 gap-2">
        {stats.map((stat) => (
          <div key={stat.key} className="rounded-md border bg-muted/30 px-3 py-2">
            <dt className="text-muted-foreground text-xs">
              {t(`summary.${stat.key}`, { left: leftName, right: rightName })}
            </dt>
            <dd className={cn("font-semibold text-lg tabular-nums", stat.tone)}>
              {number(stat.value)}
            </dd>
          </div>
        ))}
      </dl>
      {different + onlyLeft + onlyRight === 0 ? (
        <p role="status" className="text-sm">
          {t("summary.allIdentical")}
        </p>
      ) : (
        <Tabs defaultValue={first}>
          <TabsList>
            <TabsTrigger value="different">{t("summary.different")}</TabsTrigger>
            <TabsTrigger value="onlyLeft">
              {t("summary.onlyLeft", { left: leftName, right: rightName })}
            </TabsTrigger>
            <TabsTrigger value="onlyRight">
              {t("summary.onlyRight", { left: leftName, right: rightName })}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="different">
            <CompareSampleList
              ids={summary.differentIds}
              count={different}
              onOpen={onOpenDifference}
            />
          </TabsContent>
          <TabsContent value="onlyLeft">
            <CompareSampleList ids={summary.onlyLeftIds} count={onlyLeft} />
          </TabsContent>
          <TabsContent value="onlyRight">
            <CompareSampleList ids={summary.onlyRightIds} count={onlyRight} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
