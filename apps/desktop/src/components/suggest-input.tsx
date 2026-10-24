import { Input } from "@odin-db/ui/components/input";
import { Popover, PopoverAnchor, PopoverContent } from "@odin-db/ui/components/popover";
import { cn } from "@odin-db/ui/lib/utils";
import { type ComponentProps, type KeyboardEvent, useId, useMemo, useState } from "react";

const MAX_SHOWN = 50;

type SuggestInputProps = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "list"> & {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: readonly string[];
  /** Suggestions in the code font, for field paths, names and the like. */
  mono?: boolean;
};

/**
 * A text input offering matching suggestions below it, in place of a native `<datalist>`, whose
 * look differs between webviews. Anything can still be typed.
 */
export function SuggestInput({
  value,
  onValueChange,
  suggestions,
  mono = false,
  className,
  onKeyDown,
  onFocus,
  onBlur,
  ...props
}: SuggestInputProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = useMemo(() => {
    const needle = value.trim().toLowerCase();
    return suggestions
      .filter((suggestion) => suggestion !== value && suggestion.toLowerCase().includes(needle))
      .slice(0, MAX_SHOWN);
  }, [suggestions, value]);
  const visible = open && shown.length > 0;

  function pick(suggestion: string) {
    onValueChange(suggestion);
    setOpen(false);
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!visible) {
        setOpen(true);
        setActive(0);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + shown.length) % shown.length);
    } else if (event.key === "Enter" && visible) {
      const suggestion = shown[active];
      if (suggestion !== undefined) {
        event.preventDefault();
        pick(suggestion);
      }
    } else if (event.key === "Escape" && visible) {
      // Closes the list, not the dialog around it.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <Popover open={visible}>
      <PopoverAnchor asChild>
        <Input
          {...props}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={(event) => {
            onFocus?.(event);
            setOpen(true);
          }}
          onBlur={(event) => {
            onBlur?.(event);
            setOpen(false);
          }}
          onKeyDown={keyDown}
          role="combobox"
          aria-expanded={visible}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          className={className}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="max-h-64 w-(--radix-popover-trigger-width) min-w-44 overflow-y-auto p-1"
        // The input keeps the focus while the list is open.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div id={listId} role="listbox">
          {shown.map((suggestion, index) => (
            <div
              key={suggestion}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              // Before the input's blur, so the click lands.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(suggestion);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "cursor-default truncate rounded-sm px-2 py-1.5 text-xs",
                mono && "font-mono",
                index === active && "bg-accent text-accent-foreground",
              )}
            >
              {suggestion}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
