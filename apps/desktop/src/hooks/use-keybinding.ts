import { useTranslation } from "react-i18next";
import { type KeybindingId, resolve } from "@/lib/keybindings";
import { useSettings } from "@/lib/settings";
import { label } from "@/lib/shortcuts";

/** The shortcut in effect for `id`, updating when the user changes it. */
function useKeybinding(id: KeybindingId) {
  return useSettings((state) => resolve(id, state.keybindings));
}

/** How the shortcut in effect reads, e.g. "⌘ K"; empty when the user removed it. */
export function useKeybindingLabel(id: KeybindingId) {
  return label(useKeybinding(id));
}

/** Names a shortcut for people: "Command palette", "Go to tab 3"… */
export function useKeybindingName() {
  const { t } = useTranslation("common");
  return (id: KeybindingId) => {
    const tab = /^goToTab(\d)$/.exec(id);
    if (tab) return t("shortcuts.actions.goToTabN", { n: tab[1] });
    return t(`shortcuts.actions.${id as Exclude<KeybindingId, `goToTab${number}`>}`);
  };
}
