import { cn } from "@odin-db/ui/lib/utils";
import {
  Binary,
  Braces,
  Brackets,
  Calendar,
  CircleSlash,
  Fingerprint,
  Hash,
  type LucideIcon,
  Shapes,
  ToggleLeft,
  Type,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EJsonKind } from "@/lib/ejson-display";
import { kindTextClass } from "./ejson-cell";

const icons: Record<EJsonKind, LucideIcon> = {
  null: CircleSlash,
  boolean: ToggleLeft,
  number: Hash,
  string: Type,
  objectId: Fingerprint,
  date: Calendar,
  binary: Binary,
  document: Braces,
  array: Brackets,
  other: Shapes,
};

/** The glyph of a BSON type, in that type's color. */
export function TypeIcon({ kind, className }: { kind: EJsonKind; className?: string }) {
  const { t } = useTranslation("common");
  const Icon = icons[kind];
  return (
    <Icon
      aria-label={t(`types.${kind}`)}
      className={cn("size-3.5 shrink-0 not-italic", kindTextClass[kind], className)}
    />
  );
}
