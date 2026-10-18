import type { FieldSummary } from "@odin-db/bindings";

const DEFAULTS: Record<string, string> = {
  string: '""',
  int: "0",
  long: 'Long("0")',
  double: "Double(0)",
  decimal: 'Decimal128("0")',
  bool: "false",
  date: "new Date()",
  objectId: "ObjectId()",
  array: "[]",
  null: "null",
  timestamp: "Timestamp({ t: 0, i: 0 })",
  binData: 'BinData(0, "")',
};

interface Node {
  value?: string;
  children: Map<string, Node>;
}

const keyOf = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key));

/**
 * A new document shaped like the sampled ones, in mongosh syntax: each field with an
 * empty value of its most frequent type. `_id` is left out, so the server assigns one,
 * and so are fields most documents lack.
 */
export function schemaTemplate(fields: readonly FieldSummary[]): string {
  const root: Node = { children: new Map() };
  // Paths inside arrays (`items.sku`) describe array elements: the array stays empty.
  const arrays = new Set(fields.filter((f) => f.types[0] === "array").map((f) => f.path));
  for (const field of fields) {
    if (field.path === "_id" || (field.frequency ?? 1) < 0.5) continue;
    const parts = field.path.split(".");
    if (parts.some((_, i) => arrays.has(parts.slice(0, i).join(".")))) continue;
    let node = root;
    for (const part of parts) {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map() };
        node.children.set(part, child);
      }
      node = child;
    }
    const type = field.types[0] ?? "null";
    if (type !== "object") node.value = DEFAULTS[type] ?? "null";
  }
  return write(root, 0);
}

function write(node: Node, depth: number): string {
  if (node.children.size === 0) return node.value ?? "{}";
  const pad = "  ".repeat(depth + 1);
  const entries = [...node.children].map(
    ([key, child]) => `${pad}${keyOf(key)}: ${write(child, depth + 1)}`,
  );
  return `{\n${entries.join(",\n")}\n${"  ".repeat(depth)}}`;
}
