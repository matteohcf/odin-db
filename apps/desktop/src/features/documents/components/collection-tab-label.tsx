import { Clock, Eye, Lock, Table2 } from "lucide-react";
import { useConnectionOf, useProfile } from "@/features/connections";
import type { CollectionTab, TabLabelContext } from "@/features/workspace";

const kindIcon = { collection: Table2, view: Eye, timeseries: Clock } as const;

export function CollectionTabLabel({
  tab,
  context,
}: {
  tab: CollectionTab;
  context: TabLabelContext;
}) {
  const profile = useProfile(tab.profileId);
  const connection = useConnectionOf(tab.profileId);
  const Icon = kindIcon[tab.collectionKind];
  const owner = profile?.name ?? "";

  return (
    <span
      className="flex min-w-0 items-center gap-1.5"
      title={`${owner} / ${tab.database}.${tab.collection}`}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      {/* The collection name is the tab's identity: it shrinks last. */}
      <span className="max-w-40 shrink-0 truncate">{tab.collection}</span>
      <span className="min-w-0 truncate text-muted-foreground text-xs">
        {context.showsSeveralConnections ? owner : tab.database}
      </span>
      {(connection?.readOnly ?? profile?.readOnly) && (
        <Lock className="size-3 shrink-0 text-warning" aria-hidden />
      )}
    </span>
  );
}
