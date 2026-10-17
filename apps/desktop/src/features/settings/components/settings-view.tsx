import { cn } from "@odin-db/ui/lib/utils";
import {
  Database,
  Info,
  Keyboard,
  type LucideIcon,
  Palette,
  Rows3,
  Search,
  Settings2,
  SquareTerminal,
} from "lucide-react";
import { type ComponentType, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsSearch } from "../hooks/use-settings-search";
import { AboutSection } from "./about-section";
import { AppearanceSection } from "./appearance-section";
import { DataSection } from "./data-section";
import { EditorSection } from "./editor-section";
import { GeneralSection } from "./general-section";
import { KeyboardSection } from "./keyboard-section";
import { ResultsSection } from "./results-section";

// A new settings page is one entry here plus its section component.
const PAGES = [
  { id: "general", icon: Settings2, Section: GeneralSection },
  { id: "appearance", icon: Palette, Section: AppearanceSection },
  { id: "editor", icon: SquareTerminal, Section: EditorSection },
  { id: "results", icon: Rows3, Section: ResultsSection },
  { id: "data", icon: Database, Section: DataSection },
  { id: "keyboard", icon: Keyboard, Section: KeyboardSection },
  { id: "about", icon: Info, Section: AboutSection },
] as const satisfies readonly { id: string; icon: LucideIcon; Section: ComponentType }[];

type PageId = (typeof PAGES)[number]["id"];

/** App settings, one page per area, applied as soon as they change. */
export function SettingsView() {
  const { t } = useTranslation("settings");
  const [active, setActive] = useState<PageId>("general");
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const page = PAGES.find((candidate) => candidate.id === active) ?? PAGES[0];
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label={t("title")} className="flex w-52 shrink-0 flex-col gap-0.5 border-r p-3">
        <h1 className="mb-2 px-2 font-semibold text-sm">{t("title")}</h1>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && setSearch("")}
            placeholder={t("search")}
            aria-label={t("search")}
            spellCheck={false}
            className="h-7 w-full rounded-md border bg-background pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {PAGES.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={id === active && !query ? "page" : undefined}
            onClick={() => {
              setActive(id);
              setSearch("");
            }}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              id === active && !query
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {t(`pages.${id}`)}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* Searching shows the matching rows of every page at once. */}
        <SettingsSearch.Provider value={query}>
          <div className="mx-auto flex max-w-2xl flex-col gap-8 px-8 py-8">
            {query ? PAGES.map(({ id, Section }) => <Section key={id} />) : <page.Section />}
            {query && (
              <p className="hidden text-muted-foreground text-sm [div:not(:has([data-setting-row]))>&]:block">
                {t("noMatch", { search: search.trim() })}
              </p>
            )}
          </div>
        </SettingsSearch.Provider>
      </div>
    </div>
  );
}
