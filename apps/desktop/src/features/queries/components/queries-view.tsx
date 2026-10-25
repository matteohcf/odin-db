import { BookMarked, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { pipelineToText, useSavedPipelines } from "@/features/aggregation";
import { useOpenCollection, useProfiles } from "@/features/connections";
import { useQueryHistory } from "@/features/documents";
import { useTabs } from "@/features/workspace";
import { type SavedItem, savedItems, searchText } from "../lib/saved-items";
import { SavedItemRow } from "./saved-item-row";

/** Every saved query and pipeline in one place, like Compass's My Queries. */
export function QueriesView() {
  const { t } = useTranslation("queries");
  const saved = useQueryHistory((s) => s.saved);
  const toggleSaved = useQueryHistory((s) => s.toggleSaved);
  const pipelines = useSavedPipelines((s) => s.pipelines);
  const savePipeline = useSavedPipelines((s) => s.save);
  const removePipeline = useSavedPipelines((s) => s.remove);
  const { data: profiles = [] } = useProfiles();
  const openCollection = useOpenCollection();
  const openPipeline = useTabs((s) => s.openPipeline);
  const [query, setQuery] = useState("");
  const now = Date.now();

  const profileOf = (id: string) => profiles.find((profile) => profile.id === id);
  // Items of deleted connections cannot open anywhere.
  const items = useMemo(
    () =>
      savedItems(saved, pipelines).filter((item) => profiles.some((p) => p.id === item.profileId)),
    [saved, pipelines, profiles],
  );
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? items.filter((item) =>
        searchText(item, profileOf(item.profileId)?.name ?? "").includes(needle),
      )
    : items;

  function open(item: SavedItem) {
    const target = {
      profileId: item.profileId as never,
      database: item.database,
      collection: item.collection,
      collectionKind: "collection" as const,
    };
    if (item.kind === "query") {
      openCollection({ ...target, query: { ...item.form, nonce: crypto.randomUUID() } });
    } else {
      openCollection(target);
      const stages = item.pipeline.stages.map(({ operator, body, enabled }) => ({
        operator,
        body,
        enabled,
      }));
      openPipeline(target, pipelineToText(stages.map((stage) => ({ ...stage, id: "" }))), stages);
    }
  }

  function remove(item: SavedItem) {
    if (item.kind === "query") toggleSaved(item.key, item.form);
    else removePipeline(item.key, item.name);
    toast.success(t("removed"), {
      action: {
        label: t("undo"),
        onClick: () =>
          item.kind === "query"
            ? toggleSaved(item.key, item.form)
            : savePipeline(
                item.key,
                item.name,
                item.pipeline.stages.map((stage) => ({ ...stage, id: "" })),
              ),
      },
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={BookMarked}
        title={t("title")}
        subtitle={t("count", { count: items.length })}
      >
        <div className="flex h-8 w-72 items-center gap-2 rounded-md border bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && setQuery("")}
            placeholder={t("search")}
            aria-label={t("search")}
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
      </PageHeader>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <BookMarked className="size-5 text-muted-foreground" />
          <p className="font-medium text-sm">{t("empty")}</p>
          <p className="max-w-sm text-muted-foreground text-xs">{t("emptyHint")}</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="p-6 text-center text-muted-foreground text-sm">{t("noMatch", { query })}</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
          {shown.map((item) => (
            <SavedItemRow
              key={`${item.kind}:${item.key}:${item.kind === "query" ? JSON.stringify(item.form) : item.name}`}
              item={item}
              profileName={profileOf(item.profileId)?.name ?? ""}
              color={profileOf(item.profileId)?.color ?? null}
              now={now}
              onOpen={() => open(item)}
              onRemove={() => remove(item)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
