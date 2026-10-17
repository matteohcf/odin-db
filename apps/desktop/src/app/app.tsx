import { useTranslation } from "react-i18next";
import { PerfLab } from "../features/perf-lab/components/perf-lab";

export function App() {
  const { t } = useTranslation("app");
  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-11 shrink-0 items-center border-b px-4">
        <h1 className="font-semibold text-sm">{t("title")}</h1>
      </header>
      <main className="min-h-0 flex-1">
        <PerfLab />
      </main>
    </div>
  );
}
