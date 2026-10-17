import type { CollectionKind, ProfileId } from "@odin-db/bindings";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Favorite {
  profileId: ProfileId;
  database: string;
  collection: string;
  collectionKind: CollectionKind;
}

interface FavoritesState {
  /** In the order they were added. */
  favorites: Favorite[];
  toggle: (favorite: Favorite) => void;
  /** Forgets a dropped collection, or every collection of a dropped database. */
  forget: (profileId: ProfileId, database: string, collection?: string) => void;
  forgetProfile: (profileId: ProfileId) => void;
  rename: (profileId: ProfileId, database: string, from: string, to: string) => void;
}

const same = (a: Omit<Favorite, "collectionKind">, b: Omit<Favorite, "collectionKind">) =>
  a.profileId === b.profileId && a.database === b.database && a.collection === b.collection;

/** Collections pinned to the top of the sidebar, kept across restarts. */
export const useFavorites = create<FavoritesState>()(
  persist(
    (set) => ({
      favorites: [],
      toggle: (favorite) =>
        set((state) => ({
          favorites: state.favorites.some((f) => same(f, favorite))
            ? state.favorites.filter((f) => !same(f, favorite))
            : [...state.favorites, favorite],
        })),
      forget: (profileId, database, collection) =>
        set((state) => ({
          favorites: state.favorites.filter(
            (f) =>
              !(
                f.profileId === profileId &&
                f.database === database &&
                (collection === undefined || f.collection === collection)
              ),
          ),
        })),
      forgetProfile: (profileId) =>
        set((state) => ({ favorites: state.favorites.filter((f) => f.profileId !== profileId) })),
      rename: (profileId, database, from, to) =>
        set((state) => ({
          favorites: state.favorites.map((f) =>
            same(f, { profileId, database, collection: from }) ? { ...f, collection: to } : f,
          ),
        })),
    }),
    { name: "odin-favorites", version: 1 },
  ),
);

export function useIsFavorite(profileId: ProfileId, database: string, collection: string) {
  return useFavorites((s) => s.favorites.some((f) => same(f, { profileId, database, collection })));
}
