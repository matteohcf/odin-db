import { Field, FieldDescription, FieldError, FieldLabel } from "@odin-db/ui/components/field";
import type { ReactNode } from "react";

interface FormFieldProps {
  /** Id of the control, so the label focuses it. */
  id: string;
  label: string;
  hint?: string | undefined;
  /** Shown instead of the hint. */
  error?: string | undefined;
  children: ReactNode;
}

/** A labelled form control with a hint or an error under it, sized for dialogs. */
export function FormField({ id, label, hint, error, children }: FormFieldProps) {
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {error ? (
        <FieldError className="text-xs">{error}</FieldError>
      ) : hint ? (
        <FieldDescription className="text-xs">{hint}</FieldDescription>
      ) : null}
    </Field>
  );
}
