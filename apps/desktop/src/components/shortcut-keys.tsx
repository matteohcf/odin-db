import { Kbd, KbdGroup } from "@odin-db/ui/components/kbd";
import { label, type Shortcut } from "@/lib/shortcuts";

/** A shortcut as keycaps, one per key: ⌘ ⇧ K. Nothing for no shortcut. */
export function ShortcutKeys({ shortcut }: { shortcut: Shortcut | null }) {
  const keys = label(shortcut);
  if (!keys) return null;
  return (
    <KbdGroup>
      {keys.split(" ").map((key, index) => (
        // Keys can repeat across shortcuts but not within one; the index keeps them apart anyway.
        <Kbd key={`${index}-${key}`}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}
