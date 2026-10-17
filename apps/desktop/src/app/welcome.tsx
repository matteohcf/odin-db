import { Kbd } from "@odin-db/ui/components/kbd";
import { Trans, useTranslation } from "react-i18next";

const isMac = navigator.userAgent.includes("Mac");

export function Welcome() {
  const { t } = useTranslation("app");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <svg viewBox="0 0 1024 1024" className="size-14 text-muted-foreground/40" aria-hidden>
        <path
          d="M512 196 L712 396 L512 596 L312 396 Z M412 496 L248 828 M612 496 L776 828"
          fill="none"
          stroke="currentColor"
          strokeWidth="64"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex max-w-sm flex-col gap-1.5">
        <h1 className="font-semibold text-base">{t("welcome.title")}</h1>
        <p className="text-muted-foreground text-xs leading-relaxed">{t("welcome.body")}</p>
      </div>
      <p className="text-muted-foreground text-xs">
        <Trans
          t={t}
          i18nKey="welcome.palette"
          values={{ shortcut: isMac ? "⌘K" : "Ctrl K" }}
          components={{ kbd: <Kbd /> }}
        />
      </p>
    </div>
  );
}
