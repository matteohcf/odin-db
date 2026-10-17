import type { EJsonDocument, JsonValue } from "@odin-db/bindings";
import { isJsonObject, type JsonObject } from "./ejson-display";
import { toShellSyntax } from "./shell-syntax";

/**
 * Driver code for a query, like Studio 3T's Query Code. mongosh, Node.js and
 * Python get native literals; Java, C# and Go parse canonical Extended JSON,
 * the idiom their drivers document, so every BSON type survives exactly.
 */
export const CODE_LANGUAGES = ["mongosh", "javascript", "python", "java", "csharp", "go"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export type CodeSource =
  | {
      kind: "find";
      database: string;
      collection: string;
      filter: EJsonDocument;
      projection: EJsonDocument | null;
      sort: EJsonDocument | null;
      skip: number | null;
      limit: number | null;
    }
  | { kind: "aggregate"; database: string; collection: string; pipeline: EJsonDocument[] };

export function queryCode(source: CodeSource, language: CodeLanguage): string {
  switch (language) {
    case "mongosh":
      return mongosh(source);
    case "javascript":
      return javascript(source);
    case "python":
      return python(source);
    case "java":
      return java(source);
    case "csharp":
      return csharp(source);
    case "go":
      return go(source);
  }
}

const isEmpty = (document: EJsonDocument | null): document is null =>
  document === null || Object.keys(document).length === 0;

// mongosh

function mongosh(source: CodeSource): string {
  const collection = `db.getSiblingDB(${str(source.database)}).getCollection(${str(source.collection)})`;
  if (source.kind === "aggregate") {
    return `${collection}.aggregate(${toShellSyntax(source.pipeline as JsonValue)})`;
  }
  const args = [toShellSyntax(source.filter)];
  if (!isEmpty(source.projection)) args.push(toShellSyntax(source.projection));
  let code = `${collection}.find(${args.join(", ")})`;
  if (!isEmpty(source.sort)) code += `\n  .sort(${toShellSyntax(source.sort, 0)})`;
  if (source.skip !== null) code += `\n  .skip(${source.skip})`;
  if (source.limit !== null) code += `\n  .limit(${source.limit})`;
  return code;
}

// Node.js

function javascript(source: CodeSource): string {
  const used = new Set<string>(["MongoClient"]);
  const value = (v: JsonValue, depth: number) => literal(v, depth, jsDialect(used));
  let query: string;
  if (source.kind === "aggregate") {
    query = `const cursor = collection.aggregate(${value(source.pipeline as JsonValue, 0)});`;
  } else {
    const options: string[] = [];
    if (!isEmpty(source.projection)) options.push(`projection: ${value(source.projection, 1)}`);
    if (!isEmpty(source.sort)) options.push(`sort: ${value(source.sort, 1)}`);
    if (source.skip !== null) options.push(`skip: ${source.skip}`);
    if (source.limit !== null) options.push(`limit: ${source.limit}`);
    const args = [value(source.filter, 0)];
    if (options.length > 0) args.push(`{\n  ${options.join(",\n  ")}\n}`);
    query = `const cursor = collection.find(${args.join(", ")});`;
  }
  return [
    `import { ${[...used].sort().join(", ")} } from "mongodb";`,
    "",
    "const client = new MongoClient(process.env.MONGODB_URI);",
    `const collection = client.db(${str(source.database)}).collection(${str(source.collection)});`,
    "",
    query,
    "for await (const document of cursor) {",
    "  console.log(document);",
    "}",
    "await client.close();",
  ].join("\n");
}

function jsDialect(used: Set<string>): Dialect {
  const use = (name: string, code: string) => {
    used.add(name);
    return code;
  };
  return {
    indent: "  ",
    key: (key) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : str(key)),
    null: "null",
    bool: String,
    string: str,
    wrapper: (type, inner) => {
      switch (type) {
        case "$oid":
          return use("ObjectId", `new ObjectId(${str(String(inner))})`);
        case "$numberInt":
          return String(inner);
        case "$numberDouble": {
          const raw = String(inner);
          if (raw === "NaN" || raw === "Infinity" || raw === "-Infinity") return raw;
          return Number.isInteger(Number(raw)) ? use("Double", `new Double(${raw})`) : raw;
        }
        case "$numberLong":
          return use("Long", `Long.fromString(${str(String(inner))})`);
        case "$numberDecimal":
          return use("Decimal128", `Decimal128.fromString(${str(String(inner))})`);
        case "$date":
          return `new Date(${str(isoDate(inner))})`;
        case "$binary":
          return isJsonObject(inner)
            ? use(
                "Binary",
                `new Binary(Buffer.from(${str(String(inner.base64))}, "base64"), ${subType(inner)})`,
              )
            : undefined;
        case "$timestamp":
          return isJsonObject(inner)
            ? use("Timestamp", `new Timestamp({ t: ${inner.t}, i: ${inner.i} })`)
            : undefined;
        case "$regularExpression":
          return isJsonObject(inner)
            ? use(
                "BSONRegExp",
                `new BSONRegExp(${str(String(inner.pattern))}, ${str(String(inner.options))})`,
              )
            : undefined;
        case "$minKey":
          return use("MinKey", "new MinKey()");
        case "$maxKey":
          return use("MaxKey", "new MaxKey()");
        case "$code":
          return use("Code", `new Code(${str(String(inner))})`);
        default:
          return undefined;
      }
    },
  };
}

// Python

function python(source: CodeSource): string {
  const imports = new Map<string, Set<string>>();
  const value = (v: JsonValue, depth: number) => literal(v, depth, pyDialect(imports));
  const args: string[] = [];
  let call: string;
  if (source.kind === "aggregate") {
    call = `cursor = collection.aggregate(${value(source.pipeline as JsonValue, 0)})`;
  } else {
    args.push(`filter=${value(source.filter, 1)}`);
    if (!isEmpty(source.projection)) args.push(`projection=${value(source.projection, 1)}`);
    if (!isEmpty(source.sort)) {
      // PyMongo takes the sort as (field, direction) pairs to keep their order.
      const pairs = Object.entries(source.sort).map(
        ([field, direction]) => `(${str(field)}, ${value(direction, 2)})`,
      );
      args.push(`sort=[${pairs.join(", ")}]`);
    }
    if (source.skip !== null) args.push(`skip=${source.skip}`);
    if (source.limit !== null) args.push(`limit=${source.limit}`);
    call = `cursor = collection.find(\n    ${args.join(",\n    ")},\n)`;
  }
  // PEP 8 groups: the standard library, then third-party packages.
  const line = (module: string, names: Set<string>) =>
    names.size === 0 ? `import ${module}` : `from ${module} import ${[...names].sort().join(", ")}`;
  const standard = [["os", new Set<string>()] as const, ...imports]
    .filter(([module]) => module !== "bson")
    .map(([module, names]) => line(module, names))
    .sort(
      (a, b) => Number(a.startsWith("from")) - Number(b.startsWith("from")) || a.localeCompare(b),
    );
  const bson = imports.get("bson");
  return [
    ...standard,
    "",
    ...(bson ? [line("bson", bson)] : []),
    "from pymongo import MongoClient",
    "",
    'client = MongoClient(os.environ["MONGODB_URI"])',
    `collection = client[${str(source.database)}][${str(source.collection)}]`,
    "",
    call,
    "for document in cursor:",
    "    print(document)",
  ].join("\n");
}

function pyDialect(imports: Map<string, Set<string>>): Dialect {
  const use = (module: string, name: string | null, code: string) => {
    const names = imports.get(module) ?? new Set<string>();
    if (name) names.add(name);
    imports.set(module, names);
    return code;
  };
  const bson = (name: string, code: string) => use("bson", name, code);
  return {
    indent: "    ",
    key: str,
    null: "None",
    bool: (value) => (value ? "True" : "False"),
    string: str,
    wrapper: (type, inner) => {
      switch (type) {
        case "$oid":
          return bson("ObjectId", `ObjectId(${str(String(inner))})`);
        case "$numberInt":
          return String(inner);
        case "$numberDouble": {
          const raw = String(inner);
          if (raw === "NaN") return 'float("nan")';
          if (raw === "Infinity") return 'float("inf")';
          if (raw === "-Infinity") return 'float("-inf")';
          // A Python float always encodes as a BSON double.
          return Number.isInteger(Number(raw)) && !raw.includes("e") ? `${raw}.0` : raw;
        }
        case "$numberLong":
          return bson("Int64", `Int64(${String(inner)})`);
        case "$numberDecimal":
          return bson("Decimal128", `Decimal128(${str(String(inner))})`);
        case "$date":
          return use(
            "datetime",
            "datetime",
            `datetime.fromisoformat(${str(isoDate(inner).replace("Z", "+00:00"))})`,
          );
        case "$binary":
          if (!isJsonObject(inner)) return undefined;
          use("base64", null, "");
          return bson(
            "Binary",
            `Binary(base64.b64decode(${str(String(inner.base64))}), ${subType(inner)})`,
          );
        case "$timestamp":
          return isJsonObject(inner)
            ? bson("Timestamp", `Timestamp(${inner.t}, ${inner.i})`)
            : undefined;
        case "$regularExpression":
          return isJsonObject(inner)
            ? bson("Regex", `Regex(${str(String(inner.pattern))}, ${str(String(inner.options))})`)
            : undefined;
        case "$minKey":
          return bson("MinKey", "MinKey()");
        case "$maxKey":
          return bson("MaxKey", "MaxKey()");
        case "$code":
          return bson("Code", `Code(${str(String(inner))})`);
        default:
          return undefined;
      }
    },
  };
}

// Java, C#, Go: canonical Extended JSON parsed by the driver.

const json = (value: JsonValue, indent = 2) => JSON.stringify(value, null, indent);

function java(source: CodeSource): string {
  const parse = (value: JsonValue, pad: string) =>
    `Document.parse("""\n${indentLines(json(value), `${pad}    `)}\n${pad}    """)`;
  const pad = "            ";
  let query: string[];
  if (source.kind === "aggregate") {
    query = [
      `${pad}List<Document> pipeline = List.of(`,
      source.pipeline.map((stage) => `${pad}    ${parse(stage, `${pad}    `)}`).join(",\n"),
      `${pad});`,
      `${pad}for (Document document : collection.aggregate(pipeline)) {`,
    ];
  } else {
    const chain = [`collection.find(${parse(source.filter, pad)})`];
    if (!isEmpty(source.projection)) chain.push(`.projection(${parse(source.projection, pad)})`);
    if (!isEmpty(source.sort)) chain.push(`.sort(${parse(source.sort, pad)})`);
    if (source.skip !== null) chain.push(`.skip(${source.skip})`);
    if (source.limit !== null) chain.push(`.limit(${source.limit})`);
    query = [
      `${pad}FindIterable<Document> result = ${chain.join(`\n${pad}        `)};`,
      `${pad}for (Document document : result) {`,
    ];
  }
  return [
    ...(source.kind === "find" ? ["import com.mongodb.client.FindIterable;"] : []),
    "import com.mongodb.client.MongoClient;",
    "import com.mongodb.client.MongoClients;",
    "import com.mongodb.client.MongoCollection;",
    ...(source.kind === "aggregate" ? ["import java.util.List;"] : []),
    "import org.bson.Document;",
    "",
    "public class Query {",
    "    public static void main(String[] args) {",
    '        try (MongoClient client = MongoClients.create(System.getenv("MONGODB_URI"))) {',
    `            MongoCollection<Document> collection = client.getDatabase(${str(source.database)}).getCollection(${str(source.collection)});`,
    ...query,
    `${pad}    System.out.println(document.toJson());`,
    `${pad}}`,
    "        }",
    "    }",
    "}",
  ].join("\n");
}

function csharp(source: CodeSource): string {
  const parse = (value: JsonValue) => `BsonDocument.Parse(@"${json(value).replaceAll('"', '""')}")`;
  let query: string[];
  if (source.kind === "aggregate") {
    query = [
      "var pipeline = new[]",
      "{",
      source.pipeline.map((stage) => `    ${parse(stage)}`).join(",\n"),
      "};",
      "var documents = collection.Aggregate<BsonDocument>(pipeline).ToList();",
    ];
  } else {
    const chain = [`collection.Find(${parse(source.filter)})`];
    if (!isEmpty(source.projection)) chain.push(`.Project(${parse(source.projection)})`);
    if (!isEmpty(source.sort)) chain.push(`.Sort(${parse(source.sort)})`);
    if (source.skip !== null) chain.push(`.Skip(${source.skip})`);
    if (source.limit !== null) chain.push(`.Limit(${source.limit})`);
    chain.push(".ToList()");
    query = [`var documents = ${chain.join("\n    ")};`];
  }
  return [
    "using MongoDB.Bson;",
    "using MongoDB.Driver;",
    "",
    'var client = new MongoClient(Environment.GetEnvironmentVariable("MONGODB_URI"));',
    `var collection = client.GetDatabase(${str(source.database)}).GetCollection<BsonDocument>(${str(source.collection)});`,
    "",
    ...query,
    "foreach (var document in documents)",
    "{",
    "    Console.WriteLine(document);",
    "}",
  ].join("\n");
}

function go(source: CodeSource): string {
  // Go raw strings cannot contain a backquote: splice one in when needed.
  const raw = (value: JsonValue) => `\`${json(value, 2).replaceAll("`", '` + "`" + `')}\``;
  const decode = (name: string, value: JsonValue) => [
    `\tvar ${name} bson.D`,
    `\tif err := bson.UnmarshalExtJSON([]byte(${indentLines(raw(value), "\t").trimStart()}), true, &${name}); err != nil {`,
    "\t\tpanic(err)",
    "\t}",
  ];
  let query: string[];
  if (source.kind === "aggregate") {
    query = [
      "\tstages := []string{",
      ...source.pipeline.map((stage) => `\t\t${indentLines(raw(stage), "\t\t").trimStart()},`),
      "\t}",
      "\tpipeline := mongo.Pipeline{}",
      "\tfor _, stage := range stages {",
      "\t\tvar decoded bson.D",
      "\t\tif err := bson.UnmarshalExtJSON([]byte(stage), true, &decoded); err != nil {",
      "\t\t\tpanic(err)",
      "\t\t}",
      "\t\tpipeline = append(pipeline, decoded)",
      "\t}",
      "\tcursor, err := collection.Aggregate(ctx, pipeline)",
    ];
  } else {
    query = decode("filter", source.filter);
    const options = ["\topts := options.Find()"];
    if (!isEmpty(source.projection)) {
      query.push(...decode("projection", source.projection));
      options.push(".SetProjection(projection)");
    }
    if (!isEmpty(source.sort)) {
      query.push(...decode("sort", source.sort));
      options.push(".SetSort(sort)");
    }
    if (source.skip !== null) options.push(`.SetSkip(${source.skip})`);
    if (source.limit !== null) options.push(`.SetLimit(${source.limit})`);
    query.push(options.join(""), "\tcursor, err := collection.Find(ctx, filter, opts)");
  }
  return [
    "package main",
    "",
    "import (",
    '\t"context"',
    '\t"fmt"',
    '\t"os"',
    "",
    '\t"go.mongodb.org/mongo-driver/v2/bson"',
    '\t"go.mongodb.org/mongo-driver/v2/mongo"',
    '\t"go.mongodb.org/mongo-driver/v2/mongo/options"',
    ")",
    "",
    "func main() {",
    "\tctx := context.Background()",
    '\tclient, err := mongo.Connect(options.Client().ApplyURI(os.Getenv("MONGODB_URI")))',
    "\tif err != nil {",
    "\t\tpanic(err)",
    "\t}",
    "\tdefer client.Disconnect(ctx)",
    `\tcollection := client.Database(${str(source.database)}).Collection(${str(source.collection)})`,
    "",
    ...query,
    "\tif err != nil {",
    "\t\tpanic(err)",
    "\t}",
    "\tvar results []bson.M",
    "\tif err := cursor.All(ctx, &results); err != nil {",
    "\t\tpanic(err)",
    "\t}",
    "\tfor _, document := range results {",
    "\t\tfmt.Println(document)",
    "\t}",
    "}",
  ].join("\n");
}

// Shared literal printer for the languages with native BSON literals.

interface Dialect {
  /** One indentation level. */
  indent: string;
  key: (key: string) => string;
  null: string;
  bool: (value: boolean) => string;
  string: (value: string) => string;
  /** Code for a canonical EJSON wrapper such as `{ $oid: … }`, or undefined if not one. */
  wrapper: (type: string, inner: JsonValue | undefined) => string | undefined;
}

function literal(value: JsonValue, depth: number, dialect: Dialect): string {
  if (value === null) return dialect.null;
  if (typeof value === "boolean") return dialect.bool(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return dialect.string(value);
  const pad = dialect.indent.repeat(depth + 1);
  const close = dialect.indent.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => `${pad}${literal(item, depth + 1, dialect)}`);
    return `[\n${items.join(",\n")}\n${close}]`;
  }
  const wrapped = wrapperOf(value, dialect);
  if (wrapped !== undefined) return wrapped;
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  const fields = entries.map(
    ([key, field]) => `${pad}${dialect.key(key)}: ${literal(field, depth + 1, dialect)}`,
  );
  return `{\n${fields.join(",\n")}\n${close}}`;
}

function wrapperOf(value: JsonObject, dialect: Dialect): string | undefined {
  const keys = Object.keys(value);
  const [key] = keys;
  if (keys.length !== 1 || key === undefined || !key.startsWith("$")) return undefined;
  return dialect.wrapper(key, value[key]);
}

const str = (value: string) => JSON.stringify(value);

function isoDate(inner: JsonValue | undefined): string {
  const millis = isJsonObject(inner) ? Number(inner.$numberLong) : Number(inner);
  return new Date(millis).toISOString();
}

const subType = (inner: JsonObject) => Number.parseInt(String(inner.subType), 16);

const indentLines = (text: string, pad: string) =>
  text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
