import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";

interface OptionSelectProps<T extends string | number> {
  id: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  format?: (value: T) => string;
  className?: string;
}

/** A select over a fixed list of values, strings or numbers. */
export function OptionSelect<T extends string | number>({
  id,
  value,
  options,
  onChange,
  format = String,
  className = "w-40",
}: OptionSelectProps<T>) {
  return (
    <Select
      value={String(value)}
      onValueChange={(next) => {
        const option = options.find((candidate) => String(candidate) === next);
        if (option !== undefined) onChange(option);
      }}
    >
      <SelectTrigger id={id} size="sm" className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={String(option)}>
            {format(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
