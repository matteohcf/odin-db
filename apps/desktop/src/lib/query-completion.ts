import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSection,
  type CompletionSource,
  pickedCompletion,
  snippetCompletion,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { FieldSummary } from "@odin-db/bindings";
import { queryContext } from "./query-context";

/**
 * `expression` is the body of aggregation stages other than $match, $sort and
 * $project; `document` is a whole document being written (insert, edit).
 */
export type QueryKind = "filter" | "sort" | "projection" | "expression" | "document" | "update";

interface Snippet {
  label: string;
  template: string;
  /** Help key when the label alone is ambiguous, e.g. `$min` as an update. */
  help?: string;
}

/** Query operators valid where a document of conditions starts, with its fields. */
const LOGICAL_OPERATORS: Snippet[] = [
  { label: "$and", template: "$and: [{ #{} }, { #{} }]" },
  { label: "$or", template: "$or: [{ #{} }, { #{} }]" },
  { label: "$nor", template: "$nor: [{ #{} }]" },
  { label: "$expr", template: "$expr: { #{} }" },
  { label: "$text", template: '$text: { $search: "#{}" }' },
  { label: "$jsonSchema", template: "$jsonSchema: { #{} }" },
  { label: "$comment", template: '$comment: "#{}"' },
];

/** Operators inside a field's condition document: `{ age: { $gt: 30 } }`. */
const FIELD_OPERATORS: Snippet[] = [
  { label: "$eq", template: "$eq: #{}" },
  { label: "$ne", template: "$ne: #{}" },
  { label: "$gt", template: "$gt: #{}" },
  { label: "$gte", template: "$gte: #{}" },
  { label: "$lt", template: "$lt: #{}" },
  { label: "$lte", template: "$lte: #{}" },
  { label: "$in", template: "$in: [#{}]" },
  { label: "$nin", template: "$nin: [#{}]" },
  { label: "$exists", template: "$exists: #{true}" },
  { label: "$type", template: '$type: "#{}"' },
  { label: "$regex", template: '$regex: "#{}", $options: "#{i}"' },
  { label: "$elemMatch", template: "$elemMatch: { #{} }" },
  { label: "$all", template: "$all: [#{}]" },
  { label: "$size", template: "$size: #{}" },
  { label: "$not", template: "$not: { #{} }" },
  { label: "$mod", template: "$mod: [#{divisor}, #{remainder}]" },
  { label: "$bitsAllSet", template: "$bitsAllSet: #{}" },
  { label: "$bitsAnySet", template: "$bitsAnySet: #{}" },
  { label: "$geoWithin", template: "$geoWithin: { #{} }" },
  { label: "$geoIntersects", template: "$geoIntersects: { $geometry: { #{} } }" },
  { label: "$near", template: "$near: { $geometry: { #{} } }" },
];

const PROJECTION_OPERATORS: Snippet[] = [
  { label: "$slice", template: "$slice: #{}" },
  { label: "$elemMatch", template: "$elemMatch: { #{} }" },
  { label: "$meta", template: '$meta: "#{textScore}"' },
];

/** Update operators, the top-level keys of an update document. */
const UPDATE_OPERATORS: Snippet[] = [
  { label: "$set", template: "$set: { #{} }", help: "set" },
  { label: "$unset", template: '$unset: { #{}: "" }', help: "unset" },
  { label: "$inc", template: "$inc: { #{}: 1 }", help: "inc" },
  { label: "$push", template: "$push: { #{} }", help: "updatePush" },
  { label: "$addToSet", template: "$addToSet: { #{} }", help: "updateAddToSet" },
  { label: "$pull", template: "$pull: { #{} }", help: "pull" },
  { label: "$rename", template: '$rename: { #{}: "" }', help: "rename" },
  { label: "$currentDate", template: "$currentDate: { #{}: true }", help: "currentDate" },
  { label: "$mul", template: "$mul: { #{}: 1 }", help: "mul" },
  { label: "$min", template: "$min: { #{} }", help: "updateMin" },
  { label: "$max", template: "$max: { #{} }", help: "updateMax" },
  { label: "$pop", template: "$pop: { #{}: 1 }", help: "pop" },
  { label: "$pullAll", template: "$pullAll: { #{}: [] }", help: "pullAll" },
  { label: "$setOnInsert", template: "$setOnInsert: { #{} }", help: "setOnInsert" },
];

/** Accumulators and expression operators, for aggregation stage bodies. */
const EXPRESSION_OPERATORS: Snippet[] = [
  { label: "$sum", template: "$sum: #{1}" },
  { label: "$avg", template: '$avg: "$#{}"' },
  { label: "$min", template: '$min: "$#{}"' },
  { label: "$max", template: '$max: "$#{}"' },
  { label: "$first", template: '$first: "$#{}"' },
  { label: "$last", template: '$last: "$#{}"' },
  { label: "$push", template: '$push: "$#{}"' },
  { label: "$addToSet", template: '$addToSet: "$#{}"' },
  { label: "$count", template: "$count: {}" },
  { label: "$concat", template: '$concat: ["$#{}", #{" "}]' },
  { label: "$cond", template: "$cond: { if: #{}, then: #{}, else: #{} }" },
  { label: "$ifNull", template: '$ifNull: ["$#{}", #{null}]' },
  { label: "$switch", template: "$switch: { branches: [{ case: #{}, then: #{} }], default: #{} }" },
  { label: "$eq", template: '$eq: ["$#{}", #{}]' },
  { label: "$ne", template: '$ne: ["$#{}", #{}]' },
  { label: "$gt", template: '$gt: ["$#{}", #{}]' },
  { label: "$gte", template: '$gte: ["$#{}", #{}]' },
  { label: "$lt", template: '$lt: ["$#{}", #{}]' },
  { label: "$lte", template: '$lte: ["$#{}", #{}]' },
  { label: "$and", template: "$and: [#{}]" },
  { label: "$or", template: "$or: [#{}]" },
  { label: "$not", template: "$not: [#{}]" },
  { label: "$in", template: '$in: ["$#{}", [#{}]]' },
  { label: "$add", template: '$add: ["$#{}", #{}]' },
  { label: "$subtract", template: '$subtract: ["$#{}", #{}]' },
  { label: "$multiply", template: '$multiply: ["$#{}", #{}]' },
  { label: "$divide", template: '$divide: ["$#{}", #{}]' },
  { label: "$round", template: '$round: ["$#{}", #{2}]' },
  { label: "$size", template: '$size: "$#{}"' },
  { label: "$arrayElemAt", template: '$arrayElemAt: ["$#{}", #{0}]' },
  { label: "$filter", template: '$filter: { input: "$#{}", as: "#{item}", cond: #{} }' },
  { label: "$map", template: '$map: { input: "$#{}", as: "#{item}", in: #{} }' },
  { label: "$toUpper", template: '$toUpper: "$#{}"' },
  { label: "$toLower", template: '$toLower: "$#{}"' },
  { label: "$split", template: '$split: ["$#{}", #{","}]' },
  { label: "$toString", template: '$toString: "$#{}"' },
  { label: "$toInt", template: '$toInt: "$#{}"' },
  { label: "$toDate", template: '$toDate: "$#{}"' },
  { label: "$dateToString", template: '$dateToString: { format: "#{%Y-%m-%d}", date: "$#{}" }' },
  { label: "$dateTrunc", template: '$dateTrunc: { date: "$#{}", unit: "#{day}" }' },
  { label: "$year", template: '$year: "$#{}"' },
  { label: "$month", template: '$month: "$#{}"' },
  { label: "$mergeObjects", template: '$mergeObjects: ["$#{}", #{}]' },
  { label: "$literal", template: "$literal: #{}" },
];

/** mongosh constructors understood by the shell syntax parser. */
const CONSTRUCTORS: Snippet[] = [
  { label: "ObjectId", template: 'ObjectId("#{}")' },
  { label: "ISODate", template: 'ISODate("#{}")' },
  { label: "NumberLong", template: 'NumberLong("#{}")' },
  { label: "NumberInt", template: "NumberInt(#{})" },
  { label: "NumberDecimal", template: 'NumberDecimal("#{}")' },
  { label: "Double", template: "Double(#{})" },
  { label: "UUID", template: 'UUID("#{}")' },
  { label: "BinData", template: 'BinData(#{0}, "#{}")' },
  { label: "Timestamp", template: "Timestamp({ t: #{}, i: #{1} })" },
  { label: "RegExp", template: 'RegExp("#{}", "#{i}")' },
  { label: "MinKey", template: "MinKey()" },
  { label: "MaxKey", template: "MaxKey()" },
];

/** The constructor that writes a value of each sampled BSON type. */
const CONSTRUCTOR_FOR_TYPE: Record<string, string> = {
  objectId: "ObjectId",
  date: "ISODate",
  long: "NumberLong",
  int: "NumberInt",
  decimal: "NumberDecimal",
  double: "Double",
  binData: "UUID",
  timestamp: "Timestamp",
  regex: "RegExp",
};

const BSON_TYPES = [
  "double",
  "string",
  "object",
  "array",
  "binData",
  "objectId",
  "bool",
  "date",
  "null",
  "regex",
  "int",
  "timestamp",
  "long",
  "decimal",
  "number",
];

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

interface Sections {
  fields: CompletionSection;
  operators: CompletionSection;
  values: CompletionSection;
}

export interface QueryCompletionOptions {
  kind: QueryKind;
  /** Read on every request: samples arrive after the editor is created. */
  fields: () => readonly FieldSummary[];
  /** Localized one-line description of an operator or constructor, if any. */
  describe: (label: string) => string | undefined;
  /** Localized section headings. */
  labels: { fields: string; operators: string; values: string };
}

interface Resolved extends QueryCompletionOptions {
  sections: Sections;
}

/** Context-aware completions for the filter, sort and projection editors. */
export function queryCompletionSource(input: QueryCompletionOptions): CompletionSource {
  const { labels } = input;
  const options: Resolved = {
    ...input,
    sections: {
      fields: { name: labels.fields, rank: 0 },
      operators: { name: labels.operators, rank: 1 },
      values: { name: labels.values, rank: 2 },
    },
  };
  const { kind } = input;
  return (context: CompletionContext): CompletionResult | null => {
    const doc = context.state.doc.toString();
    const at = queryContext(doc, context.pos);
    if (!at) return null;
    // `"$field"` references, wherever an aggregation expression is allowed.
    if (
      at.quoted &&
      at.prefix.startsWith("$") &&
      (kind === "expression" || kind === "projection")
    ) {
      const references = fieldReferences(options);
      return references.length > 0
        ? { from: at.from, options: references, validFor: /^\$[\w.]*$/ }
        : null;
    }
    if (at.kind === "value" && at.quoted) {
      // Inside a string: the field's known values, without the quotes already typed.
      if (kind === "sort" || kind === "projection") return null;
      const values = knownValues(options, at.key, at.path).map((value, rank) => ({
        label: value,
        type: "text",
        section: options.sections.values,
        boost: -rank,
      }));
      return values.length > 0 ? { from: at.from, options: values } : null;
    }
    // Typing opens the list only once a word starts, a key is due, or the field has known
    // values; Ctrl-Space always does.
    if (
      !context.explicit &&
      at.prefix === "" &&
      at.kind === "value" &&
      knownValues(options, at.key, at.path).length === 0
    ) {
      return null;
    }

    const options_ =
      at.kind === "key"
        ? keyCompletions(options, at.path, at.quoted, doc.slice(context.pos))
        : valueCompletions(options, at.key, at.path);
    if (options_.length === 0) return null;
    return { from: at.from, options: options_, validFor: /^[\w$.]*$/ };
  };
}

function keyCompletions(
  options: Resolved,
  path: string[],
  quoted: boolean,
  after: string,
): Completion[] {
  const { kind, sections } = options;
  const enclosing = path.at(-1);
  const hasColon = /^\s*["']?\s*:/.test(after);

  if (kind === "update") {
    // Operators at the top, then any field path, dotted ones included.
    if (enclosing === undefined)
      return quoted ? [] : snippets(UPDATE_OPERATORS, options, sections.operators);
    return path.length === 1 && enclosing.startsWith("$")
      ? fieldCompletions(options, "", quoted, hasColon)
      : [];
  }
  if (kind === "document") {
    // Keys of a nested document are the sampled sub-fields of its path.
    if (path.some((part) => part.startsWith("$") || /^\d+$/.test(part))) return [];
    const prefix = path.length > 0 ? `${path.join(".")}.` : "";
    return fieldCompletions(options, prefix, quoted, hasColon).filter(
      (completion) => !completion.label.includes("."),
    );
  }
  if (kind !== "filter") {
    if (enclosing === undefined) return fieldCompletions(options, "", quoted, hasColon);
    if (quoted) return [];
    if (kind === "projection") return snippets(PROJECTION_OPERATORS, options, sections.operators);
    if (kind === "expression") return snippets(EXPRESSION_OPERATORS, options, sections.operators);
    return [];
  }

  // Top level, or a branch of $and/$or/$nor: fields and logical operators.
  if (
    enclosing === undefined ||
    enclosing === "$and" ||
    enclosing === "$or" ||
    enclosing === "$nor"
  ) {
    return [
      ...fieldCompletions(options, "", quoted, hasColon),
      ...(quoted ? [] : snippets(LOGICAL_OPERATORS, options, sections.operators)),
    ];
  }
  if (quoted) return [];
  if (enclosing === "$elemMatch") {
    // Fields of the array's documents, relative to the array.
    const array = path.slice(0, -1).findLast((key) => !key.startsWith("$"));
    return [
      ...fieldCompletions(options, array ? `${array}.` : "", false, hasColon),
      ...snippets(FIELD_OPERATORS, options, sections.operators),
    ];
  }
  if (enclosing.startsWith("$") && enclosing !== "$not") return [];
  return snippets(FIELD_OPERATORS, options, sections.operators);
}

function fieldCompletions(
  options: Resolved,
  relativeTo: string,
  quoted: boolean,
  hasColon: boolean,
): Completion[] {
  return options
    .fields()
    .filter((field) => field.path.startsWith(relativeTo) && field.path !== relativeTo)
    .map((field, rank) => {
      const name = field.path.slice(relativeTo.length);
      const key = quoted || IDENTIFIER.test(name) ? name : JSON.stringify(name);
      const completion: Completion = {
        label: name,
        apply: hasColon ? key : applyKey(key, quoted),
        detail: field.types.join(" | "),
        type: "property",
        section: options.sections.fields,
        // Common fields first; the sample is already sorted by frequency.
        boost: -Math.min(rank, 99),
      };
      if (!hasColon && field.values.length > 0) reopening.add(completion);
      return completion;
    });
}

/**
 * Inserts `key: ` spaced like `{ key: | }`, with the cursor where the value goes.
 * Inside quotes it also steps over the closing quote.
 */
function applyKey(
  key: string,
  quoted: boolean,
): (view: EditorView, completion: Completion, from: number, to: number) => void {
  return (view, completion, from, to) => {
    const { doc } = view.state;
    let end = to;
    let text: string;
    if (quoted) {
      const quote = doc.sliceString(from - 1, from);
      if (doc.sliceString(end, end + 1) === quote) end += 1;
      text = `${key}${quote}: `;
    } else {
      const lead = /[{,]/.test(doc.sliceString(from - 1, from)) ? " " : "";
      text = `${lead}${key}: `;
    }
    const trail = doc.sliceString(end, end + 1) === "}" ? " " : "";
    view.dispatch({
      changes: { from, to: end, insert: text + trail },
      selection: { anchor: from + text.length },
      annotations: pickedCompletion.of(completion),
      userEvent: "input.complete",
    });
  };
}

function fieldReferences(options: Resolved): Completion[] {
  return options.fields().map((field, rank) => ({
    label: `$${field.path}`,
    detail: field.types.join(" | "),
    type: "property",
    section: options.sections.fields,
    boost: -Math.min(rank, 99),
  }));
}

/** Operators whose operand is compared with the field's own values. */
const VALUE_OPERATORS = new Set(["$eq", "$ne", "$in", "$nin", "$all"]);

/** Sampled string values of the field a value belongs to. */
function knownValues(options: Resolved, key: string | null, path: string[]): string[] {
  const field = valueField(options, key, path);
  return field ? (options.fields().find((f) => f.path === field)?.values ?? []) : [];
}

/** The sampled field a value is written for, if any. */
function valueField(options: Resolved, key: string | null, path: string[]): string | undefined {
  if (!key) return undefined;
  if (options.kind === "update") return path.length === 1 && !key.startsWith("$") ? key : undefined;
  if (options.kind === "document") {
    // In a document, nesting is the path itself; array positions do not count.
    return [...path.filter((part) => !/^\d+$/.test(part)), key].join(".");
  }
  if (!key.startsWith("$")) return key;
  return VALUE_OPERATORS.has(key) ? path.findLast((part) => !part.startsWith("$")) : undefined;
}

function valueCompletions(options: Resolved, key: string | null, path: string[]): Completion[] {
  const { kind, sections } = options;
  const choice = (label: string, meaning: string, boost: number): Completion => ({
    label,
    boost,
    type: "constant",
    section: sections.values,
    ...detail(options.describe(meaning)),
  });
  if (kind === "sort") return [choice("1", "ascending", 1), choice("-1", "descending", 0)];
  if (kind === "projection") return [choice("1", "include", 1), choice("0", "exclude", 0)];

  if (key === "$exists") return literals(["true", "false"], sections.values);
  if (key === "$type") {
    return BSON_TYPES.map((type) => ({
      label: JSON.stringify(type),
      type: "enum",
      section: sections.values,
    }));
  }

  const field = valueField(options, key, path);
  const types = field ? (options.fields().find((f) => f.path === field)?.types ?? []) : [];
  const preferred = new Set(types.map((type) => CONSTRUCTOR_FOR_TYPE[type]).filter(Boolean));
  const constructors = snippets(CONSTRUCTORS, options, sections.values).map((completion) =>
    preferred.has(completion.label) ? { ...completion, boost: 50 } : completion,
  );
  // Known values come first: for an enum-like field they are what the user wants.
  const values = knownValues(options, key, path).map((value, rank) => ({
    label: JSON.stringify(value),
    type: "text",
    section: sections.values,
    boost: 90 - rank,
  }));
  return [...values, ...constructors, ...literals(["true", "false", "null"], sections.values)];
}

const reopening = new WeakSet<Completion>();

/**
 * For the editors' `activateOnCompletion`: the list opens again right after a
 * snippet that leaves the cursor in a `"$…"` reference, or a key whose field
 * has known values.
 */
export const reopensCompletion = (completion: Completion) => reopening.has(completion);

function snippets(list: Snippet[], options: Resolved, section: CompletionSection) {
  // Catalogs are ordered by how common each entry is.
  return list.map(({ label, template, help }, rank) => {
    const completion = snippetCompletion(template, {
      label,
      boost: -Math.min(rank, 99),
      type: label.startsWith("$") ? "keyword" : "function",
      section,
      ...detail(options.describe(help ?? label)),
    });
    if (template.includes('"$#{}')) reopening.add(completion);
    return completion;
  });
}

const detail = (text: string | undefined) => (text ? { detail: text } : {});

function literals(values: string[], section: CompletionSection): Completion[] {
  // After the field's values and the constructors, in the order given.
  return values.map((label, rank) => ({ label, type: "constant", section, boost: -50 - rank }));
}
