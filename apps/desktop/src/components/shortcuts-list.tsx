import { Kbd } from "@odin-db/ui/components/kbd";
import { useTranslation } from "react-i18next";
import { label, SHORTCUTS } from "@/lib/shortcuts";

const isMac = navigator.userAgent.includes("Mac");
const mod = isMac ? "⌘" : "Ctrl";

const GROUPS = [
  {
    id: "general",
    shortcuts: [
      ["palette", [label(SHORTCUTS.palette)]],
      ["shortcuts", [label(SHORTCUTS.shortcuts)]],
      ["settings", [label(SHORTCUTS.settings)]],
      ["filterSidebar", [label(SHORTCUTS.filterSidebar)]],
      ["revealInSidebar", [label(SHORTCUTS.revealInSidebar)]],
      ["treeKeys", ["↑", "↓", "←", "→"]],
      ["closeTab", [label(SHORTCUTS.closeTab)]],
      ["nextTab", [label(SHORTCUTS.nextTab)]],
      ["previousTab", [label(SHORTCUTS.previousTab)]],
      ["reopenTab", [label(SHORTCUTS.reopenTab)]],
      ["goToTab", [`${mod} 1…8`]],
      ["lastTab", [label(SHORTCUTS.lastTab)]],
    ],
  },
  {
    id: "view",
    shortcuts: [
      ["zoomIn", [`${mod} +`]],
      ["zoomOut", [label(SHORTCUTS.zoomOut)]],
      ["resetZoom", [label(SHORTCUTS.resetZoom)]],
    ],
  },
  {
    id: "query",
    shortcuts: [
      ["focusFilter", [label(SHORTCUTS.focusFilter)]],
      ["run", ["↵", `${mod} ↵`]],
      ["rerun", [label(SHORTCUTS.rerun)]],
      ["recall", ["↑", "↓"]],
      ["suggest", ["Ctrl Space"]],
      ["accept", ["Tab", "↵"]],
      ["dismiss", ["Esc"]],
    ],
  },
  {
    id: "results",
    shortcuts: [
      ["move", ["↑", "↓"]],
      ["jump", ["Home", "End"]],
      ["open", ["↵"]],
      ["preview", ["Space"]],
      ["inlineEdit", ["t:shortcuts.keys.doubleClick", "F2"]],
      ["nextField", ["Tab", "⇧ Tab"]],
      ["copyRows", [`${mod} C`]],
      ["delete", [isMac ? "⌫" : "Delete"]],
    ],
  },
] as const;

/**
 * Every keyboard shortcut, grouped; shown in the overview dialog and in settings.
 * `filter` (lowercase) keeps the shortcuts whose description contains it.
 */
export function ShortcutsList({ filter = "" }: { filter?: string }) {
  const { t } = useTranslation("common");
  const groups = GROUPS.map((group) => ({
    id: group.id,
    shortcuts: group.shortcuts.filter(([action]) =>
      t(`shortcuts.actions.${action}`).toLowerCase().includes(filter),
    ),
  })).filter((group) => group.shortcuts.length > 0);
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.id} className="flex flex-col gap-1.5">
          <h3 className="font-medium text-muted-foreground text-xs">
            {t(`shortcuts.groups.${group.id}`)}
          </h3>
          <dl className="flex flex-col gap-1">
            {group.shortcuts.map(([action, keys]) => (
              <div
                key={action}
                // Settings search counts these as matches.
                data-setting-row={filter ? "" : undefined}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <dt>{t(`shortcuts.actions.${action}`)}</dt>
                <dd className="flex items-center gap-1">
                  {keys.map((key) => (
                    // `t:` marks a key described in words, which must be translated.
                    <Kbd key={key}>
                      {key.startsWith("t:") ? t(key.slice(2) as "shortcuts.keys.doubleClick") : key}
                    </Kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
