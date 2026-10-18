import { useShortcut } from "@/hooks/use-shortcut";
import { useTabs } from "../store/tabs-store";

/** The tab keys: close, reopen, go to tab 1–8 or the last, next and previous. */
export function useTabShortcuts() {
  const tabs = useTabs((s) => s.tabs);
  const activeTabId = useTabs((s) => s.activeTabId);
  const pinned = useTabs((s) => s.pinned);
  const activate = useTabs((s) => s.activate);
  const close = useTabs((s) => s.close);
  const reopenClosed = useTabs((s) => s.reopenClosed);
  const cycle = (delta: 1 | -1) => {
    const index = tabs.findIndex((tab) => tab.id === activeTabId);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) activate(next.id);
  };
  // Like VS Code, the keyboard does not close a pinned tab; its menu still can.
  useShortcut(
    "closeTab",
    () => activeTabId && !pinned.includes(activeTabId) && close(activeTabId),
    activeTabId !== null,
  );
  useShortcut("reopenTab", reopenClosed);
  const goTo = (index: number) => () => {
    const tab = index < 0 ? tabs.at(-1) : tabs[index];
    if (tab) activate(tab.id);
  };
  useShortcut("goToTab1", goTo(0), tabs.length > 0);
  useShortcut("goToTab2", goTo(1), tabs.length > 1);
  useShortcut("goToTab3", goTo(2), tabs.length > 2);
  useShortcut("goToTab4", goTo(3), tabs.length > 3);
  useShortcut("goToTab5", goTo(4), tabs.length > 4);
  useShortcut("goToTab6", goTo(5), tabs.length > 5);
  useShortcut("goToTab7", goTo(6), tabs.length > 6);
  useShortcut("goToTab8", goTo(7), tabs.length > 7);
  useShortcut("lastTab", goTo(-1), tabs.length > 0);
  useShortcut("nextTab", () => cycle(1), tabs.length > 1);
  useShortcut("previousTab", () => cycle(-1), tabs.length > 1);
}
