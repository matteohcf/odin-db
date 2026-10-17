import { Kbd } from "@odin-db/ui/components/kbd";
import { Clock, Eye, Table2 } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { ProfileColorMark } from "@/components/profile-color-mark";
import { useProfiles } from "@/features/connections";
import { useTabs } from "@/features/workspace";

const isMac = navigator.userAgent.includes("Mac");
const kindIcon = { collection: Table2, view: Eye, timeseries: Clock } as const;

export function Welcome() {
  const { t } = useTranslation("app");
  const recent = useTabs((s) => s.recent);
  const openCollection = useTabs((s) => s.openCollection);
  const { data: profiles = [] } = useProfiles();
  // Collections of deleted connections are not offered.
  const shown = recent.flatMap((entry) => {
    const profile = profiles.find((p) => p.id === entry.profileId);
    return profile ? [{ entry, profile }] : [];
  });

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
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
      {shown.length > 0 && (
        <section
          aria-label={t("welcome.recent")}
          className="flex w-full max-w-md flex-col gap-1.5 text-left"
        >
          <h2 className="px-1 font-medium text-muted-foreground text-xs">{t("welcome.recent")}</h2>
          <ul className="flex flex-col overflow-hidden rounded-lg border">
            {shown.map(({ entry, profile }) => {
              const Icon = kindIcon[entry.collectionKind];
              return (
                <li
                  key={`${entry.profileId}/${entry.database}/${entry.collection}`}
                  className="border-b last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => openCollection(entry)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                  >
                    <ProfileColorMark color={profile.color} />
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{entry.collection}</span>
                    <span className="ml-auto truncate text-muted-foreground text-xs">
                      {profile.name} / {entry.database}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
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
