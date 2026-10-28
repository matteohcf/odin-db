import { describe, expect, it } from "vitest";
import generated from "./bindings.gen.ts?raw";

// The generated contract is checked by its form: every type alias in the file is parsed and
// walked, so a serde mistake shows up whatever type it lands in. These are the mistakes the
// up-to-date check cannot see, because specta follows serde faithfully: the bindings match the
// wire, but the wire breaks the conventions the UI is written against (ADR-0005, ADR-0006).
//
// MongoDB wire names (`_id`, `$oid`) never appear as typed keys: documents cross as `JsonValue`
// (ADR-0007), whose keys are an index signature. A typed key in that style would be new.
//
// What it checks: camelCase keys and string literals, and which field tags an enum with data.
// What it cannot see: the content key of an adjacently tagged enum (`{ kind; data: T }` reads
// the same as a struct variant with a `data` field); an enum with one variant, which reads the
// same as an optional struct (`T | null`); and an untagged union of named types (`A | B`), whose
// members carry no literal to read.

type Type =
  | { form: "string"; value: string }
  | { form: "name"; name: string; args: Type[] }
  | { form: "array"; of: Type }
  | { form: "tuple"; items: Type[] }
  | ObjectType
  | { form: "union"; members: Type[] }
  | { form: "intersection"; members: Type[] };

type ObjectType = { form: "object"; fields: Field[]; index: Type | undefined };
type Field = { name: string; type: Type };
type Member = { field: Field } | { index: Type };
type Declaration = { name: string; type: Type };
type NonEmpty<T> = [T, ...T[]];

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;

// Enums with data are tagged by `kind` (`#[serde(tag = "kind")]`, with `content = "value"` for
// newtype variants, a convention the test cannot check), so the UI narrows every one the same
// way.
const TAG = "kind";
// The stream envelope (ADR-0006) carries payloads that are themselves tagged by `kind`, so it
// is told apart by `event`, with the payload under `data`.
const ENVELOPE_TAGS: Record<string, string> = { StreamEvent: "event" };

const TOKEN =
  /\s+|("(?:[^"\\]|\\.)*")|([A-Za-z_$][\w$]*|-?\d+(?:\.\d+)?)|([{}[\]()<>,;:|?=&])|([\s\S])/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end);
  if (from < 0 || to < from) throw new Error(`the bindings have no "${start}" section`);
  return source.slice(from + start.length, to);
}

function tokenize(source: string): string[] {
  return [...stripComments(source).matchAll(TOKEN)].flatMap((match) => {
    if (match[4] !== undefined) throw new Error(`unexpected ${JSON.stringify(match[4])}`);
    const token = match[1] ?? match[2] ?? match[3];
    return token === undefined ? [] : [token];
  });
}

function reader(tokens: string[]) {
  const state = { at: 0 };
  const peek = () => tokens[state.at];
  const next = (): string => {
    const token = tokens[state.at];
    if (token === undefined) throw new Error("the bindings end in the middle of a type");
    state.at += 1;
    return token;
  };
  return {
    peek,
    next,
    done: () => state.at >= tokens.length,
    take: (token: string) => {
      if (peek() !== token) return false;
      state.at += 1;
      return true;
    },
    expect: (token: string) => {
      const found = next();
      if (found !== token) throw new Error(`expected ${token}, found ${found}`);
    },
  };
}

type Reader = ReturnType<typeof reader>;

function separated<T>(tokens: Reader, separator: string, item: () => T): NonEmpty<T> {
  const first = item();
  return tokens.take(separator) ? [first, ...separated(tokens, separator, item)] : [first];
}

function list(tokens: Reader, close: string): Type[] {
  if (tokens.take(close)) return [];
  const items = separated(tokens, ",", () => parseType(tokens));
  tokens.expect(close);
  return items;
}

function parseType(tokens: Reader): Type {
  const [first, ...rest] = separated(tokens, "|", () => parseIntersection(tokens));
  return rest.length === 0 ? first : { form: "union", members: [first, ...rest] };
}

function parseIntersection(tokens: Reader): Type {
  const [first, ...rest] = separated(tokens, "&", () => parseArrays(tokens, parsePrimary(tokens)));
  return rest.length === 0 ? first : { form: "intersection", members: [first, ...rest] };
}

function parseArrays(tokens: Reader, type: Type): Type {
  if (!tokens.take("[")) return type;
  tokens.expect("]");
  return parseArrays(tokens, { form: "array", of: type });
}

function parsePrimary(tokens: Reader): Type {
  const token = tokens.next();
  if (token === "(") {
    const inner = parseType(tokens);
    tokens.expect(")");
    return inner;
  }
  if (token === "{") return parseObject(tokens, []);
  if (token === "[") return { form: "tuple", items: list(tokens, "]") };
  if (token.startsWith('"')) return { form: "string", value: JSON.parse(token) };
  if (/^[\w$-]/.test(token)) {
    return { form: "name", name: token, args: tokens.take("<") ? list(tokens, ">") : [] };
  }
  throw new Error(`unexpected ${token} in a type`);
}

function parseObject(tokens: Reader, members: Member[]): ObjectType {
  if (tokens.take("}")) {
    return {
      form: "object",
      fields: members.flatMap((member) => ("field" in member ? [member.field] : [])),
      index: members.flatMap((member) => ("index" in member ? [member.index] : []))[0],
    };
  }
  const member = parseMember(tokens);
  if (!tokens.take(",")) tokens.take(";");
  return parseObject(tokens, [...members, member]);
}

function parseMember(tokens: Reader): Member {
  if (tokens.take("[")) {
    // `[key in string]: T` or `[key: string]: T`
    tokens.next();
    tokens.next();
    parseType(tokens);
    tokens.expect("]");
    tokens.expect(":");
    return { index: parseType(tokens) };
  }
  const token = tokens.next();
  const name = token.startsWith('"') ? JSON.parse(token) : token;
  tokens.take("?");
  tokens.expect(":");
  return { field: { name, type: parseType(tokens) } };
}

function parseDeclarations(tokens: Reader, found: Declaration[]): Declaration[] {
  if (tokens.done()) return found;
  tokens.expect("export");
  tokens.expect("type");
  const name = tokens.next();
  if (tokens.take("<")) {
    separated(tokens, ",", () => tokens.next());
    tokens.expect(">");
  }
  tokens.expect("=");
  const type = parseType(tokens);
  tokens.expect(";");
  return parseDeclarations(tokens, [...found, { name, type }]);
}

/** Every type alias of the types section, which ends where the runtime helpers start. */
function declarations(source: string): Declaration[] {
  return parseDeclarations(
    reader(tokenize(section(source, "/* Types */", "/* Tauri Specta runtime */"))),
    [],
  );
}

function children(type: Type): Type[] {
  switch (type.form) {
    case "string":
      return [];
    case "name":
      return type.args;
    case "array":
      return [type.of];
    case "tuple":
      return type.items;
    case "object":
      return [...type.fields.map((field) => field.type), ...(type.index ? [type.index] : [])];
    case "union":
    case "intersection":
      return type.members;
  }
}

function descendants(type: Type): Type[] {
  return [type, ...children(type).flatMap(descendants)];
}

function isVariant(type: Type): type is ObjectType {
  return type.form === "object" && type.fields.length > 0;
}

function stringFields(variant: ObjectType): string[] {
  return variant.fields.filter((field) => field.type.form === "string").map(({ name }) => name);
}

/**
 * The string-literal fields of a union member that is an object variant, or nothing if it is
 * not one. An internally tagged newtype variant wrapping a named struct is `{ kind } & Struct`,
 * so an intersection counts by the literals of its object parts; the named part is not followed.
 */
function variantLiterals(member: Type): string[][] {
  if (isVariant(member)) return [stringFields(member)];
  if (member.form !== "intersection") return [];
  const parts = member.members.filter(isVariant);
  return parts.length === 0 ? [] : [parts.flatMap(stringFields)];
}

/** Field names that hold a string literal in every variant: the candidates for the tag. */
function commonTags([first, ...rest]: NonEmpty<string[]>): string[] {
  return first.filter((name) => rest.every((literals) => literals.includes(name)));
}

function unionViolations(union: { members: Type[] }, tag: string): string[] {
  const [first, ...rest] = union.members.flatMap(variantLiterals);
  const bare = union.members.flatMap((m) => (m.form === "string" ? [JSON.stringify(m.value)] : []));
  // No object variants is a plain string enum; one alone is an optional struct (`T | null`).
  if (first === undefined || (rest.length === 0 && bare.length === 0)) return [];
  if (bare.length > 0) {
    return [`mixes bare ${bare.join(", ")} with object variants: externally tagged, no serde tag`];
  }
  const tags = commonTags([first, ...rest]);
  if (tags.length === 0) return ["has object variants with no common tag: no serde tag"];
  return tags.includes(tag) ? [] : [`is tagged by ${tags.join(" or ")}, not ${tag}`];
}

function violations({ name, type }: Declaration): string[] {
  const tag = ENVELOPE_TAGS[name] ?? TAG;
  return descendants(type).flatMap((node) => {
    switch (node.form) {
      case "object":
        return node.fields
          .filter((field) => !CAMEL_CASE.test(field.name))
          .map((field) => `${name}: key ${field.name} is not camelCase (serde rename_all)`);
      case "string":
        return CAMEL_CASE.test(node.value)
          ? []
          : [`${name}: "${node.value}" is not camelCase (serde rename_all)`];
      case "union":
        return unionViolations(node, tag).map((problem) => `${name} ${problem}`);
      default:
        return [];
    }
  });
}

function contractViolations(source: string): string[] {
  return declarations(source).flatMap(violations);
}

const fixture = (types: string) => `/* Types */\n${types}\n/* Tauri Specta runtime */`;

describe("the generated contract", () => {
  const parsed = declarations(generated);

  it("is parsed whole", () => {
    const aliases = stripComments(generated).match(/\bexport type\b/g) ?? [];
    expect(parsed.length).toBeGreaterThan(100);
    expect(parsed).toHaveLength(aliases.length);
  });

  it("has camelCase keys and literals, and enums with data tagged by kind", () => {
    expect(contractViolations(generated)).toEqual([]);
  });

  // serde_json writes 64-bit integers as JSON numbers: a `bigint` type would be a lie the UI
  // only finds when it does arithmetic. They cross as `f64` (`specta(type = f64)`).
  it("types no integer as bigint", () => {
    expect(stripComments(generated).match(/\bbigint\b/g) ?? []).toEqual([]);
  });
});

describe("the contract check", () => {
  it("accepts the forms serde produces with this repo's attributes", () => {
    const source = fixture(`
      export type Plain = { sizeBytes: number | null; tags?: (string | null)[] };
      export type Unit = "leftOnly" | "rightOnly";
      export type Internal = { kind: "capped"; maxDocuments: number } | { kind: "standard" };
      export type Wrapped = ({ kind: "view" } & ViewOptions) | { kind: "standard" };
      export type Adjacent<S> = { kind: "progress"; value: { done: number } } | { kind: "finished"; value: S };
      export type StreamEvent<T> = { event: "data"; data: T } | { event: "completed" };
      export type Json = null | number | string | Json[] | { [key in string]: Json };
      export type Maybe = { sizeBytes: number } | null;
    `);
    expect(contractViolations(source)).toEqual([]);
  });

  it("finds snake_case keys, a missing rename_all_fields included", () => {
    const source = fixture(`
      export type Struct = { size_bytes: number };
      export type Enum = { kind: "capped"; max_documents: number } | { kind: "standard" };
    `);
    expect(contractViolations(source)).toEqual([
      "Struct: key size_bytes is not camelCase (serde rename_all)",
      "Enum: key max_documents is not camelCase (serde rename_all)",
    ]);
  });

  it("finds unit variants not renamed", () => {
    expect(contractViolations(fixture(`export type Presence = "LeftOnly" | "both";`))).toEqual([
      'Presence: "LeftOnly" is not camelCase (serde rename_all)',
    ]);
  });

  it("finds enums with data and no tag, or another tag", () => {
    const source = fixture(`
      export type External = "absent" | { partial: { received: number } };
      export type Newtypes = { data: string } | { failed: string };
      export type Other = { state: "absent" } | { state: "installed" };
    `);
    expect(contractViolations(source)).toEqual([
      'External mixes bare "absent" with object variants: externally tagged, no serde tag',
      "Newtypes has object variants with no common tag: no serde tag",
      "Other is tagged by state, not kind",
    ]);
  });

  // An internally tagged newtype variant wrapping a named struct is `{ tag } & Struct`.
  it("finds another tag on variants that wrap a struct", () => {
    const source = fixture(`
      export type Wrapped = ({ state: "a" } & A) | ({ state: "b" } & B);
    `);
    expect(contractViolations(source)).toEqual(["Wrapped is tagged by state, not kind"]);
  });
});
