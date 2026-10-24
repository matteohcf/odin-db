import type { ConnectionInfo, EJsonDocument, ProfileColor } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@odin-db/ui/components/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import {
  Braces,
  ChartBarBig,
  Eye,
  ListTree,
  Lock,
  RadioTower,
  ShieldCheck,
  Unplug,
  Workflow,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CreateViewDialog,
  useConnect,
  useConnectionOf,
  useExplorer,
  useProfile,
} from "@/features/connections";
import { DocumentsView } from "@/features/documents";
import { type CollectionTab as CollectionTabModel, useTabs } from "@/features/workspace";
import { useKeybindingLabel } from "@/hooks/use-keybinding";
import { useShortcut } from "@/hooks/use-shortcut";
import { formatCompact } from "@/lib/format";
import { PROFILE_COLOR_CLASS } from "@/lib/profile-colors";
import { useCollectionStats } from "../api/use-collection-stats";
import { CollectionStats } from "./collection-stats";

// Secondary views load on first visit to keep startup light.
const AggregationView = lazy(() =>
  import("@/features/aggregation").then((module) => ({ default: module.AggregationView })),
);
const IndexesView = lazy(() =>
  import("@/features/indexes").then((module) => ({ default: module.IndexesView })),
);
const SchemaView = lazy(() =>
  import("@/features/schema").then((module) => ({ default: module.SchemaView })),
);
const ValidationView = lazy(() =>
  import("@/features/schema").then((module) => ({ default: module.ValidationView })),
);

const ChangesView = lazy(() =>
  import("@/features/changes").then((module) => ({ default: module.ChangesView })),
);

const VIEWS = ["documents", "aggregation", "schema", "indexes", "validation", "live"] as const;
type View = (typeof VIEWS)[number];
const viewIcon = {
  documents: Braces,
  aggregation: Workflow,
  schema: ChartBarBig,
  indexes: ListTree,
  validation: ShieldCheck,
  live: RadioTower,
} as const;

/** A collection tab: binds it to its profile's live connection and hosts its views. */
export function CollectionTab({ tab }: { tab: CollectionTabModel }) {
  const { t } = useTranslation("collection");
  const profile = useProfile(tab.profileId);
  const connection = useConnectionOf(tab.profileId);
  const connect = useConnect();

  if (connection && profile) {
    return (
      <CollectionWorkspace
        tab={tab}
        profileName={profile.name}
        color={profile.color}
        connection={connection}
      />
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Unplug className="size-5 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{t("disconnected.title", { name: profile?.name ?? "" })}</p>
        <p className="text-muted-foreground text-xs">
          {t("disconnected.body", { namespace: `${tab.database}.${tab.collection}` })}
        </p>
      </div>
      <Button size="sm" onClick={() => connect.mutate(tab.profileId)} disabled={connect.isPending}>
        {t("disconnected.connect")}
      </Button>
    </div>
  );
}

function CollectionWorkspace({
  tab,
  profileName,
  color,
  connection,
}: {
  tab: CollectionTabModel;
  profileName: string;
  color: ProfileColor | null;
  connection: ConnectionInfo;
}) {
  const revealInSidebarKeys = useKeybindingLabel("revealInSidebar");
  const { t, i18n } = useTranslation("collection");
  const namespace = useMemo(
    () => ({ database: tab.database, collection: tab.collection }),
    [tab.database, tab.collection],
  );
  const isView = tab.collectionKind === "view";
  // Views are read-only in MongoDB itself, whatever the connection allows.
  const editable = !connection.readOnly && !isView;
  const [view, setView] = useState<View>("documents");
  // Every collection tab stays mounted: only the visible one takes shortcuts.
  const tabActive = useTabs((s) => s.activeTabId === tab.id);
  const [indexDraft, setIndexDraft] = useState<string | null>(null);
  const [viewPipeline, setViewPipeline] = useState<EJsonDocument[] | null>(null);
  // Views mount on first visit and then stay mounted, keeping their state.
  const [visited, setVisited] = useState<ReadonlySet<View>>(() => new Set(["documents"]));

  const clearIndexDraft = useCallback(() => setIndexDraft(null), []);
  // A pipeline handed to the tab opens the aggregation view.
  const pipelineNonce = tab.pipeline?.nonce;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new pipeline switches the view.
  useEffect(() => {
    if (pipelineNonce) select("aggregation");
  }, [pipelineNonce]);
  const { data: stats } = useCollectionStats(connection.id, namespace, !isView);
  const badges: Partial<Record<View, string>> = stats
    ? {
        documents: formatCompact(stats.documents ?? 0, i18n.language),
        indexes: formatCompact(stats.indexes ?? 0, i18n.language),
      }
    : {};
  const revealInTree = useExplorer((s) => s.reveal);
  const reveal = () => revealInTree(tab.profileId, tab.database, tab.collection);
  useShortcut("revealInSidebar", reveal, tabActive);

  function select(value: string) {
    const next = VIEWS.find((candidate) => candidate === value);
    if (!next) return;
    setView(next);
    setVisited((current) => new Set(current).add(next));
  }

  return (
    <Tabs value={view} onValueChange={select} className="flex h-full min-w-0 flex-col gap-0">
      <header
        className={cn(
          // A container: when narrow, the path and inactive view labels give way first.
          "@container flex h-11 shrink-0 items-center gap-3 border-b px-3",
          // The connection's color frames every collection it shows, like Compass.
          color && ["border-t-2", PROFILE_COLOR_CLASS[color].border],
        )}
      >
        <nav
          className="flex min-w-0 items-baseline gap-1.5 text-[13px]"
          aria-label={`${tab.database}.${tab.collection}`}
        >
          <span className="hidden shrink-[3] truncate text-muted-foreground @4xl:inline">
            {profileName}
          </span>
          <span className="hidden text-muted-foreground/50 @4xl:inline">/</span>
          <span className="hidden shrink-[2] truncate text-muted-foreground @3xl:inline">
            {tab.database}
          </span>
          <span className="hidden text-muted-foreground/50 @3xl:inline">/</span>
          <h1 className="min-w-[6ch] truncate font-semibold text-base">
            <button
              type="button"
              onClick={reveal}
              title={
                revealInSidebarKeys
                  ? `${t("header.reveal")} (${revealInSidebarKeys})`
                  : t("header.reveal")
              }
              className="max-w-full truncate rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {tab.collection}
            </button>
          </h1>
        </nav>
        {(connection.readOnly || isView) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 items-center gap-1 rounded-sm bg-warning/10 px-1.5 py-0.5 font-medium text-warning text-xs">
                {connection.readOnly ? <Lock className="size-3" /> : <Eye className="size-3" />}
                {connection.readOnly ? t("header.readOnly") : t("header.view")}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {connection.readOnly ? t("header.readOnlyHint") : t("header.viewHint")}
            </TooltipContent>
          </Tooltip>
        )}
        <div className="ml-auto" />
        {!isView && (
          <div className="hidden @4xl:contents">
            <CollectionStats connectionId={connection.id} namespace={namespace} />
          </div>
        )}
        <TabsList className="h-8" aria-label={t("views.label")}>
          {/* Views have no validation rules of their own. */}
          {VIEWS.filter((value) => value !== "validation" || !isView).map((value) => {
            const Icon = viewIcon[value];
            return (
              <TabsTrigger
                key={value}
                value={value}
                aria-label={t(`views.${value}`)}
                title={t(`views.${value}`)}
                // shadcn's 60% foreground misses WCAG contrast on the muted list.
                className="group px-2.5 text-muted-foreground text-xs"
              >
                <Icon />
                {/* Narrow: only the open view keeps its name and count. */}
                <span className="hidden group-data-[state=active]:inline @5xl:inline">
                  {t(`views.${value}`)}
                </span>
                {badges[value] !== undefined && (
                  // Compass-style counts; the exact figures are in the stats tooltip.
                  <span className="hidden rounded-sm bg-muted px-1 font-normal text-[11px] text-muted-foreground tabular-nums group-data-[state=active]:inline group-data-[state=active]:bg-accent @5xl:inline">
                    {badges[value]}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </header>
      {VIEWS.filter((value) => visited.has(value)).map((value) => (
        <TabsContent
          key={value}
          value={value}
          forceMount
          className="min-h-0 flex-1 data-[state=inactive]:hidden"
        >
          {value === "documents" ? (
            <DocumentsView
              active={tabActive && view === "documents"}
              pendingQuery={tab.query}
              connection={connection}
              namespace={namespace}
              editable={editable}
              isView={isView}
              onCreateIndex={
                editable
                  ? (keys) => {
                      select("indexes");
                      setIndexDraft(keys);
                    }
                  : undefined
              }
            />
          ) : (
            <Suspense fallback={null}>
              {value === "aggregation" ? (
                <AggregationView
                  connection={connection}
                  namespace={namespace}
                  active={tabActive && view === "aggregation"}
                  pendingPipeline={tab.pipeline}
                  onCreateView={connection.readOnly ? undefined : setViewPipeline}
                />
              ) : value === "schema" ? (
                <SchemaView connection={connection} namespace={namespace} />
              ) : value === "live" ? (
                <ChangesView connection={connection} namespace={namespace} />
              ) : value === "validation" ? (
                <ValidationView connection={connection} namespace={namespace} editable={editable} />
              ) : (
                <IndexesView
                  connection={connection}
                  namespace={namespace}
                  editable={editable}
                  draftKeys={indexDraft}
                  onDraftOpened={clearIndexDraft}
                />
              )}
            </Suspense>
          )}
        </TabsContent>
      ))}
      {viewPipeline && (
        <CreateViewDialog
          connection={connection}
          source={namespace}
          pipeline={viewPipeline}
          onClose={() => setViewPipeline(null)}
        />
      )}
    </Tabs>
  );
}
