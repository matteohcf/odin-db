import type { DatabaseDiagram } from "@odin-db/bindings";

/** Mermaid identifiers allow letters, digits, `_` and `-`; anything else becomes `_`. */
const id = (name: string) => name.replace(/[^\w-]/g, "_");

/**
 * The diagram as a Mermaid `erDiagram`, ready for READMEs, wikis and pull requests.
 * Top-level fields only: Mermaid entities have no nesting.
 */
export function toMermaid(diagram: DatabaseDiagram): string {
  const lines = ["erDiagram"];
  for (const collection of diagram.collections) {
    const fields = collection.fields.filter((field) => !field.path.includes("."));
    lines.push(`  ${id(collection.name)} {`);
    for (const field of fields) {
      const key =
        field.path === "_id"
          ? " PK"
          : diagram.links.some((link) => link.from === collection.name && link.field === field.path)
            ? " FK"
            : "";
      lines.push(`    ${id(field.types[0] ?? "unknown")} ${id(field.path)}${key}`);
    }
    lines.push("  }");
  }
  for (const link of diagram.links) {
    // Many documents point at one target, or (arrays) at many.
    const cardinality = link.many ? "}o--o{" : "}o--||";
    lines.push(`  ${id(link.from)} ${cardinality} ${id(link.to)} : "${link.field}"`);
  }
  return `${lines.join("\n")}\n`;
}
