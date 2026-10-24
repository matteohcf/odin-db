import dagre from "@dagrejs/dagre";
import type { DatabaseDiagram, DiagramCollection, DiagramLink } from "@odin-db/bindings";
import { linkId } from "./annotations";

export const NODE_WIDTH = 260;
export const HEADER_HEIGHT = 40;
export const ROW_HEIGHT = 24;
/** Fields shown before "N more", so one wide collection does not dwarf the rest. */
export const MAX_ROWS = 14;

export type FieldMode = "all" | "keys";

/** The handle on a node's header, for edges whose field row is not shown. */
export const HEADER_HANDLE = "header";

export interface DiagramField {
  path: string;
  /** What the row shows: the last path segment, or the whole path in "keys only". */
  label?: string;
  /** Nesting level, from the dots in the path. */
  depth: number;
  type: string;
  /** Share of sampled documents that have it, 0 to 1. */
  frequency: number;
  /** The collection this field points at, when it is a reference. */
  references?: string;
  many?: boolean;
}

export interface DiagramNodeData extends Record<string, unknown> {
  name: string;
  kind: DiagramCollection["kind"];
  documents: number;
  fields: DiagramField[];
  /** Fields left out of `fields` by the row limit or the "keys only" mode. */
  hidden: number;
  error: string | null;
  /** How many references point at this collection. */
  incoming: number;
}

/** The fields a node lists: everything, or only `_id` and references. */
export function fieldsOf(
  collection: DiagramCollection,
  links: readonly DiagramLink[],
  mode: FieldMode,
): { fields: DiagramField[]; hidden: number } {
  const outgoing = new Map(
    links.filter((link) => link.from === collection.name).map((link) => [link.field, link]),
  );
  const all: DiagramField[] = collection.fields.map((field) => {
    const link = outgoing.get(field.path);
    return {
      path: field.path,
      depth: field.path.split(".").length - 1,
      type: field.types[0] ?? "unknown",
      frequency: field.frequency ?? 0,
      ...(link ? { references: link.to, many: link.many } : {}),
    };
  });
  // Nested fields follow their parent; top-level fields keep the sampled order, `_id` first.
  const topOrder = new Map<string, number>();
  for (const field of all) {
    const top = field.path.split(".")[0] ?? field.path;
    if (!topOrder.has(top)) topOrder.set(top, top === "_id" ? -1 : topOrder.size);
  }
  const position = (field: DiagramField) => topOrder.get(field.path.split(".")[0] ?? "") ?? 0;
  const ordered = [...all].sort(
    (a, b) => position(a) - position(b) || a.path.localeCompare(b.path),
  );
  // "Keys only" lists `_id` and references flat, by their full path.
  const wanted =
    mode === "keys"
      ? ordered
          .filter((field) => field.path === "_id" || field.references)
          .map((field) => ({ ...field, depth: 0, label: field.path }))
      : ordered;
  const fields = wanted.slice(0, MAX_ROWS);
  return { fields, hidden: all.length - fields.length };
}

function nodeHeight(data: Pick<DiagramNodeData, "fields" | "hidden" | "error">) {
  const rows = data.fields.length + (data.hidden > 0 || data.error ? 1 : 0);
  return HEADER_HEIGHT + Math.max(rows, 1) * ROW_HEIGHT + 8;
}

export interface GraphNode {
  id: string;
  position: { x: number; y: number };
  data: DiagramNodeData;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** The field row the edge leaves from. */
  sourceHandle: string;
  data: { link: DiagramLink };
}

/**
 * Nodes and edges for the diagram, laid out left to right so references flow toward the
 * collections they point at. `saved` positions (dragged by the user) win over the layout.
 * `layoutLinks` place the nodes, so references the user draws or hides do not move everything.
 */
export function buildGraph(
  diagram: DatabaseDiagram,
  mode: FieldMode,
  saved: Readonly<Record<string, { x: number; y: number }>> = {},
  layoutLinks: readonly DiagramLink[] = diagram.links,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const incoming = new Map<string, number>();
  for (const link of diagram.links) incoming.set(link.to, (incoming.get(link.to) ?? 0) + 1);

  const datas = diagram.collections.map((collection): DiagramNodeData => {
    const { fields, hidden } = fieldsOf(collection, diagram.links, mode);
    return {
      name: collection.name,
      kind: collection.kind,
      documents: collection.documents ?? 0,
      fields,
      hidden,
      error: collection.error,
      incoming: incoming.get(collection.name) ?? 0,
    };
  });

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 32, ranksep: 96, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const data of datas) {
    graph.setNode(data.name, { width: NODE_WIDTH, height: nodeHeight(data) });
  }
  for (const link of layoutLinks) {
    if (link.from !== link.to) graph.setEdge(link.from, link.to);
  }
  dagre.layout(graph);

  const nodes = datas.map((data): GraphNode => {
    const laid = graph.node(data.name);
    // dagre gives centers; React Flow wants the top-left corner.
    const position = saved[data.name] ?? {
      x: laid.x - NODE_WIDTH / 2,
      y: laid.y - nodeHeight(data) / 2,
    };
    return { id: data.name, position, data };
  });
  const shown = new Map(datas.map((data) => [data.name, data.fields]));
  const edges = diagram.links.map(
    (link): GraphEdge => ({
      id: linkId(link),
      source: link.from,
      target: link.to,
      // A field cut by the row limit leaves from the node's header instead.
      sourceHandle: shown.get(link.from)?.some((field) => field.path === link.field)
        ? link.field
        : HEADER_HANDLE,
      data: { link },
    }),
  );
  return { nodes, edges };
}
