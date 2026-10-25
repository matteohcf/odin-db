import type { Privilege, Resource } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Input } from "@odin-db/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActionsInput } from "./actions-input";

/** A role's privileges as editable rows: what they apply to and the actions they allow. */
export function PrivilegesEditor({
  privileges,
  onChange,
  defaultDb,
}: {
  privileges: Privilege[];
  onChange: (privileges: Privilege[]) => void;
  /** Database new rows start with. */
  defaultDb: string;
}) {
  const { t } = useTranslation("users");
  const update = (index: number, patch: Partial<Privilege>) =>
    onChange(privileges.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const setResource = (index: number, resource: Resource) => update(index, { resource });
  return (
    <div className="flex flex-col gap-2">
      {privileges.map((privilege, index) => {
        const number = index + 1;
        const { resource } = privilege;
        return (
          // Rows are positional; editing one never reorders the others.
          <div key={index} className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2">
            <div className="flex items-center gap-2">
              <Select
                value={resource.kind}
                disabled={resource.kind === "any"}
                onValueChange={(kind) =>
                  setResource(
                    index,
                    kind === "cluster"
                      ? { kind: "cluster" }
                      : { kind: "namespace", db: defaultDb, collection: "" },
                  )
                }
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 w-32 text-xs"
                  aria-label={t("privileges.resource", { number })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="namespace" className="text-xs">
                    {t("privileges.kind.namespace")}
                  </SelectItem>
                  <SelectItem value="cluster" className="text-xs">
                    {t("privileges.kind.cluster")}
                  </SelectItem>
                  {resource.kind === "any" && (
                    <SelectItem value="any" className="text-xs">
                      {t("privileges.kind.any")}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {resource.kind === "namespace" ? (
                <>
                  <Input
                    aria-label={t("privileges.db", { number })}
                    value={resource.db}
                    onChange={(event) =>
                      setResource(index, { ...resource, db: event.target.value })
                    }
                    placeholder={t("privileges.anyDb")}
                    className="h-8 flex-1 font-mono text-xs"
                    spellCheck={false}
                  />
                  <span className="text-muted-foreground text-xs">.</span>
                  <Input
                    aria-label={t("privileges.collection", { number })}
                    value={resource.collection}
                    onChange={(event) =>
                      setResource(index, { ...resource, collection: event.target.value })
                    }
                    placeholder={t("privileges.anyCollection")}
                    className="h-8 flex-1 font-mono text-xs"
                    spellCheck={false}
                  />
                </>
              ) : (
                <span className="flex-1 text-muted-foreground text-xs">
                  {t(`privileges.hint.${resource.kind}`)}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("privileges.remove", { number })}
                onClick={() => onChange(privileges.filter((_, i) => i !== index))}
              >
                <X />
              </Button>
            </div>
            <ActionsInput
              actions={privilege.actions}
              onChange={(actions) => update(index, { actions })}
              label={t("privileges.actions", { number })}
            />
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          onChange([
            ...privileges,
            { resource: { kind: "namespace", db: defaultDb, collection: "" }, actions: [] },
          ])
        }
      >
        <Plus />
        {t("privileges.add")}
      </Button>
    </div>
  );
}
