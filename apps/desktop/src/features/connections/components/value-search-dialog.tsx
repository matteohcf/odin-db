import type { ConnectionInfo, SearchHit } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { Input } from "@odin-db/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { Toggle } from "@odin-db/ui/components/toggle";
import { Loader2, Search, Square } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineError } from "@/components/inline-error";
import { useTabs } from "@/features/workspace";
import { formatCount } from "@/lib/format";
import { toShellSyntax } from "@/lib/shell-syntax";
import { useValueSearch } from "../hooks/use-value-search";
import { highlightParts, searchPattern } from "../lib/search-highlight";

const DEPTHS = [1_000, 10_000, 100_000] as const;

interface ValueSearchDialogProps {
  connection: ConnectionInfo;
  /** Limits the search to one database; every database otherwise. */
  database?: string | undefined;
  /** Limits the search to one collection of `database`. */
  collection?: string | undefined;
  onClose: () => void;
}

/** Finds text or a pattern in values (and field names) across collections, like Studio 3T's Search In. */
export function ValueSearchDialog({
  connection,
  database,
  collection,
  onClose,
}: ValueSearchDialogProps) {
  const { t, i18n } = useTranslation("connections");
  const id = useId();
  const search = useValueSearch(connection.id);
  const openCollection = useTabs((s) => s.openCollection);
  const [text, setText] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [fieldNames, setFieldNames] = useState(false);
  const [depth, setDepth] = useState<number>(DEPTHS[0]);
  // Marks matches as the search that produced the results asked, not as the form is now.
  const [pattern, setPattern] = useState<RegExp | null>(null);
  const running = search.state.status === "running";
  const count = (value: number) => formatCount(value, i18n.language);
  const scope = collection ? `${database}.${collection}` : (database ?? t("search.everyDatabase"));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (running) return;
    setPattern(searchPattern({ text, regex, caseSensitive }));
    void search.start({
      database: database ?? null,
      collection: collection ?? null,
      text,
      regex,
      caseSensitive,
      fieldNames,
      documentsPerCollection: depth,
    });
  }

  function open(hit: SearchHit) {
    openCollection(
      {
        profileId: connection.profileId,
        database: hit.namespace.database,
        collection: hit.namespace.collection,
        collectionKind: "collection",
      },
      false,
      { filter: `{ _id: ${toShellSyntax(hit.id, 0)} }`, sort: "" },
    );
    onClose();
  }

  // Hits arrive collection by collection, so grouping keeps their order.
  const groups = new Map<string, SearchHit[]>();
  for (const hit of search.hits) {
    const key = `${hit.namespace.database}.${hit.namespace.collection}`;
    groups.set(key, [...(groups.get(key) ?? []), hit]);
  }
  const summary = search.summary;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("search.title")}</DialogTitle>
          <DialogDescription>{t("search.description", { scope })}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              id={`${id}-text`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.text")}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            {running ? (
              <Button type="button" variant="outline" onClick={search.cancel}>
                <Square className="fill-current" />
                {t("search.stop")}
              </Button>
            ) : (
              <Button type="submit" disabled={text.trim() === ""}>
                <Search />
                {t("search.submit")}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Toggle size="sm" variant="outline" pressed={regex} onPressedChange={setRegex}>
              {t("search.regex")}
            </Toggle>
            <Toggle
              size="sm"
              variant="outline"
              pressed={caseSensitive}
              onPressedChange={setCaseSensitive}
            >
              {t("search.caseSensitive")}
            </Toggle>
            <Toggle
              size="sm"
              variant="outline"
              pressed={fieldNames}
              onPressedChange={setFieldNames}
            >
              {t("search.fieldNames")}
            </Toggle>
            <span className="ml-auto text-muted-foreground text-xs">{t("search.depth")}</span>
            <Select value={String(depth)} onValueChange={(value) => setDepth(Number(value))}>
              <SelectTrigger size="sm" className="w-44" aria-label={t("search.depth")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEPTHS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {t("search.documents", { count: value, value: count(value) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </form>

        <div
          role="status"
          className="flex min-h-5 items-center gap-1.5 text-muted-foreground text-xs"
        >
          {running && search.scanning && (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t("search.scanning", {
                namespace: `${search.scanning.namespace.database}.${search.scanning.namespace.collection}`,
                done: (search.scanning.done ?? 0) + 1,
                total: search.scanning.total ?? 0,
              })}
            </>
          )}
          {summary && (
            <span>
              {t("search.summary", {
                count: summary.hits ?? 0,
                hits: count(summary.hits ?? 0),
                collections: count(summary.collections ?? 0),
                documents: count(summary.documents ?? 0),
              })}
              {(summary.partialCollections ?? 0) > 0 &&
                ` · ${t("search.partial", { count: summary.partialCollections ?? 0 })}`}
              {summary.truncated && ` · ${t("search.truncated")}`}
            </span>
          )}
        </div>
        {search.state.status === "failed" && <InlineError>{search.state.error}</InlineError>}

        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto border-t px-6">
          {summary && search.hits.length === 0 && (
            <p className="py-8 text-center text-muted-foreground text-sm">{t("search.none")}</p>
          )}
          {[...groups].map(([namespace, hits]) => (
            <section key={namespace} aria-label={namespace} className="py-2">
              <h3 className="sticky top-0 bg-background py-1 font-medium font-mono text-xs">
                {namespace}
                <span className="ml-2 font-normal font-sans text-muted-foreground">
                  {count(hits.length)}
                </span>
              </h3>
              <ul className="flex flex-col">
                {hits.map((hit, index) => (
                  // A document can match twice at different paths; order is stable.
                  // biome-ignore lint/suspicious/noArrayIndexKey: hits have no identity besides order.
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => open(hit)}
                      title={t("search.open")}
                      className="flex w-full items-baseline gap-3 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <span className="w-48 shrink-0 truncate font-mono text-muted-foreground">
                        {hit.path}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono">
                        {hit.fieldName ? (
                          <span className="text-muted-foreground">{t("search.fieldName")}</span>
                        ) : (
                          <>
                            "
                            {highlightParts(hit.preview, pattern).map((part, at) =>
                              part.match ? (
                                // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional.
                                <mark key={at} className="rounded-sm bg-warning/25 text-foreground">
                                  {part.text}
                                </mark>
                              ) : (
                                part.text
                              ),
                            )}
                            "
                          </>
                        )}
                      </span>
                      <span className="max-w-40 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                        {toShellSyntax(hit.id, 0)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
