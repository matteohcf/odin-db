# Branding

The mark is a friendly brontosaurus in Compass greens, on a white rounded square.

| File | Use |
| --- | --- |
| `icon.svg` | App icon source (824 px art on a 1024 px canvas, macOS grid) |
| `icon-1024.png` | Rendered `icon.svg`, input of `tauri icon` |
| `mark.svg` | The brontosaurus alone, in `currentColor` |
| `logo-light.png`, `logo-dark.png` | Icon and wordmark for light and dark backgrounds (README) |

Colors (MongoDB Compass palette): background `#ffffff` → `#f1f5f3` (top to bottom) with a
`#dfe6e2` edge; body `#00A35C`, spots and far legs `#00684A`, eye and smile `#023430`, cheek
`#71F6BA`. The app's default accent uses the same greens: `#00684A` in light mode, `#00ED64` in
dark mode.
Wordmark: IBM Plex Sans SemiBold, the app's own font.

The UI draws the same shapes in `apps/desktop/src/components/odin-app-icon.tsx` (`OdinAppIcon`),
and `apps/desktop/public/favicon.svg` is a copy of `icon.svg`.

After changing `icon.svg`, render it to `icon-1024.png` (1024 × 1024, transparent) and run:

```sh
pnpm --filter @odin-db/desktop tauri icon ../../branding/icon-1024.png
```

then delete the generated `android/` and `ios/` folders: the app ships on desktop only.
