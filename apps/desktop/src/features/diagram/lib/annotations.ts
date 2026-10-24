import type { DatabaseDiagram, DiagramLink } from "@odin-db/bindings";

export interface DiagramNote {
  id: string;
  text: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

/** What the user added to a database's diagram on top of what the analysis found. */
export interface DiagramAnnotations {
  /** References drawn by hand, for what sampling cannot see (string ids, rare fields). */
  links: DiagramLink[];
  /** Ids of inferred references the user hid as wrong. */
  hidden: string[];
  notes: DiagramNote[];
}

export const NO_ANNOTATIONS: DiagramAnnotations = { links: [], hidden: [], notes: [] };

export const linkId = (link: Pick<DiagramLink, "from" | "field" | "to">) =>
  `${link.from}.${link.field}->${link.to}`;

/**
 * The diagram as the user sees it: inferred references minus the hidden ones, plus the drawn
 * ones. Drawn references to collections that no longer exist are left out, not deleted.
 */
export function annotate(
  diagram: DatabaseDiagram,
  annotations: DiagramAnnotations,
): { diagram: DatabaseDiagram; manual: Set<string> } {
  const hidden = new Set(annotations.hidden);
  const inferred = diagram.links.filter((link) => !hidden.has(linkId(link)));
  const known = new Set(inferred.map(linkId));
  const names = new Set(diagram.collections.map((collection) => collection.name));
  const drawn = annotations.links.filter(
    (link) => names.has(link.from) && names.has(link.to) && !known.has(linkId(link)),
  );
  return {
    diagram: { ...diagram, links: [...inferred, ...drawn] },
    manual: new Set(drawn.map(linkId)),
  };
}

/** A reference drawn from `field` of `from` to `to`; an array field points at many. */
export function drawnLink(
  diagram: DatabaseDiagram,
  from: string,
  field: string,
  to: string,
): DiagramLink {
  const type = diagram.collections
    .find((collection) => collection.name === from)
    ?.fields.find((candidate) => candidate.path === field)?.types[0];
  return { from, field, to, many: type === "array", matched: null, checked: null };
}

export const NOTE_MIN = { width: 160, height: 72 };
export const NOTE_SIZE = { width: 220, height: 120 };
