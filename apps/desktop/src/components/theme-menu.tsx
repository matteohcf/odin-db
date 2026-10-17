import { Button } from "@odin-db/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import { type Theme, useTheme } from "@odin-db/ui/components/theme-provider";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

const icons = { system: Monitor, light: Sun, dark: Moon } as const;

export function ThemeMenu() {
  const { t } = useTranslation("common");
  const { theme, setTheme } = useTheme();
  const Icon = icons[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-muted-foreground text-xs"
        >
          <Icon className="size-3.5" />
          {t(`theme.${theme}`)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-40">
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          {t("theme.label")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          {(["system", "light", "dark"] as const).map((option) => {
            const OptionIcon = icons[option];
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <OptionIcon />
                {t(`theme.${option}`)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
