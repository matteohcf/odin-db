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
import { useQueries } from "@tanstack/react-query";
import {
  Clock,
  Eye,
  Keyboard,
  Monitor,
  Moon,
  Plug,
  Plus,
  SquareTerminal,
  Sun,
  Table2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTabs } from "@/features/workspace";
import { useShortcutsDialog } from "@/hooks/use-shortcuts-dialog";
import { useConnect } from "../api/mutations";
import { collectionsQuery, databasesQuery, useConnections, useProfiles } from "../api/queries";
import { rankMatches } from "../lib/palette-search";

const MAX_COLLECTIONS = 50;
const MAX_DATABASES = 200;
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
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
        <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:text-muted-foreground">
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={t("palette.placeholder")}
          />
          {open && (
            <PaletteResults
              search={search}
              onNewConnection={onNewConnection}
              close={() => onOpenChange(false)}
            />
          )}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function PaletteResults({
  search,
  onNewConnection,
  close,
}: {
  search: string;
  onNewConnection: () => void;
  close: () => void;
}) {
  const { t } = useTranslation("connections");
  const profiles = useProfiles().data ?? [];
  const connections = useConnections().data ?? [];
  const tabs = useTabs((s) => s.tabs);
  const activate = useTabs((s) => s.activate);
  const openCollection = useTabs((s) => s.openCollection);
  const openShell = useTabs((s) => s.openShell);
  const connect = useConnect();
  const { setTheme } = useTheme();
  const openShortcuts = useShortcutsDialog((s) => s.setOpen);
  const nameOf = (profileId: ProfileId) =>
    profiles.find((profile) => profile.id === profileId)?.name ?? "";

  // The same queries as the tree, so the palette reuses whatever is already loaded.
  const databaseLists = useQueries({
    queries: connections.map((connection) => databasesQuery(connection.id)),
  });
  const targets = connections
    .flatMap((connection, index) =>
      (databaseLists[index]?.data ?? []).map((database) => ({
        connection,
        database: database.name,
      })),
    )
    .slice(0, MAX_DATABASES);
  const collectionLists = useQueries({
    queries: targets.map(({ connection, database }) => collectionsQuery(connection.id, database)),
  });

  const collections: CollectionEntry[] = targets.flatMap(({ connection, database }, index) =>
    (collectionLists[index]?.data ?? [])
      .filter((collection) => !collection.name.startsWith("system."))
      .map((collection) => ({
        connection,
        profileName: nameOf(connection.profileId),
        database,
        collection: collection.name,
        kind: collection.kind,
      })),
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
        : t("palette.shellTab", { name: nameOf(tab.profileId) }),
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
    { id: "new", label: t("palette.newConnection"), icon: Plus, run: onNewConnection },
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
                key={`${entry.connection.id}/${entry.database}/${entry.collection}`}
                value={`${entry.connection.id}/${entry.database}/${entry.collection}`}
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
          {matchedTabs.map((tab) => (
            <CommandItem
              key={tab.id}
              value={`tab:${tab.id}`}
              onSelect={() => run(() => activate(tab.id))}
            >
              {tab.kind === "shell" ? (
                <SquareTerminal className="text-muted-foreground" />
              ) : (
                <Table2 className="text-muted-foreground" />
              )}
              <span className="truncate">{tab.label}</span>
            </CommandItem>
          ))}
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
