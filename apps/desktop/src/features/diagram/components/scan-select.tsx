import type { DiagramScanSummary, ScanId } from "@odin-db/bindings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { useTranslation } from "react-i18next";

interface ScanSelectProps {
  scans: DiagramScanSummary[];
  value: ScanId;
  onChange: (id: ScanId) => void;
}

/** Switches between the database's saved scans, newest first. */
export function ScanSelect({ scans, value, onChange }: ScanSelectProps) {
  const { t, i18n } = useTranslation("diagram");
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-auto max-w-80" aria-label={t("scan.saved")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {scans.map((scan) => (
          <SelectItem key={scan.id} value={scan.id}>
            {t("scan.option", {
              when: when.format(scan.createdAt ?? 0),
              pace: t(`scan.paces.${scan.pace}`),
              count: scan.collections ?? 0,
            })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
