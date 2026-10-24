# Branding

The mark is a raven, Odin's bird: a geometric head with a heavy beak and hackled throat, on a
night-indigo rounded square.

| File | Use |
| --- | --- |
| `icon.svg` | App icon source (824 px art on a 1024 px canvas, macOS grid) |
| `icon-1024.png` | Rendered `icon.svg`, input of `tauri icon` |
| `mark.svg` | The raven alone, in `currentColor` |
| `logo-light.png`, `logo-dark.png` | Icon and wordmark for light and dark backgrounds (README) |

Colors: background `#3b3591` → `#16133f` (top to bottom), raven `#ffffff`, eye `#241f63`.
Wordmark: IBM Plex Sans SemiBold, the app's own font.

The UI draws the same paths from `apps/desktop/src/lib/brand.ts` (`OdinAppIcon`).

After changing `icon.svg`, render it to `icon-1024.png` (1024 × 1024, transparent) and run:

```sh
pnpm --filter @odin-db/desktop tauri icon ../../branding/icon-1024.png
```

then delete the generated `android/` and `ios/` folders: the app ships on desktop only.
