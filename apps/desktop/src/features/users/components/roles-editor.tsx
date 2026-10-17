import type { RoleRef } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Input } from "@odin-db/ui/components/input";
import { Plus, X } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

interface RolesEditorProps {
  roles: RoleRef[];
  onChange: (roles: RoleRef[]) => void;
  /** Role names to suggest. */
  suggestions: readonly string[];
  /** Database new rows start with. */
  defaultDb: string;
}

/** Roles as editable rows: a role name and the database it applies to. */
export function RolesEditor({ roles, onChange, suggestions, defaultDb }: RolesEditorProps) {
  const { t } = useTranslation("users");
  const id = useId();
  const update = (index: number, patch: Partial<RoleRef>) =>
    onChange(roles.map((role, i) => (i === index ? { ...role, ...patch } : role)));
  return (
    <div className="flex flex-col gap-2">
      <datalist id={`${id}-roles`}>
        {suggestions.map((role) => (
          <option key={role} value={role} />
        ))}
      </datalist>
      {roles.map((role, index) => (
        // Rows are positional; editing one never reorders the others.
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label={t("roles.role", { number: index + 1 })}
            list={`${id}-roles`}
            value={role.role}
            onChange={(event) => update(index, { role: event.target.value })}
            placeholder="readWrite"
            className="h-8 flex-1 font-mono text-xs"
            spellCheck={false}
          />
          <span className="text-muted-foreground text-xs">{t("roles.on")}</span>
          <Input
            aria-label={t("roles.db", { number: index + 1 })}
            value={role.db}
            onChange={(event) => update(index, { db: event.target.value })}
            placeholder={defaultDb}
            className="h-8 w-36 font-mono text-xs"
            spellCheck={false}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("roles.remove", { number: index + 1 })}
            onClick={() => onChange(roles.filter((_, i) => i !== index))}
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...roles, { role: "", db: defaultDb }])}
      >
        <Plus />
        {t("roles.add")}
      </Button>
    </div>
  );
}
