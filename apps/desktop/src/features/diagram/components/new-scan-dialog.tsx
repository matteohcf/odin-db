import type { ScanPace } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { Label } from "@odin-db/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@odin-db/ui/components/radio-group";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes, formatCount } from "@/lib/format";
import { recommendPace } from "../lib/pace";

const PACES = ["fast", "balanced", "gentle"] as const;

interface NewScanDialogProps {
  database: string;
  collections: number;
  bytes: number;
  onStart: (pace: ScanPace) => void;
  onClose: () => void;
}

/** Picks how hard a new scan may press on the server; the size shown is already known. */
export function NewScanDialog({
  database,
  collections,
  bytes,
  onStart,
  onClose,
}: NewScanDialogProps) {
  const { t, i18n } = useTranslation("diagram");
  const id = useId();
  const recommended = recommendPace({ collections, bytes });
  const [pace, setPace] = useState<ScanPace>(recommended);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("scan.title", { database })}</DialogTitle>
          <DialogDescription>
            {t("scan.size", {
              collections: formatCount(collections, i18n.language),
              size: formatBytes(bytes, i18n.language),
            })}
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={pace}
          onValueChange={(value) => setPace(value as ScanPace)}
          aria-label={t("scan.pace")}
        >
          {PACES.map((option) => (
            <div key={option} className="flex items-start gap-2.5">
              <RadioGroupItem id={`${id}-${option}`} value={option} className="mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`${id}-${option}`} className="font-normal">
                  {t(`scan.paces.${option}`)}
                  {option === recommended && (
                    <Badge variant="secondary">{t("scan.recommended")}</Badge>
                  )}
                </Label>
                <span className="text-muted-foreground text-xs">{t(`scan.hints.${option}`)}</span>
              </div>
            </div>
          ))}
        </RadioGroup>
        <p className="text-muted-foreground text-xs">{t("scan.note")}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <Button type="button" onClick={() => onStart(pace)}>
            {t("scan.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
