import { DropdownMenuItem } from "@odin-db/ui/components/dropdown-menu";
import { Star, StarOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProfileColorMark } from "@/components/profile-color-mark";
import { useProfiles } from "../api/queries";
import { useOpenCollection } from "../hooks/use-open-collection";
import { useExpanded } from "../store/explorer-store";
import { useFavorites } from "../store/favorites-store";
import { NodeMenu } from "./node-menu";
import { TreeRow } from "./tree-row";

/** Starred collections, one click away whatever their connection. */
export function FavoritesSection() {
  const { t } = useTranslation("connections");
  const favorites = useFavorites((s) => s.favorites);
  const toggle = useFavorites((s) => s.toggle);
  const { data: profiles = [] } = useProfiles();
  const openCollection = useOpenCollection();
  // Stored like tree nodes, but inverted: collapsed is the exception.
  const [collapsed, setCollapsed] = useExpanded("favorites:collapsed");

  if (favorites.length === 0) return null;
  return (
    <section aria-label={t("favorites.title")} className="mb-1 border-b pb-1">
      <TreeRow
        depth={0}
        expanded={!collapsed}
        onActivate={() => setCollapsed(!collapsed)}
        icon={<Star className="size-3.5 fill-current text-yellow-500" />}
        label={<span className="font-medium">{t("favorites.title")}</span>}
        trailing={favorites.length}
      />
      {!collapsed && (
        <ul className="flex flex-col gap-px">
          {favorites.map((favorite) => {
            const profile = profiles.find((p) => p.id === favorite.profileId);
            const key = `${favorite.profileId}/${favorite.database}/${favorite.collection}`;
            return (
              <li key={key}>
                <TreeRow
                  depth={1}
                  onActivate={() => openCollection(favorite)}
                  title={`${profile?.name ?? ""} / ${favorite.database}.${favorite.collection}`}
                  icon={<ProfileColorMark color={profile?.color} className="mx-0.5" />}
                  label={
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate">{favorite.collection}</span>
                      <span className="truncate text-muted-foreground text-xs">
                        {favorite.database}
                      </span>
                    </span>
                  }
                  actions={
                    <NodeMenu label={t("tree.actions", { name: favorite.collection })}>
                      <DropdownMenuItem onSelect={() => toggle(favorite)}>
                        <StarOff />
                        {t("favorites.remove")}
                      </DropdownMenuItem>
                    </NodeMenu>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
