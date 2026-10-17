import { useEffect } from "react";
import { useProfiles } from "@/features/connections";
import { useTabs } from "@/features/workspace";

/** Restored tabs may point at connections deleted since; close those once profiles load. */
export function usePruneRestoredTabs() {
  const { data: profiles } = useProfiles();
  useEffect(() => {
    if (!profiles) return;
    const known = new Set(profiles.map((profile) => profile.id));
    const { tabs, closeForProfile } = useTabs.getState();
    for (const tab of tabs) {
      if ("profileId" in tab && !known.has(tab.profileId)) closeForProfile(tab.profileId);
    }
  }, [profiles]);
}
