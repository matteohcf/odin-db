/**
 * Translates a SQL SELECT into a MongoDB find or aggregation, written in
 * mongosh syntax. Covers what queries use day to day: comparisons, IN, LIKE,
 * BETWEEN, IS NULL, AND/OR/NOT, ORDER BY, LIMIT/OFFSET, and GROUP BY with
 * COUNT, SUM, AVG, MIN and MAX.
 */
export type SqlTranslation =
  | {
      kind: "find";
      collection: string;
      filter: string;
      projection: string;
      sort: string;
      skip: string;
      limit: string;
    }
  | { kind: "aggregate"; collection: string; pipeline: string };

export class SqlError extends Error {
  override name = "SqlError";
}

type Token =
  | { type: "word"; value: string; upper: string }
  | { type: "ident"; value: string }
  | { type: "number"; value: string }
  | { type: "string"; value: string }
  | { type: "op"; value: string };

const OPERATORS = ["<>", "!=", "<=", ">=", "=", "<", ">", "(", ")", ",", "*", "."];

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const char = sql[i] ?? "";
    if (/\s/.test(char)) {
      i++;
    } else if (char === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (char === "'") {
      let value = "";
      i++;
      for (;;) {
        if (i >= sql.length) throw new SqlError("unterminated string");
        if (sql[i] === "'" && sql[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          value += sql[i++];
        }
      }
      tokens.push({ type: "string", value });
    } else if (char === '"' || char === "`" || char === "[") {
      const close = char === "[" ? "]" : char;
      const end = sql.indexOf(close, i + 1);
      if (end < 0) throw new SqlError("unterminated quoted name");
      tokens.push({ type: "ident", value: sql.slice(i + 1, end) });
      i = end + 1;
    } else if (
      /\d/.test(char) ||
      (char === "-" && /\d/.test(sql[i + 1] ?? "") && isOperand(tokens.at(-1)))
    ) {
      const match = /^-?\d+(\.\d+)?(e[+-]?\d+)?/i.exec(sql.slice(i));
      const value = match?.[0] ?? char;
      tokens.push({ type: "number", value });
      i += value.length;
    } else if (/[A-Za-z_$]/.test(char)) {
      const match = /^[A-Za-z_$][\w$]*/.exec(sql.slice(i));
      const value = match?.[0] ?? char;
      tokens.push({ type: "word", value, upper: value.toUpperCase() });
      i += value.length;
    } else {
      const op = OPERATORS.find((candidate) => sql.startsWith(candidate, i));
      if (!op) {
        if (char === ";") {
          i++;
          continue;
        }
        throw new SqlError(`unexpected character ${char}`);
      }
      tokens.push({ type: "op", value: op });
      i += op.length;
    }
  }
  return tokens;
}

// A minus sign after an operator or keyword starts a negative number.
const isOperand = (previous: Token | undefined) =>
  !previous || (previous.type === "op" && previous.value !== ")") || previous.type === "word";

type Expr =
  | { kind: "and" | "or"; items: Expr[] }
  | { kind: "not"; item: Expr }
  | { kind: "compare"; field: string; op: string; value: string }
  | { kind: "in"; field: string; negated: boolean; values: string[] }
  | { kind: "like"; field: string; negated: boolean; pattern: string }
  | { kind: "between"; field: string; low: string; high: string }
  | { kind: "null"; field: string; negated: boolean };

type Column =
  | { kind: "field"; field: string; alias: string | null }
  | { kind: "aggregate"; fn: string; field: string | null; alias: string | null };

const KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "IN",
  "LIKE",
  "BETWEEN",
  "IS",
  "NULL",
  "ORDER",
  "BY",
  "ASC",
  "DESC",
  "LIMIT",
  "OFFSET",
  "GROUP",
  "AS",
  "TRUE",
  "FALSE",
]);
const AGGREGATES = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

class Parser {
  private position = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.position + offset];
  }

  private isWord(word: string, offset = 0) {
    const token = this.peek(offset);
    return token?.type === "word" && token.upper === word;
  }

  private isOp(op: string) {
    const token = this.peek();
    return token?.type === "op" && token.value === op;
  }

  private take(): Token {
    const token = this.tokens[this.position++];
    if (!token) throw new SqlError("the query ends too early");
    return token;
  }

  /** Consumes `word` when it comes next. */
  private accept(word: string): boolean {
    if (!this.isWord(word)) return false;
    this.position++;
    return true;
  }

  private expectWord(word: string) {
    if (!this.isWord(word)) throw new SqlError(`expected ${word}${this.near()}`);
    this.position++;
  }

  private expectOp(op: string) {
    if (!this.isOp(op)) throw new SqlError(`expected ${op}${this.near()}`);
    this.position++;
  }

  private near() {
    const token = this.peek();
    return token
      ? ` near ${token.type === "string" ? `'${token.value}'` : token.value}`
      : " at the end";
  }

  /** A field name, dotted paths included: address.city or "order lines".sku. */
  private field(): string {
    const parts = [this.name()];
    while (this.isOp(".")) {
      this.position++;
      parts.push(this.name());
    }
    return parts.join(".");
  }

  private name(): string {
    const token = this.take();
    if (token.type === "ident") return token.value;
    if (token.type === "word" && !KEYWORDS.has(token.upper)) return token.value;
    throw new SqlError(`expected a name near ${token.value}`);
  }

  private literal(): string {
    const token = this.take();
    if (token.type === "number") return token.value;
    if (token.type === "string") return JSON.stringify(token.value);
    if (token.type === "word" && (token.upper === "TRUE" || token.upper === "FALSE")) {
      return token.upper.toLowerCase();
    }
    if (token.type === "word" && token.upper === "NULL") return "null";
    throw new SqlError(`expected a value near ${token.value}`);
  }

  parse() {
    this.expectWord("SELECT");
    const columns = this.columns();
    this.expectWord("FROM");
    const collection = this.field();
    const where = this.accept("WHERE") ? this.or() : null;
    let groupBy: string[] = [];
    if (this.isWord("GROUP")) {
      this.position++;
      this.expectWord("BY");
      groupBy = this.list(() => this.field());
    }
    let orderBy: { field: string; direction: 1 | -1 }[] = [];
    if (this.isWord("ORDER")) {
      this.position++;
      this.expectWord("BY");
      orderBy = this.list(() => {
        const field = this.field();
        if (this.isWord("DESC")) {
          this.position++;
          return { field, direction: -1 as const };
        }
        if (this.isWord("ASC")) this.position++;
        return { field, direction: 1 as const };
      });
    }
    let limit: string | null = null;
    let offset: string | null = null;
    if (this.isWord("LIMIT")) {
      this.position++;
      limit = this.integer();
      if (this.isOp(",")) {
        // MySQL's LIMIT offset, count.
        this.position++;
        offset = limit;
        limit = this.integer();
      }
    }
    if (this.isWord("OFFSET")) {
      this.position++;
      offset = this.integer();
    }
    if (this.peek()) throw new SqlError(`unexpected ${this.peek()?.value}`);
    return { columns, collection, where, groupBy, orderBy, limit, offset };
  }

  private integer(): string {
    const token = this.take();
    if (token.type !== "number" || !/^\d+$/.test(token.value)) {
      throw new SqlError(`expected a whole number near ${token.value}`);
    }
    return token.value;
  }

  private list<T>(item: () => T): T[] {
    const items = [item()];
    while (this.isOp(",")) {
      this.position++;
      items.push(item());
    }
    return items;
  }

  private columns(): Column[] | "*" {
    if (this.isOp("*")) {
      this.position++;
      return "*";
    }
    return this.list(() => {
      const token = this.peek();
      let column: Column;
      if (token?.type === "word" && AGGREGATES.has(token.upper) && this.peek(1)?.value === "(") {
        this.position += 2;
        const fn = token.upper;
        let field: string | null = null;
        if (this.isOp("*")) this.position++;
        else field = this.field();
        this.expectOp(")");
        column = { kind: "aggregate", fn, field, alias: null };
      } else {
        column = { kind: "field", field: this.field(), alias: null };
      }
      if (this.isWord("AS")) {
        this.position++;
        column.alias = this.name();
      }
      return column;
    });
  }

  private or(): Expr {
    const items = [this.and()];
    while (this.isWord("OR")) {
      this.position++;
      items.push(this.and());
    }
    return items.length === 1 && items[0] ? items[0] : { kind: "or", items };
  }

  private and(): Expr {
    const items = [this.not()];
    while (this.isWord("AND")) {
      this.position++;
      items.push(this.not());
    }
    return items.length === 1 && items[0] ? items[0] : { kind: "and", items };
  }

  private not(): Expr {
    if (this.isWord("NOT")) {
      this.position++;
      return { kind: "not", item: this.not() };
    }
    if (this.isOp("(")) {
      this.position++;
      const inner = this.or();
      this.expectOp(")");
      return inner;
    }
    return this.predicate();
  }

  private predicate(): Expr {
    const field = this.field();
    if (this.isWord("IS")) {
      this.position++;
      const negated = this.accept("NOT");
      this.expectWord("NULL");
      return { kind: "null", field, negated };
    }
    const negated = this.accept("NOT");
    if (this.isWord("IN")) {
      this.position++;
      this.expectOp("(");
      const values = this.list(() => this.literal());
      this.expectOp(")");
      return { kind: "in", field, negated, values };
    }
    if (this.isWord("LIKE")) {
      this.position++;
      const token = this.take();
      if (token.type !== "string") throw new SqlError("LIKE needs a quoted pattern");
      return { kind: "like", field, negated, pattern: token.value };
    }
    if (this.isWord("BETWEEN") && !negated) {
      this.position++;
      const low = this.literal();
      this.expectWord("AND");
      return { kind: "between", field, low, high: this.literal() };
    }
    if (negated) throw new SqlError(`expected IN or LIKE after NOT${this.near()}`);
    const op = this.peek();
    if (op) this.position++;
    if (op?.type !== "op" || !["=", "<>", "!=", "<", "<=", ">", ">="].includes(op.value)) {
      throw new SqlError(`expected a comparison after ${field}`);
    }
    return { kind: "compare", field, op: op.value, value: this.literal() };
  }
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const keyOf = (field: string) => (IDENTIFIER.test(field) ? field : JSON.stringify(field));
const COMPARE: Record<string, string> = {
  "<>": "$ne",
  "!=": "$ne",
  "<": "$lt",
  "<=": "$lte",
  ">": "$gt",
  ">=": "$gte",
};

/** LIKE's % and _ as an anchored regex. */
function likeRegex(pattern: string): string {
  let regex = "";
  for (const char of pattern) {
    if (char === "%") regex += ".*";
    else if (char === "_") regex += ".";
    else regex += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  // Leading and trailing `.*` are what an unanchored regex does already.
  return `^${regex}$`.replace(/^\^\.\*/, "").replace(/\.\*\$$/, "");
}

function filterOf(expr: Expr): string {
  switch (expr.kind) {
    case "and":
      return `{ $and: [${expr.items.map(filterOf).join(", ")}] }`;
    case "or":
      return `{ $or: [${expr.items.map(filterOf).join(", ")}] }`;
    case "not":
      return `{ $nor: [${filterOf(expr.item)}] }`;
    case "compare":
      return expr.op === "="
        ? `{ ${keyOf(expr.field)}: ${expr.value} }`
        : `{ ${keyOf(expr.field)}: { ${COMPARE[expr.op]}: ${expr.value} } }`;
    case "in":
      return `{ ${keyOf(expr.field)}: { ${expr.negated ? "$nin" : "$in"}: [${expr.values.join(", ")}] } }`;
    case "like": {
      const regex = `{ $regex: ${JSON.stringify(likeRegex(expr.pattern))} }`;
      return `{ ${keyOf(expr.field)}: ${expr.negated ? `{ $not: ${regex} }` : regex} }`;
    }
    case "between":
      return `{ ${keyOf(expr.field)}: { $gte: ${expr.low}, $lte: ${expr.high} } }`;
    case "null":
      return `{ ${keyOf(expr.field)}: ${expr.negated ? "{ $ne: null }" : "null"} }`;
  }
}

/** Flattens a top-level AND of distinct fields into one plain document. */
function simplify(expr: Expr | null): string {
  if (!expr) return "";
  if (expr.kind === "and") {
    const parts = expr.items.map(filterOf);
    const bodies = parts.map((part) => part.slice(2, -2));
    const keys = bodies.map((body) => body.slice(0, body.indexOf(":")));
    if (!keys.some((key) => key.startsWith("$")) && new Set(keys).size === keys.length) {
      return `{ ${bodies.join(", ")} }`;
    }
  }
  return filterOf(expr);
}

export function translateSql(sql: string): SqlTranslation {
  const query = new Parser(tokenize(sql)).parse();
  const filter = simplify(query.where);
  const sort = query.orderBy.length
    ? `{ ${query.orderBy.map((o) => `${keyOf(o.field)}: ${o.direction}`).join(", ")} }`
    : "";
  const aggregates = query.columns !== "*" && query.columns.some((c) => c.kind === "aggregate");
  if (!aggregates && query.groupBy.length === 0) {
    const fields =
      query.columns === "*"
        ? []
        : query.columns.flatMap((c) => (c.kind === "field" ? [c.field] : []));
    // Every listed field, without _id unless asked for: what SELECT a, b means.
    const projection = fields.length
      ? `{ ${[...fields.map((f) => `${keyOf(f)}: 1`), ...(fields.includes("_id") ? [] : ["_id: 0"])].join(", ")} }`
      : "";
    return {
      kind: "find",
      collection: query.collection,
      filter,
      projection,
      sort,
      skip: query.offset ?? "",
      limit: query.limit ?? "",
    };
  }
  if (query.columns === "*") throw new SqlError("SELECT * cannot be grouped: list the columns");
  const groupKey =
    query.groupBy.length === 0
      ? "null"
      : query.groupBy.length === 1
        ? JSON.stringify(`$${query.groupBy[0]}`)
        : `{ ${query.groupBy.map((f) => `${keyOf(f.replaceAll(".", "_"))}: ${JSON.stringify(`$${f}`)}`).join(", ")} }`;
  const accumulators: string[] = [];
  const projection: string[] = ["_id: 0"];
  for (const column of query.columns) {
    if (column.kind === "field") {
      if (!query.groupBy.includes(column.field)) {
        throw new SqlError(`${column.field} must be in GROUP BY or inside an aggregate`);
      }
      const source =
        query.groupBy.length === 1 ? "$_id" : `$_id.${column.field.replaceAll(".", "_")}`;
      projection.push(`${keyOf(column.alias ?? column.field)}: ${JSON.stringify(source)}`);
    } else {
      const name =
        column.alias ??
        (column.field
          ? `${column.fn.toLowerCase()}_${column.field.replaceAll(".", "_")}`
          : "count");
      const value =
        column.fn === "COUNT"
          ? column.field
            ? `{ $sum: { $cond: [{ $ne: [${JSON.stringify(`$${column.field}`)}, null] }, 1, 0] } }`
            : "{ $sum: 1 }"
          : `{ $${column.fn.toLowerCase()}: ${JSON.stringify(`$${column.field}`)} }`;
      accumulators.push(`${keyOf(name)}: ${value}`);
      projection.push(`${keyOf(name)}: 1`);
    }
  }
  const stages = [
    ...(filter ? [`{ $match: ${filter} }`] : []),
    `{ $group: { _id: ${groupKey}${accumulators.length ? `, ${accumulators.join(", ")}` : ""} } }`,
    `{ $project: { ${projection.join(", ")} } }`,
    ...(sort ? [`{ $sort: ${sort} }`] : []),
    ...(query.offset ? [`{ $skip: ${query.offset} }`] : []),
    ...(query.limit ? [`{ $limit: ${query.limit} }`] : []),
  ];
  return {
    kind: "aggregate",
    collection: query.collection,
    pipeline: `[\n  ${stages.join(",\n  ")}\n]`,
  };
}
