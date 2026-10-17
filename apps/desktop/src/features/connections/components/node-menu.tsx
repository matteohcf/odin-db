import { Button } from "@odin-db/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

/** The "…" menu shown on hover at the end of a tree row. */
export function NodeMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="size-6" aria-label={label}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
