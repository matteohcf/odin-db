import type { RoleRef } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";

/** A granted or inherited role: its name and the database it applies to. */
export function RoleBadge({ role }: { role: RoleRef }) {
  return (
    <Badge variant="secondary" className="font-mono text-[11px]">
      {role.role}
      <span className="text-muted-foreground">@{role.db}</span>
    </Badge>
  );
}
