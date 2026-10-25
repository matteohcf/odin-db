import type { CollectionKind, ConnectionInfo, ProfileId } from "@odin-db/bindings";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@odin-db/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { useTheme } from "@odin-db/ui/components/theme-provider";
import {
  Activity,
  BookMarked,
  Clock,
  Eye,
  HardDriveDownload,
  Keyboard,
  Monitor,
  Moon,
  Plug,
  Plus,
  Settings,
  SquareTerminal,
  Sun,
  Table2,
  TextSearch,
  UsersRound,
  Waypoints,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTabs } from "@/features/workspace";
import { useShortcut } from "@/hooks/use-shortcut";
import { useShortcutsDialog } from "@/hooks/use-shortcuts-dialog";
import { useConnect } from "../api/mutations";
import { useCatalogs, useConnections, useProfiles } from "../api/queries";
import { rankMatches } from "../lib/palette-search";
import { ValueSearchDialog } from "./value-search-dialog";

const MAX_COLLECTIONS = 50;
const tabIcon = {
  collection: Table2,
  shell: SquareTerminal,
  server: Activity,
  users: UsersRound,
  diagram: Waypoints,
  queries: BookMarked,
  backups: HardDriveDownload,
  settings: Settings,
} as const;
const kindIcon = { collection: Table2, view: Eye, timeseries: Clock } as const;

interface CollectionEntry {
  connection: ConnectionInfo;
  profileName: string;
  database: string;
  collection: string;
  kind: CollectionKind;
}

/** ⌘K / Ctrl+K: jump to any collection or tab, connect, open a shell, create a connection. */
export function CommandPalette({
  open,
  onOpenChange,
  onNewConnection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewConnection: () => void;
}) {
  const { t } = useTranslation("connections");
  const [search, setSearch] = useState("");
  // Controlled, so the best match is selected after every keystroke.
  const [selected, setSelected] = useState("");
  // Outlives the palette, which closes as the search opens.
  const [searchIn, setSearchIn] = useState<ConnectionInfo | null>(null);

  useShortcut("palette", () => onOpenChange(!open));

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <>
      {searchIn && <ValueSearchDialog connection={searchIn} onClose={() => setSearchIn(null)} />}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogHeader className="sr-only">
          <DialogTitle>{t("palette.title")}</DialogTitle>
          <DialogDescription>{t("palette.description")}</DialogDescription>
        </DialogHeader>
        <DialogContent
          className="top-[20%] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
          showCloseButton={false}
        >
          {/* Filtering is ours: catalogs can hold thousands of collections. */}
          <Command
            shouldFilter={false}
            value={selected}
            onValueChange={setSelected}
            className="[&_[cmdk-group-heading]]:text-muted-foreground"
          >
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder={t("palette.placeholder")}
            />
            {open && (
              <PaletteResults
                search={search}
                onNewConnection={onNewConnection}
                onFirstResult={setSelected}
                onSearchValues={setSearchIn}
                close={() => onOpenChange(false)}
              />
            )}
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PaletteResults({
  search,
  onNewConnection,
  onFirstResult,
  onSearchValues,
  close,
}: {
  search: string;
  onNewConnection: () => void;
  onSearchValues: (connection: ConnectionInfo) => void;
  /** Reports the top result's value whenever it changes. */
  onFirstResult: (value: string) => void;
  close: () => void;
}) {
  const { t } = useTranslation("connections");
  const profiles = useProfiles().data ?? [];
  const connections = useConnections().data ?? [];
  const tabs = useTabs((s) => s.tabs);
  const activate = useTabs((s) => s.activate);
  const openCollection = useTabs((s) => s.openCollection);
  const openShell = useTabs((s) => s.openShell);
  const openDiagram = useTabs((s) => s.openDiagram);
  const openBackups = useTabs((s) => s.openBackups);
  const openQueries = useTabs((s) => s.openQueries);
  const openSettings = useTabs((s) => s.openSettings);
  const connect = useConnect();
  const { setTheme } = useTheme();
  const openShortcuts = useShortcutsDialog((s) => s.setOpen);
  const nameOf = (profileId: ProfileId) =>
    profiles.find((profile) => profile.id === profileId)?.name ?? "";

  // One catalog request per connection, shared with the tree's filter.
  const catalogs = useCatalogs(connections.map((connection) => connection.id));
  const collections: CollectionEntry[] = connections.flatMap((connection, index) =>
    (catalogs[index]?.data ?? []).flatMap(({ database, collections: listed }) =>
      listed
        .filter((collection) => !collection.name.startsWith("system."))
        .map((collection) => ({
          connection,
          profileName: nameOf(connection.profileId),
          database,
          collection: collection.name,
          kind: collection.kind,
        })),
    ),
  );
  const severalConnections = connections.length > 1;

  const query = search.trim();
  const matchedCollections =
    query === ""
      ? []
      : rankMatches(
          collections,
          query,
          (entry) => `${entry.database}.${entry.collection} ${entry.profileName}`,
          MAX_COLLECTIONS,
        );

  const tabEntries = tabs.map((tab) => ({
    id: tab.id,
    label:
      tab.kind === "collection"
        ? `${tab.collection} · ${tab.database}`
        : tab.kind === "backups" || tab.kind === "settings" || tab.kind === "queries"
          ? t(`palette.${tab.kind}Tab`)
          : tab.kind === "diagram"
            ? t("palette.diagramTab", { name: `${nameOf(tab.profileId)} / ${tab.database}` })
            : t(`palette.${tab.kind}Tab`, { name: nameOf(tab.profileId) }),
    kind: tab.kind,
  }));
  const matchedTabs = rankMatches(tabEntries, query, (tab) => tab.label, 8);

  const connectedIds = new Set(connections.map((connection) => connection.profileId));
  const actions = [
    ...profiles
      .filter((profile) => !connectedIds.has(profile.id))
      .map((profile) => ({
        id: `connect:${profile.id}`,
        label: t("palette.connect", { name: profile.name }),
        icon: Plug,
        run: () => connect.mutate(profile.id),
      })),
    ...connections.map((connection) => ({
      id: `shell:${connection.id}`,
      label: t("palette.openShell", { name: nameOf(connection.profileId) }),
      icon: SquareTerminal,
      run: () => openShell(connection.profileId),
    })),
    ...connections.map((connection) => ({
      id: `search:${connection.id}`,
      label: t("palette.searchValues", { name: nameOf(connection.profileId) }),
      icon: TextSearch,
      run: () => onSearchValues(connection),
    })),
    ...connections.flatMap((connection, index) =>
      (catalogs[index]?.data ?? []).map(({ database }) => ({
        id: `diagram:${connection.id}/${database}`,
        label: severalConnections
          ? t("palette.openDiagramOn", { database, name: nameOf(connection.profileId) })
          : t("palette.openDiagram", { database }),
        icon: Waypoints,
        run: () => openDiagram(connection.profileId, database),
      })),
    ),
    { id: "new", label: t("palette.newConnection"), icon: Plus, run: onNewConnection },
    { id: "backups", label: t("palette.backups"), icon: HardDriveDownload, run: openBackups },
    { id: "queries", label: t("palette.queries"), icon: BookMarked, run: openQueries },
    { id: "settings", label: t("palette.settings"), icon: Settings, run: () => openSettings() },
    {
      id: "shortcuts",
      label: t("palette.shortcuts"),
      icon: Keyboard,
      run: () => openShortcuts(true),
    },
    { id: "light", label: t("palette.theme.light"), icon: Sun, run: () => setTheme("light") },
    { id: "dark", label: t("palette.theme.dark"), icon: Moon, run: () => setTheme("dark") },
    {
      id: "system",
      label: t("palette.theme.system"),
      icon: Monitor,
      run: () => setTheme("system"),
    },
  ];
  const matchedActions = rankMatches(actions, query, (action) => action.label, 10);

  const first = matchedCollections[0]
    ? collectionValue(matchedCollections[0])
    : matchedTabs[0]
      ? `tab:${matchedTabs[0].id}`
      : matchedActions[0]
        ? `action:${matchedActions[0].id}`
        : "";
  useEffect(() => onFirstResult(first), [first, onFirstResult]);

  const run = (action: () => void) => {
    close();
    action();
  };

  return (
    <CommandList className="max-h-[22rem]">
      <CommandEmpty>{t("palette.empty")}</CommandEmpty>
      {matchedCollections.length > 0 && (
        <CommandGroup heading={t("palette.collections")}>
          {matchedCollections.map((entry) => {
            const Icon = kindIcon[entry.kind];
            return (
              <CommandItem
                key={collectionValue(entry)}
                value={collectionValue(entry)}
                onSelect={() =>
                  run(() =>
                    openCollection({
                      profileId: entry.connection.profileId,
                      database: entry.database,
                      collection: entry.collection,
                      collectionKind: entry.kind,
                    }),
                  )
                }
              >
                <Icon className="text-muted-foreground" />
                <span className="truncate">
                  <span className="text-muted-foreground">{entry.database}.</span>
                  {entry.collection}
                </span>
                {severalConnections && <CommandShortcut>{entry.profileName}</CommandShortcut>}
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}
      {matchedTabs.length > 0 && (
        <CommandGroup heading={t("palette.tabs")}>
          {matchedTabs.map((tab) => {
            const Icon = tabIcon[tab.kind];
            return (
              <CommandItem
                key={tab.id}
                value={`tab:${tab.id}`}
                onSelect={() => run(() => activate(tab.id))}
              >
                <Icon className="text-muted-foreground" />
                <span className="truncate">{tab.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}
      {matchedActions.length > 0 && (
        <CommandGroup heading={t("palette.actions")}>
          {matchedActions.map((action) => (
            <CommandItem
              key={action.id}
              value={`action:${action.id}`}
              onSelect={() => run(action.run)}
            >
              <action.icon className="text-muted-foreground" />
              <span className="truncate">{action.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </CommandList>
  );
}

function collectionValue(entry: CollectionEntry) {
  return `${entry.connection.id}/${entry.database}/${entry.collection}`;
}
