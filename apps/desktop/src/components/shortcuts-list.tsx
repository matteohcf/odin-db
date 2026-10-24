import { Kbd, KbdGroup } from "@odin-db/ui/components/kbd";
import { useTranslation } from "react-i18next";
import { useKeybindingName } from "@/hooks/use-keybinding";
import { KEYBINDING_GROUPS, type KeybindingId, resolve } from "@/lib/keybindings";
import { useSettings } from "@/lib/settings";
import { isMac } from "@/lib/shortcuts";
import { KeybindingRow } from "./keybinding-row";
import { ShortcutKeys } from "./shortcut-keys";

/** Keys that work the same everywhere (navigation, editing in place): shown, not changeable. */
const BUILT_IN = [
  ["treeKeys", ["↑", "↓", "←", "→"]],
  ["run", ["↵"]],
  ["recall", ["↑", "↓"]],
  ["suggest", ["Ctrl Space"]],
  ["accept", ["Tab", "↵"]],
  ["dismiss", ["Esc"]],
  ["move", ["↑", "↓"]],
  ["jump", ["Home", "End"]],
  ["open", ["↵"]],
  ["preview", ["Space"]],
  ["inlineEdit", ["t:shortcuts.keys.doubleClick", "F2"]],
  ["nextField", ["Tab", "⇧ Tab"]],
  ["delete", [isMac ? "⌫" : "Delete"]],
] as const;

interface ShortcutsListProps {
  /** Lowercase text the shortcut names must contain. */
  filter?: string;
  /** Each shortcut can be recorded again and reset (settings); otherwise only shown. */
  editable?: boolean;
}

/** Every keyboard shortcut, grouped, as the user set them. */
export function ShortcutsList({ filter = "", editable = false }: ShortcutsListProps) {
  const { t } = useTranslation("common");
  const name = useKeybindingName();
  const overrides = useSettings((state) => state.keybindings);
  const shown = (text: string) => text.toLowerCase().includes(filter);

  const groups = KEYBINDING_GROUPS.map((group) => ({
    id: group.id,
    ids: group.ids.filter(
      (id: KeybindingId) => shown(name(id)) && (editable || resolve(id, overrides) !== null),
    ),
  })).filter((group) => group.ids.length > 0);
  const builtIn = BUILT_IN.filter(([action]) => shown(t(`shortcuts.actions.${action}`)));
  if (groups.length === 0 && builtIn.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.id} className="flex flex-col gap-1">
          <h3 className="font-medium text-muted-foreground text-xs">
            {t(`shortcuts.groups.${group.id}`)}
          </h3>
          {editable ? (
            <div className="flex flex-col">
              {group.ids.map((id) => (
                <KeybindingRow key={id} id={id} searched={Boolean(filter)} />
              ))}
            </div>
          ) : (
            <dl className="flex flex-col gap-1">
              {group.ids.map((id) => (
                <div key={id} className="flex items-center justify-between gap-4 text-sm">
                  <dt>{name(id)}</dt>
                  <dd>
                    <ShortcutKeys shortcut={resolve(id, overrides)} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
      {builtIn.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="font-medium text-muted-foreground text-xs">
            {t("shortcuts.groups.builtIn")}
          </h3>
          <dl className="flex flex-col gap-1">
            {builtIn.map(([action, keys]) => (
              <div
                key={action}
                data-setting-row={filter ? "" : undefined}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <dt>{t(`shortcuts.actions.${action}`)}</dt>
                <dd>
                  <KbdGroup>
                    {keys.map((key) => (
                      // `t:` marks a key described in words, which must be translated.
                      <Kbd key={key}>
                        {key.startsWith("t:")
                          ? t(key.slice(2) as "shortcuts.keys.doubleClick")
                          : key}
                      </Kbd>
                    ))}
                  </KbdGroup>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
