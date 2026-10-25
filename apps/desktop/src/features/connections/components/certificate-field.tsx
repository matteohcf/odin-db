import { commands } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Input } from "@odin-db/ui/components/input";
import { FolderOpen } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/form-field";
import { call } from "@/lib/ipc";

interface CertificateFieldProps {
  label: string;
  hint: string;
  value: string;
  onChange: (path: string) => void;
}

/** A certificate file's path, typed or chosen in the system's file dialog. */
export function CertificateField({ label, hint, value, onChange }: CertificateFieldProps) {
  const { t } = useTranslation("connections");
  const id = useId();
  return (
    <FormField id={id} label={label} hint={hint}>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          placeholder={t("form.optional")}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            const path = await call(commands.chooseCertificateFile());
            if (path) onChange(path);
          }}
        >
          <FolderOpen />
          {t("form.choose")}
        </Button>
      </div>
    </FormField>
  );
}
