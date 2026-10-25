/**
 * In-memory stand-in for the Rust backend, installed only by `vite dev` outside Tauri.
 * It honors the same command contract (typed errors, cursor paging, read-only
 * profiles) so the UI can be developed and reviewed in a plain browser.
 * Query support is deliberately shallow: simple filters, projections and common stages.
 */

import type {
  CollectionInfo,
  CollectionOptions,
  ConnectionInfo,
  ConnectionProfile,
  ConvertTarget,
  DatabaseInfo,
  DocumentPage,
  FieldChange,
  FindRequest,
  IpcError,
  JsonValue,
  ProfileInput,
  QueryOptions,
  ReplicaSetStatus,
  SearchHit,
  SearchRequest,
} from "@odin-db/bindings";
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fieldPathsOf } from "@/lib/ejson-fields";
import { PROFILE_COLORS } from "@/lib/profile-colors";

type Doc = { [key: string]: JsonValue };
type Collections = Record<
  string,
  {
    kind: CollectionInfo["kind"];
    docs: Doc[];
    /** Known size of lazily built `docs`, so listing does not build them. */
    count?: number;
    indexes?: Doc[];
    validation?: { validator: JsonValue; level: string; action: string };
  }
>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (kind: IpcError["kind"], message: string, detail: string | null = null): never => {
  throw { kind, message, detail } satisfies IpcError;
};

/** Index builds the mock pretends to run, as `create_index` starts them. */
const indexBuilds: { key: string; name: string; startedAt: number }[] = [];
const MOCK_BUILD_MS = 6_000;

/** What the fake bastion presents, as an SSH server's SHA-256 host key fingerprint. */
const BASTION_KEY = "SHA256:q6z8m1Kc0rTQ3o5vY2bX9eW4nJ7hLsF0aUuD1pG8kM4";

let counter = 0;
const oid = () => {
  counter += 1;
  return {
    $oid:
      (0x65f0a1c2 + counter).toString(16).padStart(8, "0") + counter.toString(16).padStart(16, "0"),
  };
};

const firstNames = [
  "Ada",
  "Linus",
  "Grace",
  "Alan",
  "Margaret",
  "Ken",
  "Barbara",
  "Dennis",
  "Radia",
  "Guido",
];
const cities = ["Milano", "Torino", "Bologna", "Roma", "Napoli", "Firenze", "Verona"];
const cityCenters: [number, number][] = [
  [9.19, 45.46],
  [7.69, 45.07],
  [11.34, 44.49],
  [12.5, 41.9],
  [14.27, 40.85],
  [11.26, 43.77],
  [10.99, 45.44],
];
const plans = ["free", "pro", "team", "enterprise"];

/** A GeoJSON point a few kilometres from `center`, the same for the same `i`. */
function pointNear([lon, lat]: [number, number], i: number): Doc {
  const offset = (seed: number) => ((seed % 100) - 50) / 1000;
  return {
    type: "Point",
    coordinates: [
      { $numberDouble: String(Math.round((lon + offset(i * 37)) * 1e4) / 1e4) },
      { $numberDouble: String(Math.round((lat + offset(i * 53)) * 1e4) / 1e4) },
    ],
  };
}

function user(i: number): Doc {
  const name = `${firstNames[i % firstNames.length]} ${String.fromCharCode(65 + (i % 26))}.`;
  const doc: Doc = {
    _id: oid(),
    name,
    email: `${name.split(" ")[0]?.toLowerCase()}.${i}@example.com`,
    age: { $numberInt: String(18 + ((i * 7) % 60)) },
    plan: plans[i % plans.length] ?? "free",
    active: i % 5 !== 0,
    balance: { $numberDecimal: `${(i * 37) % 5000}.${String(i % 100).padStart(2, "0")}` },
    // Mixed types, as real data often has: some scores were written as integers.
    score:
      i % 8 === 0
        ? { $numberInt: String((i * 13) % 100) }
        : { $numberDouble: String(((i * 13) % 1000) / 10) },
    loginCount: { $numberLong: String(i * 1_234_567) },
    createdAt: { $date: { $numberLong: String(1_672_531_200_000 + i * 3_600_000) } },
    tags: i % 3 === 0 ? ["beta", "newsletter"] : ["newsletter"],
    address: {
      city: cities[i % cities.length] ?? "Milano",
      zip: String(20100 + (i % 90)),
      location: pointNear(cityCenters[i % cityCenters.length] ?? [9.19, 45.46], i),
    },
  };
  if (i % 7 === 0) doc.referrer = null;
  if (i % 11 === 0) doc.avatar = { $binary: { base64: "iVBORw0KGgo=", subType: "00" } };
  return doc;
}

/** Orders over about four months, more of them as time goes on, at varied hours. */
function placedAt(i: number): number {
  const day = Math.floor(120 * (i / 350) ** 0.6);
  return 1_700_000_000_000 + day * 86_400_000 + ((i * 7) % 24) * 3_600_000;
}

function order(i: number): Doc {
  return {
    _id: oid(),
    number: { $numberInt: String(10_000 + i) },
    status: ["pending", "paid", "shipped", "refunded"][i % 4] ?? "pending",
    total: { $numberDecimal: `${(i * 19) % 900}.99` },
    items: Array.from({ length: (i % 4) + 1 }, (_, n) => ({
      sku: `SKU-${n}`,
      qty: { $numberInt: "1" },
    })),
    placedAt: { $date: { $numberLong: String(placedAt(i)) } },
    tracking: `https://track.example.com/${10_000 + i}`,
  };
}

function event(i: number): Doc {
  return {
    _id: oid(),
    type: ["page_view", "click", "signup", "purchase"][i % 4] ?? "click",
    sessionId: { $binary: { base64: btoa(String(i).padStart(16, "0")), subType: "04" } },
    at: { $timestamp: { t: 1_700_000_000 + i, i: 1 } },
    durationMs: { $numberInt: String((i * 31) % 4000) },
  };
}

function wide(i: number): Doc {
  const doc: Doc = { _id: oid() };
  for (let f = 0; f < 300; f++) {
    doc[`field_${String(f).padStart(3, "0")}`] =
      f % 3 === 0 ? { $numberInt: String(i * f) } : f % 3 === 1 ? `value ${i}-${f}` : f % 2 === 0;
  }
  return doc;
}

function nested(i: number): Doc {
  let leaf: Doc = { depth: { $numberInt: "12" }, note: `leaf ${i}` };
  for (let d = 11; d > 0; d--) leaf = { depth: { $numberInt: String(d) }, child: leaf };
  return {
    _id: oid(),
    name: `nested ${i}`,
    tree: leaf,
    tags: Array.from({ length: 50 }, (_, t) => `tag-${t}`),
    items: Array.from({ length: 30 }, (_, t) => ({
      sku: `SKU-${i}-${t}`,
      qty: { $numberInt: String(t) },
    })),
  };
}

const servers: Record<string, Record<string, Collections>> = {
  local: {
    shop: {
      users: {
        kind: "collection",
        docs: Array.from({ length: 1240 }, (_, i) => user(i)),
        indexes: [
          { v: { $numberInt: "2" }, key: { _id: { $numberInt: "1" } }, name: "_id_" },
          {
            v: { $numberInt: "2" },
            key: { email: { $numberInt: "1" } },
            name: "email_1",
            unique: true,
          },
          {
            v: { $numberInt: "2" },
            key: { plan: { $numberInt: "1" }, createdAt: { $numberInt: "-1" } },
            name: "plan_1_createdAt_-1",
            partialFilterExpression: { active: true },
          },
        ],
      },
      orders: { kind: "collection", docs: Array.from({ length: 350 }, (_, i) => order(i)) },
      active_users: { kind: "view", docs: [] },
      "system.views": { kind: "collection", docs: [] },
    },
    analytics: {
      events: { kind: "collection", docs: Array.from({ length: 25_000 }, (_, i) => event(i)) },
      metrics: { kind: "timeseries", docs: [] },
      // Stress shapes: very wide documents and deep, array-heavy ones.
      wide: { kind: "collection", docs: Array.from({ length: 400 }, (_, i) => wide(i)) },
      nested: { kind: "collection", docs: Array.from({ length: 200 }, (_, i) => nested(i)) },
    },
    admin: {},
    // A GridFS bucket: files are described in `fs.files`, their bytes in `fs.chunks`.
    media: {
      "fs.files": {
        kind: "collection",
        docs: ["invoice-2024-001.pdf", "logo.png", "export.csv"].map((filename, i) => ({
          _id: oid(),
          filename,
          length: { $numberLong: String(18_000 + i * 52_311) },
          chunkSize: { $numberInt: "261120" },
          uploadDate: { $date: { $numberLong: String(1_700_000_000_000 + i * 86_400_000) } },
          metadata: { contentType: ["application/pdf", "image/png", "text/csv"][i] ?? "" },
        })),
      },
      "fs.chunks": { kind: "collection", docs: [] },
    },
  },
  // A busy multi-tenant cluster: hundreds of databases, one with thousands of collections.
  large: largeCluster(),
};

function largeCluster(): Record<string, Collections> {
  const kinds = ["users", "orders", "events", "invoices", "sessions", "audit_log", "settings"];
  const databases: Record<string, Collections> = {};
  for (let d = 0; d < 320; d++) {
    const name = d === 0 ? "archive" : `tenant_${String(d).padStart(3, "0")}`;
    const total = d === 0 ? 2500 : (d * 7) % 40;
    const collections: Collections = {};
    for (let c = 0; c < total; c++) {
      const base = kinds[c % kinds.length] ?? "items";
      const collection = c < kinds.length ? base : `${base}_${Math.floor(c / kinds.length)}`;
      // Documents are built on first read: most collections are never opened.
      let docs: Doc[] | undefined;
      const count = (c * 13 + d) % 60;
      collections[collection] = {
        kind: "collection",
        get count() {
          return docs?.length ?? count;
        },
        get docs() {
          docs ??= Array.from({ length: count }, (_, i) => user(i));
          return docs;
        },
        set docs(next) {
          docs = next;
        },
      };
    }
    databases[name] = collections;
  }
  return databases;
}

const profiles: ConnectionProfile[] = [
  {
    id: "0192f000-0000-7000-8000-000000000001",
    name: "Local development",
    connectionString: "mongodb://localhost:27017",
    readOnly: false,
    hasPassword: false,
    color: "green",
    ssh: null,
    hasSshSecret: false,
    sshHostKey: null,
    group: null,
  },
  {
    id: "0192f000-0000-7000-8000-000000000002",
    name: "Production (Atlas)",
    connectionString: "mongodb+srv://reader@cluster0.example.net/?retryWrites=true",
    readOnly: true,
    hasPassword: true,
    color: "red",
    ssh: null,
    hasSshSecret: false,
    sshHostKey: null,
    group: null,
  },
  {
    id: "0192f000-0000-7000-8000-000000000003",
    name: "Staging (bastion)",
    connectionString: "mongodb://app@db.staging.internal:27017",
    readOnly: false,
    hasPassword: true,
    color: "orange",
    ssh: {
      host: "bastion.example.com",
      port: 22,
      username: "deploy",
      auth: { kind: "privateKey", path: "/Users/ada/.ssh/id_ed25519" },
    },
    hasSshSecret: true,
    sshHostKey: null,
    group: null,
  },
];

profiles.push({
  id: "0192f000-0000-7000-8000-000000000004",
  name: "Tenants cluster",
  // Grouped, so the sidebar shows a folder in the browser preview.
  connectionString: "mongodb://tenants.internal:27017",
  readOnly: false,
  hasPassword: false,
  color: "blue",
  ssh: null,
  hasSshSecret: false,
  sshHostKey: null,
  group: "Clients",
});

const connections = new Map<string, ConnectionInfo>();
const cursors = new Map<string, { docs: Doc[]; offset: number }>();

function serverOf(connectionId: string) {
  const connection =
    connections.get(connectionId) ?? fail("notConnected", "connection is not open");
  // Every profile points at the same fake server.
  const profile = profiles.find((p) => p.id === connection.profileId);
  const large = profile?.connectionString.includes("tenants") ?? false;
  return { connection, databases: (large ? servers.large : servers.local) ?? {} };
}

/** Orders by each sort key in turn; numbers and dates compare by value, the rest as text. */
function sortDocs(docs: Doc[], sort: Doc): Doc[] {
  const scalar = (value: JsonValue | undefined): number | string => {
    if (value === undefined || value === null) return "";
    if (typeof value !== "object" || Array.isArray(value))
      return typeof value === "number" ? value : String(value);
    const inner = Object.values(value)[0];
    if ("$date" in value) return Number((inner as Doc).$numberLong ?? inner);
    if (["$numberInt", "$numberLong", "$numberDouble", "$numberDecimal"].some((k) => k in value))
      return Number(inner);
    return JSON.stringify(value);
  };
  const keys = Object.entries(sort).map(([field, direction]) => ({
    field,
    direction: Number(scalar(direction)) < 0 ? -1 : 1,
  }));
  return [...docs].sort((a, b) => {
    for (const { field, direction } of keys) {
      const left = scalar(
        field
          .split(".")
          .reduce<JsonValue | undefined>(
            (doc, part) =>
              doc && typeof doc === "object" && !Array.isArray(doc) ? doc[part] : undefined,
            a,
          ),
      );
      const right = scalar(
        field
          .split(".")
          .reduce<JsonValue | undefined>(
            (doc, part) =>
              doc && typeof doc === "object" && !Array.isArray(doc) ? doc[part] : undefined,
            b,
          ),
      );
      if (left < right) return -direction;
      if (left > right) return direction;
    }
    return 0;
  });
}

/** Like MongoDB, reads of a missing collection see it empty; only writes create it. */
function collectionOf(
  connectionId: string,
  database: string,
  collection: string,
  { create = false } = {},
) {
  const { connection, databases } = serverOf(connectionId);
  const existing = databases[database]?.[collection];
  if (existing || !create)
    return { connection, coll: existing ?? { kind: "collection" as const, docs: [] } };
  databases[database] ??= {};
  const db = databases[database];
  db[collection] = { kind: "collection", docs: [] };
  return { connection, coll: db[collection] };
}

function project(doc: Doc, projection: Doc | null) {
  if (!projection || Object.keys(projection).length === 0) return doc;
  const keys = Object.keys(projection).filter(
    (key) => JSON.stringify(projection[key]) !== '{"$numberInt":"0"}',
  );
  return Object.fromEntries(
    Object.entries(doc).filter(([key]) => key === "_id" || keys.includes(key)),
  );
}

const scalar = (value: JsonValue | undefined) => scalarOf(value);

/** Plain JS value of a canonical EJSON scalar, for comparisons. */
function scalarOf(value: JsonValue | undefined): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const [key] = Object.keys(value);
  const inner = key === undefined ? undefined : value[key];
  if (
    key === "$numberInt" ||
    key === "$numberLong" ||
    key === "$numberDouble" ||
    key === "$numberDecimal"
  ) {
    return Number(inner);
  }
  if (key === "$date" && inner && typeof inner === "object" && !Array.isArray(inner)) {
    return Number(inner.$numberLong);
  }
  if (key === "$oid") return inner;
  return JSON.stringify(value);
}

const num = (n: number): JsonValue =>
  Number.isInteger(n) ? { $numberInt: String(n) } : { $numberDouble: String(n) };

function compare(a: unknown, b: unknown) {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : 1;
}

function fieldValue(doc: Doc, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = doc;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = current[part];
  }
  return current;
}

/** True when a collation compares strings regardless of case (strength 1 or 2). */
function ignoresCase(options: QueryOptions | undefined) {
  const collation = options?.collation as Doc | null | undefined;
  const strength = collation?.strength;
  return strength !== undefined && Number(scalar(strength)) <= 2;
}

function matchesFilter(doc: Doc, filter: Doc, caseless = false): boolean {
  const scalar = (value: JsonValue | undefined) => {
    const plain = scalarOf(value);
    return caseless && typeof plain === "string" ? plain.toLowerCase() : plain;
  };
  return Object.entries(filter).every(([key, condition]) => {
    const clauses = Array.isArray(condition) ? (condition as Doc[]) : [];
    if (key === "$and") return clauses.every((clause) => matchesFilter(doc, clause, caseless));
    if (key === "$or") return clauses.some((clause) => matchesFilter(doc, clause, caseless));
    if (key === "$nor") return !clauses.some((clause) => matchesFilter(doc, clause, caseless));
    if (key.startsWith("$")) return true;
    const value = scalar(fieldValue(doc, key));
    if (condition && typeof condition === "object" && !Array.isArray(condition)) {
      const ops = Object.entries(condition);
      if (
        ops.every(
          ([op]) =>
            op.startsWith("$") &&
            ![
              "$oid",
              "$numberInt",
              "$numberLong",
              "$numberDouble",
              "$numberDecimal",
              "$date",
            ].includes(op),
        )
      ) {
        return ops.every(([op, target]) => {
          const t = scalar(target);
          if (op === "$gt") return compare(value, t) > 0;
          if (op === "$gte") return compare(value, t) >= 0;
          if (op === "$lt") return compare(value, t) < 0;
          if (op === "$lte") return compare(value, t) <= 0;
          if (op === "$ne") return value !== t;
          if (op === "$in" && Array.isArray(target)) return target.some((v) => scalar(v) === value);
          return true;
        });
      }
    }
    return value === scalar(condition);
  });
}

/** A deliberately small aggregation engine: enough stages to exercise the builder UI. */
function aggregate(input: Doc[], pipeline: Doc[]): Doc[] {
  let docs = input;
  for (const stage of pipeline) {
    const [op] = Object.keys(stage);
    const arg = op === undefined ? undefined : stage[op];
    const n = Number(scalar(arg));
    switch (op) {
      case "$match":
        docs = docs.filter((doc) => matchesFilter(doc, arg as Doc));
        break;
      case "$limit":
        docs = docs.slice(0, n);
        break;
      case "$skip":
        docs = docs.slice(n);
        break;
      case "$sort": {
        const keys = Object.entries(arg as Doc).map(
          ([k, dir]) => [k, Number(scalar(dir))] as const,
        );
        docs = [...docs].sort((a, b) => {
          for (const [k, dir] of keys) {
            const c = compare(scalar(fieldValue(a, k)), scalar(fieldValue(b, k)));
            if (c !== 0) return c * dir;
          }
          return 0;
        });
        break;
      }
      case "$project":
        docs = docs.map((doc) => project(doc, arg as Doc));
        break;
      case "$addFields":
      case "$set":
        docs = docs.map((doc) => {
          const added = Object.fromEntries(
            Object.entries(arg as Doc).map(([k, v]) => [
              k,
              typeof v === "string" && v.startsWith("$")
                ? (fieldValue(doc, v.slice(1)) ?? null)
                : v,
            ]),
          );
          return { ...doc, ...added };
        });
        break;
      case "$unset": {
        const fields = Array.isArray(arg) ? arg : [arg];
        docs = docs.map((doc) =>
          Object.fromEntries(Object.entries(doc).filter(([k]) => !fields.includes(k))),
        );
        break;
      }
      case "$count":
        docs = [{ [String(arg)]: num(docs.length) }];
        break;
      case "$unwind": {
        const path = String(typeof arg === "string" ? arg : (arg as Doc).path).slice(1);
        docs = docs.flatMap((doc) => {
          const value = fieldValue(doc, path);
          return Array.isArray(value) ? value.map((item) => ({ ...doc, [path]: item })) : [];
        });
        break;
      }
      case "$group": {
        const spec = arg as Doc;
        const groups = new Map<string, { id: JsonValue; docs: Doc[] }>();
        for (const doc of docs) {
          const idSpec = spec._id;
          const id =
            typeof idSpec === "string" && idSpec.startsWith("$")
              ? (fieldValue(doc, idSpec.slice(1)) ?? null)
              : (idSpec ?? null);
          const key = JSON.stringify(id);
          const group = groups.get(key) ?? { id, docs: [] };
          group.docs.push(doc);
          groups.set(key, group);
        }
        docs = [...groups.values()].map(({ id, docs: members }) => {
          const out: Doc = { _id: id };
          for (const [field, acc] of Object.entries(spec)) {
            if (field === "_id" || !acc || typeof acc !== "object" || Array.isArray(acc)) continue;
            const [accOp] = Object.keys(acc);
            const expr = accOp === undefined ? undefined : acc[accOp];
            const values = members.map((m) =>
              typeof expr === "string" && expr.startsWith("$")
                ? Number(scalar(fieldValue(m, expr.slice(1))))
                : Number(scalar(expr)),
            );
            const sum = values.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);
            out[field] = num(accOp === "$avg" ? sum / Math.max(values.length, 1) : sum);
          }
          return out;
        });
        break;
      }
      default:
        break;
    }
  }
  return docs;
}

function indexesOf(coll: { indexes?: Doc[] }): Doc[] {
  coll.indexes ??= [{ v: num(2), key: { _id: num(1) }, name: "_id_" }];
  return coll.indexes;
}

function page(id: string, batchSize: number): DocumentPage {
  const cursor = cursors.get(id) ?? fail("notFound", "cursor not found");
  // Copies, like real IPC: later writes must not change rows the UI already holds.
  const documents = structuredClone(cursor.docs.slice(cursor.offset, cursor.offset + batchSize));
  cursor.offset += documents.length;
  const exhausted = cursor.offset >= cursor.docs.length;
  if (exhausted) cursors.delete(id);
  return { documents, cursorId: exhausted ? null : id };
}

function validate(input: ProfileInput) {
  if (input.name.trim() === "")
    fail("validation", "invalid input: name must be between 1 and 100 characters");
  if (!/^mongodb(\+srv)?:\/\//.test(input.connectionString.trim())) {
    fail(
      "validation",
      "invalid input: invalid connection string: connection string must start with mongodb:// or mongodb+srv://",
    );
  }
}

const id = (key: string, args: Record<string, unknown>) => args[key] as string;
const ensureWritable = (connection: ConnectionInfo) => {
  if (connection.readOnly) fail("readOnly", "this connection is read-only");
};

/** Sends ordered messages to a Tauri `Channel`, like the Rust side does. */
function channelSender(channel: unknown) {
  const id = (channel as { id: number }).id;
  let index = 0;
  return (message: unknown) => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
      }
    ).__TAURI_INTERNALS__;
    internals.runCallback(id, { index, message });
    index += 1;
  };
}

const operations = new Map<string, { cancelled: boolean }>();

/** Simulates a long transfer: progress ticks, then a summary, then the terminal event. */
function simulateTransfer(
  channel: unknown,
  total: number,
  summary: unknown,
  bytesPerDoc: number,
  progressOf: (done: number) => unknown = (done) => ({
    documents: done,
    bytes: done * bytesPerDoc,
  }),
) {
  const send = channelSender(channel);
  const operationId = crypto.randomUUID();
  const operation = { cancelled: false };
  operations.set(operationId, operation);
  let done = 0;
  const tick = () => {
    if (operation.cancelled) {
      send({ event: "cancelled" });
      operations.delete(operationId);
      return;
    }
    done = Math.min(total, done + Math.ceil(total / 8));
    send({
      event: "data",
      data: { kind: "progress", value: progressOf(done) },
    });
    if (done < total) {
      setTimeout(tick, 250);
      return;
    }
    send({ event: "data", data: { kind: "finished", value: summary } });
    send({ event: "completed" });
    operations.delete(operationId);
  };
  setTimeout(tick, 250);
  return operationId;
}

/** Progress events from 0 to `total`, then completion; Stop cancels like a real operation. */
function streamProgress(
  channel: unknown,
  total: number,
  dataOf: (done: number, total: number) => unknown,
  onCompleted?: () => void,
) {
  const send = channelSender(channel);
  const operationId = crypto.randomUUID();
  const operation = { cancelled: false };
  operations.set(operationId, operation);
  let done = 0;
  const tick = () => {
    if (operation.cancelled) {
      operations.delete(operationId);
      send({ event: "cancelled" });
      return;
    }
    done = Math.min(total, done + total / 10);
    send({ event: "data", data: dataOf(done, total) });
    if (done < total) {
      setTimeout(tick, 250);
      return;
    }
    operations.delete(operationId);
    onCompleted?.();
    send({ event: "completed" });
  };
  setTimeout(tick, 250);
  return operationId;
}

const MOCK_MODELS = [
  {
    id: "qwen2.5-coder-0.5b",
    name: "Qwen2.5 Coder 0.5B",
    publisher: "Alibaba Qwen",
    parameters: "0.5B",
    license: "Apache-2.0",
    tier: "fast",
    size: 491_400_064,
    minMemoryGib: 4,
    benchmark: { accuracy: 0.55, secondsPerQuery: 1.1 },
  },
  {
    id: "qwen2.5-coder-1.5b",
    name: "Qwen2.5 Coder 1.5B",
    publisher: "Alibaba Qwen",
    parameters: "1.5B",
    license: "Apache-2.0",
    tier: "balanced",
    size: 1_117_320_768,
    minMemoryGib: 8,
    benchmark: { accuracy: 0.85, secondsPerQuery: 2.9 },
  },
  {
    id: "qwen3.5-4b",
    name: "Qwen3.5 4B",
    publisher: "Alibaba Qwen",
    parameters: "4B",
    license: "Apache-2.0",
    tier: "accurate",
    size: 2_740_937_888,
    minMemoryGib: 16,
    benchmark: { accuracy: 0.9, secondsPerQuery: 7.1 },
  },
];
const mockCompare = { synced: false };
const mockProfiling = new Map<string, { level: string; slowMs: number }>();
const mockAi = { installed: new Set<string>(), partial: new Map<string, number>() };

const importFiles = new Map<string, { rows: string[][]; headers: string[] }>();
const importFolders = new Set<string>();
/** Files dropped on the window, by token, like the backend keeps their paths. */
const droppedFiles = new Map<string, { name: string; directory: boolean }>();

const mockUsers = [
  {
    user: "admin",
    db: "admin",
    roles: [{ role: "root", db: "admin" }],
    mechanisms: ["SCRAM-SHA-256"],
  },
  {
    user: "shop-api",
    db: "shop",
    roles: [{ role: "readWrite", db: "shop" }],
    mechanisms: ["SCRAM-SHA-1", "SCRAM-SHA-256"],
  },
];

type MockPrivilege = {
  resource:
    | { kind: "namespace"; db: string; collection: string }
    | { kind: "cluster" }
    | { kind: "any" };
  actions: string[];
};
const mockRoles: {
  role: string;
  db: string;
  privileges: MockPrivilege[];
  roles: { role: string; db: string }[];
}[] = [
  {
    role: "reportWriter",
    db: "admin",
    privileges: [
      {
        resource: { kind: "namespace", db: "analytics", collection: "reports" },
        actions: ["find", "insert", "update"],
      },
      { resource: { kind: "cluster" }, actions: ["serverStatus"] },
    ],
    roles: [{ role: "read", db: "shop" }],
  },
];

const mockOps = [
  {
    opid: { $numberInt: "4721" },
    op: "query",
    ns: "analytics.events",
    startedAt: Date.now() - 42_000,
    client: "10.0.4.17:51234",
    appName: "reporting-job",
    description: "conn812",
    waitingForLock: false,
    command: { find: "events", filter: { type: "purchase" }, sort: { at: { $numberInt: "-1" } } },
  },
  {
    opid: { $numberInt: "4790" },
    op: "command",
    ns: "shop.orders",
    startedAt: Date.now() - 7_000,
    client: "10.0.4.22:50110",
    appName: "api",
    description: "conn901",
    waitingForLock: true,
    command: { createIndexes: "orders", indexes: [{ key: { customer: { $numberInt: "1" } } }] },
  },
];

/** Streams tool output lines, then totals, like mongodump/mongorestore runs. */
function simulateTool(channel: unknown, lines: string[], summary: unknown) {
  const send = channelSender(channel);
  const operationId = crypto.randomUUID();
  const operation = { cancelled: false };
  operations.set(operationId, operation);
  let index = 0;
  const tick = () => {
    if (operation.cancelled) {
      send({ event: "cancelled" });
      operations.delete(operationId);
      return;
    }
    const line = lines[index];
    if (line !== undefined) {
      const done = line.match(/^(?:done dumping|finished restoring) `(.+)` \((\d+)/);
      send({
        event: "data",
        data: {
          kind: "output",
          value: done
            ? { kind: "collection", namespace: done[1], documents: Number(done[2]), failures: 0 }
            : { kind: "log", line },
        },
      });
      index += 1;
      setTimeout(tick, 180);
      return;
    }
    send({ event: "data", data: { kind: "finished", value: summary } });
    send({ event: "completed" });
    operations.delete(operationId);
  };
  setTimeout(tick, 200);
  return operationId;
}

/** A tiny fake mongosh: echoes keystrokes and answers a few commands. */
const shells = new Map<string, { send: (message: unknown) => void; line: string }>();
const PROMPT = "\u001b[32mtest\u001b[0m> ";

function shellOutput(id: string, data: string) {
  shells.get(id)?.send({ kind: "output", data, bytes: data.length });
}

function evaluateShell(id: string, line: string) {
  const command = line.trim();
  if (command === "exit") {
    shells.get(id)?.send({ kind: "exited", code: 0 });
    shells.delete(id);
    return;
  }
  const answers: Record<string, string> = {
    "db.version()": "8.0.4",
    "show dbs": "admin       40.00 KiB\r\nanalytics    9.90 MiB\r\nshop       680.00 KiB",
    "db.getName()": "test",
  };
  const answer =
    command === ""
      ? ""
      : (answers[command] ??
        `\u001b[31mReferenceError\u001b[0m: ${command.split(/[.(]/)[0]} is not defined`);
  shellOutput(id, `${answer ? `${answer}\r\n` : ""}${PROMPT}`);
}

const LOCAL = "0192f000-0000-7000-8000-000000000001";
const ATLAS = "0192f000-0000-7000-8000-000000000002";
const hour = 3_600_000;
type MockRun = Record<string, unknown> & { id: string; status: string; startedAt: number };
type MockSchedule = Record<string, unknown> & { id: string; enabled: boolean };
const backupRuns: MockRun[] = [
  {
    id: crypto.randomUUID(),
    profileId: LOCAL,
    scheduleId: null,
    scope: { kind: "database", database: "shop" },
    archive: "/Users/ada/Backups/Local_shop_2026-10-17_090000.archive.gz",
    archiveExists: true,
    startedAt: Date.now() - 3 * hour,
    finishedAt: Date.now() - 3 * hour + 4_200,
    status: "completed",
    bytes: 182_000,
    collections: 3,
    documents: 1_590,
    error: null,
  },
  {
    id: crypto.randomUUID(),
    profileId: ATLAS,
    scheduleId: "s-1",
    scope: { kind: "deployment" },
    archive: "/Users/ada/Backups/Production-Atlas_all_2026-10-17_020000.archive.gz",
    archiveExists: true,
    startedAt: Date.now() - 10 * hour,
    finishedAt: Date.now() - 10 * hour + 65_000,
    status: "completed",
    bytes: 48_200_000,
    collections: 41,
    documents: 1_204_330,
    error: null,
  },
  {
    id: crypto.randomUUID(),
    profileId: ATLAS,
    scheduleId: "s-1",
    scope: { kind: "deployment" },
    archive: "/Users/ada/Backups/Production-Atlas_all_2026-10-16_020000.archive.gz",
    archiveExists: false,
    startedAt: Date.now() - 34 * hour,
    finishedAt: Date.now() - 34 * hour + 2_000,
    status: "failed",
    bytes: 0,
    collections: 0,
    documents: 0,
    error: "cannot reach the server: Server selection timeout",
  },
];
const backupSchedules: MockSchedule[] = [
  {
    id: "s-1",
    profileId: ATLAS,
    scope: { kind: "deployment" },
    folder: "/Users/ada/Backups",
    timing: { frequency: "daily", minute: 120, weekday: null },
    keep: 7,
    enabled: true,
    createdAt: Date.now() - 100 * hour,
    lastRunAt: Date.now() - 10 * hour,
    nextRunAt: Date.now() + 14 * hour,
  },
];
const backupsChanged = () => void emit("backups-changed", {});

/** A scheduled run: running for a moment, then completed. */
function simulateScheduledRun(schedule: MockSchedule) {
  const run: MockRun = {
    id: crypto.randomUUID(),
    profileId: schedule.profileId,
    scheduleId: schedule.id,
    scope: schedule.scope,
    archive: `${schedule.folder}/backup_${Date.now()}.archive.gz`,
    archiveExists: true,
    startedAt: Date.now(),
    finishedAt: null,
    status: "running",
    bytes: 0,
    collections: 0,
    documents: 0,
    error: null,
  };
  backupRuns.unshift(run);
  schedule.lastRunAt = run.startedAt;
  backupsChanged();
  setTimeout(() => {
    Object.assign(run, {
      status: "completed",
      finishedAt: Date.now(),
      bytes: 2_400_000,
      collections: 5,
      documents: 12_400,
    });
    backupsChanged();
  }, 1500);
}

/** `localStorage["odin-mock-no-tools"] = "1"` simulates a machine without Database Tools. */
const toolsInstalled = () => localStorage.getItem("odin-mock-no-tools") !== "1";

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  app_info: () => ({
    version: "0.1.0",
    tauriVersion: "mock",
    webviewVersion: navigator.userAgent,
    os: "browser",
    arch: "mock",
  }),
  perf_autorun_enabled: () => false,
  // Recorded for tests; like the app, only while the window is in the background.
  notify_if_unfocused: (args) => {
    if (!document.hasFocus()) {
      const sent = (window as { odinNotifications?: unknown[] }).odinNotifications ?? [];
      sent.push({ title: args.title, body: args.body });
      Object.assign(window, { odinNotifications: sent });
    }
    return null;
  },
  download_gridfs_file: (args) => {
    const total = 1_200_000;
    return simulateTransfer(
      args.channel,
      total,
      `/Users/ada/Downloads/${String(args.filename)}`,
      1,
      (done) => ({ done, total }),
    );
  },
  upload_gridfs_file: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    const _id = oid();
    coll.docs.push({
      _id,
      filename: "uploaded-report.pdf",
      length: { $numberLong: "48213" },
      chunkSize: { $numberInt: "261120" },
      uploadDate: { $date: { $numberLong: String(Date.now()) } },
    });
    const total = 48_213;
    return simulateTransfer(args.channel, total, _id, 1, (done) => ({ done, total }));
  },
  // `localStorage["odin-mock-update"] = "1"` offers a newer release.
  check_for_update: () =>
    localStorage.getItem("odin-mock-update") === "1"
      ? { version: "0.2.0", currentVersion: "0.1.0", notes: "Faster grids.", date: null }
      : null,
  install_update: (args) =>
    // The real backend then restarts the app; here it just ends.
    streamProgress(args.channel, 18_000_000, (done, total) => ({ done, total })),
  database_diagram: (args) => {
    const field = (path: string, type: string, frequency = 1) => ({
      path,
      types: [type],
      typeShares: [1],
      frequency,
      values: [],
    });
    const node = (name: string, documents: number, fields: ReturnType<typeof field>[]) => ({
      name,
      kind: "collection" as const,
      documents,
      fields: [field("_id", "objectId"), ...fields],
      error: null,
    });
    const link = (from: string, path: string, to: string, many = false) => ({
      from,
      field: path,
      to,
      many,
      matched: 38,
      checked: 40,
    });
    const diagram = {
      collections: [
        {
          ...node("active_users", 412, [field("name", "string"), field("lastSeen", "date")]),
          kind: "view" as const,
        },
        node("categories", 24, [
          field("name", "string"),
          field("parentId", "objectId", 0.6),
          field("slug", "string"),
        ]),
        node("coupons", 58, [
          field("code", "string"),
          field("discount", "decimal"),
          field("expiresAt", "date", 0.8),
        ]),
        node("orders", 350, [
          field("number", "int"),
          field("customerId", "objectId"),
          field("status", "string"),
          field("total", "decimal"),
          field("items", "array"),
          field("items.productId", "objectId"),
          field("items.qty", "int"),
          field("couponId", "objectId", 0.2),
          field("placedAt", "date"),
          field("shipping", "object"),
          field("shipping.city", "string"),
          field("shipping.zip", "string"),
        ]),
        node("products", 860, [
          field("sku", "string"),
          field("name", "string"),
          field("price", "decimal"),
          field("categoryId", "objectId"),
          field("supplierId", "objectId", 0.9),
          field("tags", "array", 0.7),
          field("stock", "int"),
        ]),
        node("reviews", 2_140, [
          field("userId", "objectId"),
          field("productId", "objectId"),
          field("rating", "int"),
          field("text", "string", 0.7),
          field("createdAt", "date"),
        ]),
        node("suppliers", 31, [
          field("name", "string"),
          field("country", "string"),
          field("email", "string"),
        ]),
        node("users", 1_240, [
          field("name", "string"),
          field("email", "string"),
          field("plan", "string"),
          field("address", "object"),
          field("address.city", "string"),
          field("favoriteIds", "array", 0.4),
          field("createdAt", "date"),
        ]),
      ],
      links: [
        link("categories", "parentId", "categories"),
        link("orders", "customerId", "users"),
        link("orders", "items.productId", "products", true),
        link("orders", "couponId", "coupons"),
        link("products", "categoryId", "categories"),
        link("products", "supplierId", "suppliers"),
        link("reviews", "userId", "users"),
        link("reviews", "productId", "products"),
        link("users", "favoriteIds", "products", true),
      ],
    };
    return simulateTransfer(args.channel, 17, diagram, 1, (done) => ({ done, total: 17 }));
  },
  save_diagram_image: (args) => {
    // Lets UI checks look at the rendered image.
    (window as { lastDiagramImage?: unknown }).lastDiagramImage = args.pngBase64;
    return `/Users/ada/Downloads/${String(args.database)}-diagram.png`;
  },
  index_advice: () => ({
    sources: [
      { name: "log", operations: 37, error: null },
      { name: "shop", operations: 112, error: null },
    ],
    advice: [
      {
        database: "shop",
        collection: "orders",
        keys: { status: { $numberInt: "1" }, placedAt: { $numberInt: "-1" } },
        occurrences: 42,
        totalMillis: 18_640,
        maxMillis: 1_210,
        docsExamined: 120_000,
        returned: 25,
        collectionScan: true,
        example: { status: "pending" },
        existing: null,
      },
      {
        database: "shop",
        collection: "users",
        keys: { plan: { $numberInt: "1" }, createdAt: { $numberInt: "1" } },
        occurrences: 9,
        totalMillis: 3_420,
        maxMillis: 610,
        docsExamined: 48_200,
        returned: 310,
        collectionScan: false,
        example: { plan: "pro", createdAt: { $gte: { $date: "2026-01-01T00:00:00Z" } } },
        existing: "plan_1_createdAt_-1",
      },
      {
        database: "analytics",
        collection: "events",
        keys: { type: { $numberInt: "1" } },
        occurrences: 4,
        totalMillis: 860,
        maxMillis: 300,
        docsExamined: 9_800,
        returned: 12,
        collectionScan: true,
        example: { type: "signup" },
        existing: null,
      },
    ],
  }),
  compare_schemas: (args) => {
    const index = (name: string, keys: Record<string, number>, unique = false) => ({
      name,
      keys: Object.fromEntries(
        Object.entries(keys).map(([k, v]) => [k, { $numberInt: String(v) }]),
      ),
      unique,
      sparse: false,
      hidden: false,
      expireAfterSeconds: null,
      partialFilter: null,
      definition: {},
      size: null,
      usageCount: null,
      usageSince: null,
    });
    const same = (name: string) => ({
      name,
      presence: "both",
      fields: [],
      indexes: [],
      validation: null,
      error: null,
    });
    const result = {
      collections: [
        { ...same("audit_log"), presence: "rightOnly" },
        same("categories"),
        { ...same("drafts"), presence: "leftOnly" },
        {
          ...same("orders"),
          fields: [
            {
              path: "couponCode",
              leftTypes: ["string"],
              rightTypes: [],
              leftFrequency: 0.3,
              rightFrequency: 0,
            },
            {
              path: "total",
              leftTypes: ["decimal"],
              rightTypes: ["double"],
              leftFrequency: 1,
              rightFrequency: 1,
            },
          ],
          indexes: [
            { left: index("status_1_placedAt_-1", { status: 1, placedAt: -1 }), right: null },
            {
              left: index("number_1", { number: 1 }, true),
              right: index("number_1", { number: 1 }),
            },
          ],
        },
        same("products"),
        {
          ...same("users"),
          indexes: [{ left: null, right: index("lastSeen_1", { lastSeen: 1 }) }],
          validation: {
            left: {
              validator: { $jsonSchema: { required: ["email"] } },
              level: "strict",
              action: "error",
            },
            right: { validator: {}, level: "strict", action: "error" },
          },
        },
      ],
    };
    return simulateTransfer(args.channel, 6, result, 1, (done) => ({ done, total: 6 }));
  },
  watch_changes: (args) => {
    const send = channelSender(args.channel);
    const operationId = crypto.randomUUID();
    const operation = { cancelled: false };
    operations.set(operationId, operation);
    let n = 0;
    const id = (i: number) => ({ _id: { $oid: `65f0a1c${String(9000 + i).padStart(17, "0")}` } });
    const events = [
      (i: number) => ({
        operation: "insert",
        key: id(i),
        document: { ...id(i), status: "pending", total: { $numberDecimal: "19.90" } },
        updated: null,
        removed: [],
      }),
      (i: number) => ({
        operation: "update",
        key: id(i - 1),
        document: { ...id(i - 1), status: "paid" },
        updated: { status: "paid", paidAt: { $date: { $numberLong: String(Date.now()) } } },
        removed: ["draft"],
      }),
      (i: number) => ({
        operation: "replace",
        key: id(i - 2),
        document: { ...id(i - 2), status: "shipped", carrier: "DHL" },
        updated: null,
        removed: [],
      }),
      (i: number) => ({
        operation: "delete",
        key: id(i - 3),
        document: null,
        updated: null,
        removed: [],
      }),
    ];
    const tick = () => {
      if (operation.cancelled) {
        send({ event: "cancelled" });
        operations.delete(operationId);
        return;
      }
      const make = events[n % events.length] as (i: number) => object;
      send({ event: "data", data: { kind: "change", value: { at: Date.now(), ...make(n) } } });
      n += 1;
      setTimeout(tick, 700);
    };
    setTimeout(tick, 400);
    return operationId;
  },
  search_values: (args) => {
    const { databases } = serverOf(id("connectionId", args));
    const request = args.request as SearchRequest;
    let pattern: RegExp;
    try {
      const source = request.regex
        ? request.text
        : request.text.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pattern = new RegExp(source, request.caseSensitive ? "" : "i");
    } catch (error) {
      return fail("validation", `invalid input: regular expression: ${String(error)}`);
    }
    if (!request.text.trim())
      return fail("validation", "invalid input: enter something to search for");
    const namespaces = Object.entries(databases)
      .filter(([db]) =>
        request.database ? db === request.database : !["admin", "local", "config"].includes(db),
      )
      .flatMap(([db, collections]) =>
        Object.entries(collections)
          .filter(
            ([name, coll]) =>
              (request.collection ? name === request.collection : !name.startsWith("system.")) &&
              coll.kind !== "view",
          )
          .map(([name, coll]) => ({ database: db, collection: name, docs: coll.docs })),
      );
    const send = channelSender(args.channel);
    const operationId = crypto.randomUUID();
    const operation = { cancelled: false };
    operations.set(operationId, operation);
    const summary = {
      collections: 0,
      documents: 0,
      hits: 0,
      partialCollections: 0,
      truncated: false,
    };
    let index = 0;
    const tick = () => {
      if (operation.cancelled) {
        send({ event: "cancelled" });
        operations.delete(operationId);
        return;
      }
      const target = namespaces[index];
      if (!target || summary.truncated) {
        send({ event: "data", data: { kind: "finished", value: summary } });
        send({ event: "completed" });
        operations.delete(operationId);
        return;
      }
      const namespace = { database: target.database, collection: target.collection };
      send({
        event: "data",
        data: {
          kind: "update",
          value: { kind: "scanning", value: { namespace, done: index, total: namespaces.length } },
        },
      });
      const read = target.docs.slice(0, request.documentsPerCollection);
      if (target.docs.length > read.length) summary.partialCollections += 1;
      const hits: SearchHit[] = [];
      const walk = (value: JsonValue, path: string, doc: Doc) => {
        // Ids and numbers match by their text, as in core.
        const wrapped =
          value && typeof value === "object" && !Array.isArray(value)
            ? Object.entries(value).find(([key]) =>
                ["$oid", "$numberInt", "$numberLong", "$numberDouble", "$numberDecimal"].includes(
                  key,
                ),
              )
            : undefined;
        if (wrapped) {
          const [kind, inner] = wrapped;
          const text = String(inner);
          if (pattern.test(text))
            hits.push({
              namespace,
              id: doc._id ?? null,
              path,
              preview: kind === "$oid" ? `ObjectId("${text}")` : text,
              fieldName: false,
              quoted: false,
            });
          return;
        }
        if (typeof value === "string") {
          if (pattern.test(value))
            hits.push({
              namespace,
              id: doc._id ?? null,
              path,
              preview: value.slice(0, 80),
              fieldName: false,
              quoted: true,
            });
        } else if (Array.isArray(value)) {
          for (const [i, item] of value.entries()) walk(item, `${path}.${i}`, doc);
        } else if (
          value &&
          typeof value === "object" &&
          !Object.keys(value).some((k) => k.startsWith("$"))
        )
          for (const [key, inner] of Object.entries(value)) {
            const child = path ? `${path}.${key}` : key;
            if (request.fieldNames && pattern.test(key))
              hits.push({
                namespace,
                id: doc._id ?? null,
                path: child,
                preview: key,
                fieldName: true,
                quoted: false,
              });
            walk(inner, child, doc);
          }
      };
      for (const doc of read) walk(doc, "", doc);
      const room = 1000 - summary.hits;
      if (hits.length > room) summary.truncated = true;
      const kept = hits.slice(0, room);
      summary.hits += kept.length;
      summary.documents += read.length;
      summary.collections += 1;
      if (kept.length > 0)
        send({ event: "data", data: { kind: "update", value: { kind: "hits", value: kept } } });
      index += 1;
      setTimeout(tick, 60);
    };
    setTimeout(tick, 60);
    return operationId;
  },
  compare_collections: (args) => {
    const oid = (n: number) => ({ $oid: `65f0a1c${String(n).padStart(17, "0")}` });
    const range = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => oid(from + i));
    return simulateTransfer(
      args.channel,
      2_450,
      mockCompare.synced
        ? {
            identical: 2_445,
            different: 0,
            onlyLeft: 0,
            onlyRight: 0,
            differentIds: [],
            onlyLeftIds: [],
            onlyRightIds: [],
          }
        : {
            identical: 2_385,
            different: 40,
            onlyLeft: 20,
            onlyRight: 5,
            differentIds: range(1, 40),
            onlyLeftIds: range(100, 20),
            onlyRightIds: range(200, 5),
          },
      1,
      (compared) => ({ compared, total: 2_450 }),
    );
  },
  sync_collections: (args) => {
    const request = args.request as { deleteExtra: boolean };
    mockCompare.synced = true;
    return simulateTransfer(
      args.channel,
      2_450,
      { identical: 2_385, inserted: 20, replaced: 40, deleted: request.deleteExtra ? 5 : 0 },
      1,
      (compared) => ({ compared, total: 2_450 }),
    );
  },
  compared_pair: (args) => ({
    left: { _id: args.id, name: "Ada A.", plan: "free", age: { $numberInt: "18" } },
    right: { _id: args.id, name: "Ada A.", plan: "pro", age: { $numberInt: "19" } },
  }),
  ai_overview: () => ({
    models: MOCK_MODELS.map((spec) => ({
      spec,
      state: mockAi.installed.has(spec.id)
        ? { state: "installed" }
        : mockAi.partial.has(spec.id)
          ? { state: "partial", received: mockAi.partial.get(spec.id) ?? 0 }
          : { state: "absent" },
    })),
    hardware: { memoryGib: 8, gpu: true },
    recommended: "qwen2.5-coder-1.5b",
    usedBytes: MOCK_MODELS.filter((spec) => mockAi.installed.has(spec.id)).reduce(
      (sum, spec) => sum + spec.size,
      0,
    ),
  }),
  download_ai_model: (args) => {
    const spec =
      MOCK_MODELS.find((candidate) => candidate.id === args.model) ??
      fail("validation", `unknown model ${String(args.model)}`);
    return streamProgress(
      args.channel,
      spec.size,
      (received, total) => {
        mockAi.partial.set(spec.id, received);
        return { received, total };
      },
      () => {
        mockAi.partial.delete(spec.id);
        mockAi.installed.add(spec.id);
      },
    );
  },
  delete_ai_model: (args) => {
    mockAi.installed.delete(String(args.model));
    mockAi.partial.delete(String(args.model));
    return null;
  },
  unload_ai_model: () => null,
  list_ollama_models: (args) => {
    if (!String(args.url).includes("11434")) fail("network", "Ollama: connection refused");
    return [{ name: "qwen2.5-coder:3b", size: 1_900_000_000, parameterSize: "3.1B" }];
  },
  // A stand-in for the model: "fail" fails, "newest" sorts, a number limits.
  generate_query: (args) => {
    const send = channelSender(args.channel);
    const operationId = crypto.randomUUID();
    const operation = { cancelled: false };
    operations.set(operationId, operation);
    const prompt = String((args.request as { prompt: string }).prompt);
    setTimeout(() => {
      operations.delete(operationId);
      if (operation.cancelled) return send({ event: "cancelled" });
      if (prompt.includes("fail")) {
        return send({
          event: "failed",
          data: { kind: "validation", message: "the model's answer is not a usable query" },
        });
      }
      const limit = /\d+/.exec(prompt)?.[0];
      send({
        event: "data",
        data: {
          filter: { status: "active", age: { $gt: { $numberInt: "30" } } },
          sort: prompt.includes("newest") ? { createdAt: { $numberInt: "-1" } } : null,
          projection: null,
          limit: limit ? Number(limit) : null,
        },
      });
      send({ event: "completed" });
    }, 600);
    return operationId;
  },
  open_link: (args) => {
    const url = String(args.url).trim();
    if (!/^(https?:\/\/|mailto:)\S+$/i.test(url)) {
      fail("validation", "only http, https and mailto links can be opened");
    }
    Object.assign(window, { odinOpenedLink: url });
    return null;
  },
  confirm_quit: () => {
    Object.assign(window, { odinMockQuit: true });
    return null;
  },
  // Copies, like real IPC: React Query must see a changed profile as a new object.
  list_profiles: () =>
    profiles.map((profile) => ({ ...profile })).sort((a, b) => a.name.localeCompare(b.name)),
  create_profile: (args) => {
    const input = args.input as ProfileInput;
    validate(input);
    const profile: ConnectionProfile = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      connectionString: input.connectionString.trim().replace(/\/\/([^:@/]+):[^@/]*@/, "//$1@"),
      readOnly: input.readOnly,
      hasPassword: input.password !== null || /\/\/[^:@/]+:[^@/]*@/.test(input.connectionString),
      color: input.color ?? null,
      ssh: input.ssh ?? null,
      hasSshSecret: input.ssh != null && input.sshSecret != null,
      sshHostKey: input.ssh ? (input.sshHostKey ?? null) : null,
      group: input.group?.trim() || null,
    };
    profiles.push(profile);
    return profile;
  },
  update_profile: (args) => {
    const input = args.input as ProfileInput;
    validate(input);
    const profile =
      profiles.find((p) => p.id === id("id", args)) ??
      fail("notFound", "connection profile not found");
    Object.assign(profile, {
      name: input.name.trim(),
      connectionString: input.connectionString.trim(),
      readOnly: input.readOnly,
      hasPassword: profile.hasPassword || input.password !== null,
      color: input.color ?? null,
      ssh: input.ssh ?? null,
      hasSshSecret: input.ssh != null && (profile.hasSshSecret || input.sshSecret != null),
      sshHostKey: input.ssh
        ? (input.sshHostKey ?? (profile.ssh?.host === input.ssh.host ? profile.sshHostKey : null))
        : null,
      group: input.group?.trim() || null,
    });
    return { ...profile };
  },
  export_connections: () => "/Users/ada/odin-db-connections.json",
  choose_connections_file: () => ({
    token: crypto.randomUUID(),
    name: "connections.json",
    needsPassphrase: false,
  }),
  import_connections: () => {
    const created = ["Staging", "Reporting replica"]
      .filter((name) => !profiles.some((p) => p.name === name))
      .map((name) => {
        const profile = {
          id: crypto.randomUUID(),
          name,
          connectionString: `mongodb://${name.toLowerCase().replace(/ /g, "-")}.example.com:27017`,
          readOnly: true,
          hasPassword: false,
          color: "blue" as const,
          ssh: null,
          hasSshSecret: false,
          sshHostKey: null,
          group: null,
        };
        profiles.push(profile);
        return { ...profile };
      });
    return { created, skipped: 2 - created.length };
  },
  duplicate_profile: (args) => {
    const source =
      profiles.find((p) => p.id === id("id", args)) ??
      fail("notFound", "connection profile not found");
    const copy = { ...source, id: crypto.randomUUID(), name: String(args.name) };
    profiles.push(copy);
    return { ...copy };
  },
  delete_profile: (args) => {
    const index = profiles.findIndex((p) => p.id === id("id", args));
    if (index >= 0) profiles.splice(index, 1);
    for (const [key, connection] of connections)
      if (connection.profileId === id("id", args)) connections.delete(key);
    return null;
  },
  test_connection: (args) => {
    const input = args.input as ProfileInput;
    if (input.connectionString.includes("unreachable")) {
      fail("network", "cannot reach the server: Server selection timeout: No available servers.");
    }
    validate(input);
    const saved = profiles.find((p) => p.id === args.profileId);
    if (input.ssh && !(input.sshHostKey ?? saved?.sshHostKey)) {
      fail(
        "unknownHostKey",
        `the SSH server's host key (${BASTION_KEY}) is not trusted yet`,
        BASTION_KEY,
      );
    }
    return { serverVersion: "8.0.4" };
  },
  trust_ssh_host_key: (args) => {
    const profile =
      profiles.find((p) => p.id === id("id", args)) ??
      fail("notFound", "connection profile not found");
    profile.sshHostKey = String(args.fingerprint);
    return null;
  },
  choose_ssh_key: () => "/Users/ada/.ssh/id_ed25519",
  connect: (args) => {
    const profileId = id("profileId", args);
    const existing = [...connections.values()].find((c) => c.profileId === profileId);
    if (existing) return existing;
    const profile =
      profiles.find((p) => p.id === profileId) ?? fail("notFound", "connection profile not found");
    if (profile.connectionString.includes("unreachable")) {
      fail("network", "cannot reach the server: Server selection timeout: No available servers.");
    }
    if (profile.ssh && profile.sshHostKey !== BASTION_KEY) {
      fail(
        profile.sshHostKey ? "hostKeyChanged" : "unknownHostKey",
        `the SSH server's host key (${BASTION_KEY}) is not trusted yet`,
        BASTION_KEY,
      );
    }
    const info: ConnectionInfo = {
      id: crypto.randomUUID(),
      profileId,
      serverVersion: "8.0.4",
      readOnly: profile.readOnly,
    };
    connections.set(info.id, info);
    return info;
  },
  disconnect: (args) => {
    connections.delete(id("connectionId", args));
    return null;
  },
  list_connections: () => [...connections.values()],
  list_databases: (args) =>
    Object.entries(serverOf(id("connectionId", args)).databases).map(
      ([name, colls]): DatabaseInfo => ({
        name,
        empty: Object.keys(colls).length === 0,
        sizeOnDisk: Object.values(colls).reduce(
          (sum, c) => sum + (c.count ?? c.docs.length) * 412,
          40_960,
        ),
      }),
    ),
  list_collections: (args) =>
    Object.entries(serverOf(id("connectionId", args)).databases[id("database", args)] ?? {})
      .map(([name, coll]): CollectionInfo => ({ name, kind: coll.kind }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  list_catalog: (args) =>
    Object.entries(serverOf(id("connectionId", args)).databases).map(([database, colls]) => ({
      database,
      collections: Object.entries(colls)
        .map(([name, coll]): CollectionInfo => ({ name, kind: coll.kind }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
  collection_counts: (args) => {
    const { databases } = serverOf(id("connectionId", args));
    const collections = databases[args.database as string] ?? {};
    // Like core: no counts for databases with more than 1,000 collections.
    if (Object.keys(collections).length > 1000) return [];
    return Object.entries(collections)
      .filter(([, coll]) => coll.kind !== "view")
      .map(([name, coll]) => ({ name, count: coll.count ?? coll.docs.length }));
  },
  collection_stats: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    const size = coll.docs.reduce((sum, doc) => sum + JSON.stringify(doc).length, 0);
    const indexes = indexesOf(coll).length;
    return {
      documents: coll.docs.length,
      size,
      averageDocumentSize: coll.docs.length ? size / coll.docs.length : 0,
      storageSize: Math.round(size * 0.4) + 4096,
      indexes,
      indexSize: indexes * 20_480,
    };
  },
  create_collection: (args) => {
    const { connection, databases } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    const ns = args.namespace as { database: string; collection: string };
    if (!ns.database || /[/\\. "$*<>:|?]/.test(ns.database))
      fail("validation", "invalid input: database names cannot contain spaces");
    if (!ns.collection || ns.collection.startsWith("system."))
      fail("validation", "invalid input: enter a collection name");
    if (databases[ns.database]?.[ns.collection])
      fail("validation", `invalid input: ${ns.collection} already exists in ${ns.database}`);
    const kind = (args.options as CollectionOptions | null)?.kind ?? { kind: "standard" };
    if (kind.kind === "timeSeries" && !kind.timeField.trim())
      fail("validation", "invalid input: a time series collection needs a time field");
    if (kind.kind === "capped" && !(kind.sizeBytes && kind.sizeBytes >= 1))
      fail("validation", "invalid input: a capped collection needs a size");
    databases[ns.database] ??= {};
    const db = databases[ns.database] as Record<string, { kind: string; docs: Doc[] }>;
    let docs: Doc[] = [];
    if (kind.kind === "view") {
      const source = db[kind.source] ?? fail("notFound", `${kind.source} not found`);
      // Computed once; a real view follows its source.
      docs = aggregate(source.docs, kind.pipeline as Doc[]);
    }
    db[ns.collection] = {
      kind:
        kind.kind === "view" ? "view" : kind.kind === "timeSeries" ? "timeseries" : "collection",
      docs,
    };
    return null;
  },
  rename_collection: (args) => {
    const { connection, databases } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    const ns = args.namespace as { database: string; collection: string };
    const newName = args.newName as string;
    const db = databases[ns.database] ?? fail("notFound", "database not found");
    if (db[newName]) fail("database", `target namespace exists: ${ns.database}.${newName}`);
    db[newName] = db[ns.collection] ?? fail("notFound", "collection not found");
    delete db[ns.collection];
    return null;
  },
  drop_collection: (args) => {
    const { connection, databases } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    const ns = args.namespace as { database: string; collection: string };
    delete databases[ns.database]?.[ns.collection];
    return null;
  },
  drop_database: (args) => {
    const { connection, databases } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    const database = id("database", args);
    if (["admin", "local", "config"].includes(database))
      fail(
        "validation",
        `invalid input: ${database} is a system database and cannot be dropped here`,
      );
    delete databases[database];
    return null;
  },
  aggregate_documents: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const request = args.request as { pipeline: Doc[]; batchSize: number };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    if (request.pipeline.some((s) => "$out" in s || "$merge" in s)) ensureWritable(connection);
    const cursorId = crypto.randomUUID();
    cursors.set(cursorId, { docs: aggregate(coll.docs, request.pipeline), offset: 0 });
    return page(cursorId, request.batchSize);
  },
  preview_aggregation: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const pipeline = args.pipeline as Doc[];
    if (pipeline.some((s) => "$out" in s || "$merge" in s)) {
      fail("validation", "invalid input: pipelines with $out or $merge cannot be previewed");
    }
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    return aggregate(coll.docs, pipeline).slice(0, args.limit as number);
  },
  list_indexes: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    return indexesOf(coll).map((spec, position) => ({
      name: spec.name,
      keys: spec.key,
      unique: spec.unique === true,
      sparse: spec.sparse === true,
      hidden: spec.hidden === true,
      expireAfterSeconds:
        spec.expireAfterSeconds === undefined ? null : Number(scalar(spec.expireAfterSeconds)),
      partialFilter: spec.partialFilterExpression ?? null,
      collation: spec.collation ?? null,
      definition: spec,
      size: 20_480 + coll.docs.length * (position === 0 ? 24 : 40),
      usageCount: position === 0 ? 1532 : position === 1 ? 87 : 0,
      usageSince: "2026-10-01T08:00:00Z",
    }));
  },
  create_index: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const request = args.request as {
      keys: Doc;
      name: string | null;
      unique: boolean;
      sparse: boolean;
      hidden: boolean;
      expireAfterSeconds: number | null;
      partialFilter: Doc | null;
      collation?: Doc | null;
    };
    const { connection, coll } = collectionOf(
      id("connectionId", args),
      ns.database,
      ns.collection,
      {
        create: true,
      },
    );
    ensureWritable(connection);
    const name =
      request.name ??
      Object.entries(request.keys)
        .map(([k, v]) => `${k}_${String(scalar(v))}`)
        .join("_");
    if (indexesOf(coll).some((spec) => spec.name === name)) {
      fail("database", `An existing index has the same name as the requested index: ${name}`);
    }
    const spec: Doc = { v: num(2), key: request.keys, name };
    if (request.unique) spec.unique = true;
    if (request.sparse) spec.sparse = true;
    if (request.hidden) spec.hidden = true;
    if (request.expireAfterSeconds !== null)
      spec.expireAfterSeconds = num(request.expireAfterSeconds);
    if (request.partialFilter) spec.partialFilterExpression = request.partialFilter;
    if (request.collation) {
      if (typeof request.collation.locale !== "string")
        fail("validation", "collation: missing field `locale`");
      spec.collation = request.collation;
    }
    indexesOf(coll).push(spec);
    indexBuilds.push({ key: `${ns.database}.${ns.collection}`, name, startedAt: Date.now() });
    return name;
  },
  index_builds: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const now = Date.now();
    // A build "takes" a few seconds, long enough to see its progress.
    return indexBuilds
      .filter((build) => build.key === `${ns.database}.${ns.collection}`)
      .filter((build) => now - build.startedAt < MOCK_BUILD_MS)
      .map((build) => ({
        names: [build.name],
        phase: "Index Build: scanning collection",
        done: Math.round(((now - build.startedAt) / MOCK_BUILD_MS) * 1000),
        total: 1000,
        seconds: Math.round((now - build.startedAt) / 1000),
      }));
  },
  get_validation: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    return coll.validation ?? { validator: {}, level: "strict", action: "error" };
  },
  set_validation: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    coll.validation = args.rules as NonNullable<typeof coll.validation>;
    return null;
  },
  set_index_hidden: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    const spec =
      indexesOf(coll).find((candidate) => candidate.name === args.name) ??
      fail("database", `index not found with name [${String(args.name)}]`);
    if (args.hidden) spec.hidden = true;
    else delete spec.hidden;
    return null;
  },
  drop_index: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    if (args.name === "_id_") fail("validation", "invalid input: the _id index cannot be dropped");
    coll.indexes = indexesOf(coll).filter((spec) => spec.name !== args.name);
    return null;
  },
  cancel_operation: (args) => {
    const operation = operations.get(id("id", args));
    if (operation) operation.cancelled = true;
    return operation !== undefined;
  },
  export_documents: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    const total = coll.docs.length;
    return simulateTransfer(args.channel, total, { documents: total, bytes: total * 412 }, 412);
  },
  import_file_from_drop: (args) => {
    const dropped = droppedFiles.get(id("token", args));
    if (!dropped || dropped.directory || !/\.(json|ndjson|jsonl|csv)$/i.test(dropped.name))
      return fail("validation", "not a JSON, NDJSON or CSV file");
    const chosen = (handlers.choose_import_file as () => { name: string })();
    return { ...chosen, name: dropped.name };
  },
  choose_certificate_file: () => "/Users/ada/certs/company-ca.pem",
  choose_import_file: () => {
    const headers = ["email", "name", "age", "joined", "city"];
    const rows = Array.from({ length: 120 }, (_, i) => [
      i === 7 ? "not-an-email" : `customer.${i}@example.com`,
      `Customer ${i}`,
      i === 42 ? "unknown" : String(20 + (i % 50)),
      `2025-0${(i % 9) + 1}-15T09:30:00Z`,
      cities[i % cities.length] ?? "Milano",
    ]);
    const token = crypto.randomUUID();
    importFiles.set(token, { rows, headers });
    return {
      token,
      name: "customers.csv",
      preview: {
        kind: "csv",
        headers,
        rows: rows.slice(0, 20),
        suggested: ["string", "string", "int32", "date", "string"],
      },
    };
  },
  import_documents: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(
      id("connectionId", args),
      ns.database,
      ns.collection,
      {
        create: true,
      },
    );
    ensureWritable(connection);
    const file = importFiles.get(id("token", args)) ?? fail("notFound", "import file not found");
    importFiles.delete(id("token", args));
    const options = args.options as {
      format: { kind: string; columns?: { header: string; field: string; kind: string }[] };
      dropFirst?: boolean;
    };
    if (options.dropFirst) coll.docs = [];
    const errors: { record: number; message: string }[] = [];
    let inserted = 0;
    file.rows.forEach((row, index) => {
      const doc: Doc = { _id: oid() };
      for (const column of options.format.columns ?? []) {
        if (column.kind === "skip") continue;
        const cell = row[file.headers.indexOf(column.header)] ?? "";
        if (column.kind === "int32" && !/^-?\d+$/.test(cell)) {
          errors.push({
            record: index + 1,
            message: `${column.header}: "${cell}" is not a 32-bit integer`,
          });
          return;
        }
        doc[column.field] =
          column.kind === "int32"
            ? { $numberInt: cell }
            : column.kind === "date"
              ? { $date: { $numberLong: String(Date.parse(cell)) } }
              : cell;
      }
      coll.docs.push(doc);
      inserted += 1;
    });
    return simulateTransfer(
      args.channel,
      file.rows.length,
      { inserted, failed: errors.length, errors, stopped: false },
      80,
    );
  },
  export_database: (args) => {
    const { databases } = serverOf(id("connectionId", args));
    const database = args.database as string;
    const request = args.request as { collections: string[] };
    const names = Object.entries(databases[database] ?? {})
      .filter(([name, coll]) => coll.kind !== "view" && !name.startsWith("system."))
      .map(([name]) => name)
      .filter((name) => request.collections.length === 0 || request.collections.includes(name));
    const documents = names.reduce(
      (sum, name) => sum + (databases[database]?.[name]?.docs.length ?? 0),
      0,
    );
    return simulateTransfer(
      args.channel,
      names.length,
      { collections: names.length, documents, updated: 0, failed: 0, errors: [] },
      0,
      (done) => ({
        collection: names[Math.max(0, done - 1)] ?? "",
        index: done,
        total: names.length,
        documents: Math.round(documents / Math.max(1, names.length)),
      }),
    );
  },
  copy_data: (args) => {
    const source = serverOf(id("sourceConnectionId", args));
    const target = serverOf(id("targetConnectionId", args));
    ensureWritable(target.connection);
    const request = args.request as {
      sourceDatabase: string;
      sourceCollection: string | null;
      targetDatabase: string;
      targetCollection: string | null;
      dropTarget: boolean;
    };
    const names = request.sourceCollection
      ? [request.sourceCollection]
      : Object.keys(source.databases[request.sourceDatabase] ?? {}).filter(
          (name) => !name.startsWith("system."),
        );
    const jobs = names.map((name) => ({
      from: name,
      to: request.sourceCollection ? (request.targetCollection ?? name) : name,
    }));
    if (
      source.connection === target.connection &&
      request.sourceDatabase === request.targetDatabase &&
      jobs.some((job) => job.from === job.to)
    ) {
      fail("validation", "invalid input: choose another database or name");
    }
    target.databases[request.targetDatabase] ??= {};
    const targetDb = target.databases[request.targetDatabase];
    let documents = 0;
    for (const job of jobs) {
      const from = source.databases[request.sourceDatabase]?.[job.from];
      if (!from || !targetDb) continue;
      if (request.dropTarget || !targetDb[job.to]) {
        targetDb[job.to] = { ...from, docs: [] };
      }
      const into = targetDb[job.to];
      if (!into) continue;
      into.docs.push(...from.docs.map((doc) => structuredClone(doc)));
      documents += from.docs.length;
    }
    return simulateTransfer(
      args.channel,
      jobs.length,
      { collections: jobs.length, documents, updated: 0, failed: 0, errors: [] },
      0,
      (done) => ({
        collection: jobs[Math.max(0, done - 1)]?.to ?? "",
        index: done,
        total: jobs.length,
        documents: Math.round(documents / Math.max(1, jobs.length)),
      }),
    );
  },
  import_folder_from_drop: (args) => {
    const dropped = droppedFiles.get(id("token", args));
    if (!dropped?.directory) return fail("validation", "drop a folder of JSON files");
    const token = crypto.randomUUID();
    importFolders.add(token);
    return {
      token,
      path: `/Users/ada/Drops/${dropped.name}`,
      collections: ["coupons", "suppliers"],
    };
  },
  choose_import_folder: () => {
    const token = crypto.randomUUID();
    importFolders.add(token);
    return { token, path: "/Users/ada/Exports/shop", collections: ["coupons", "suppliers"] };
  },
  import_database: (args) => {
    const connectionId = id("connectionId", args);
    const database = args.database as string;
    const { connection } = serverOf(connectionId);
    ensureWritable(connection);
    if (!importFolders.delete(id("token", args))) fail("notFound", "import folder not found");
    const options = args.options as { dropFirst?: boolean };
    const names = ["coupons", "suppliers"];
    for (const name of names) {
      const { coll } = collectionOf(connectionId, database, name, { create: true });
      if (options.dropFirst) coll.docs = [];
      for (let i = 0; i < 25; i += 1) coll.docs.push({ _id: oid(), name: `${name} ${i}` });
    }
    return simulateTransfer(
      args.channel,
      names.length,
      { collections: names.length, documents: 50, updated: 0, failed: 0, errors: [] },
      0,
      (done) => ({
        collection: names[Math.max(0, done - 1)] ?? "",
        index: done,
        total: names.length,
        documents: 25,
      }),
    );
  },
  database_tools_status: () =>
    toolsInstalled()
      ? { available: true, version: "100.19.1" }
      : { available: false, version: null },
  backup_database: (args) => {
    if (!toolsInstalled())
      fail("notFound", "MongoDB Database Tools (mongodump and mongorestore) not found");
    const { databases } = serverOf(id("connectionId", args));
    const request = args.request as {
      scope: { kind: string; database?: string; collection?: string };
      excludeCollections?: string[];
    };
    const scope = request.scope;
    const excluded = new Set(request.excludeCollections ?? []);
    const targets = Object.entries(databases).flatMap(([db, colls]) =>
      Object.entries(colls)
        .filter(
          ([name]) =>
            !name.startsWith("system.") &&
            !excluded.has(name) &&
            (!scope.database || scope.database === db) &&
            (!scope.collection || scope.collection === name),
        )
        .map(([name, coll]) => ({ ns: `${db}.${name}`, count: coll.docs.length })),
    );
    const lines = targets.flatMap((t) => [
      `writing \`${t.ns}\` to "archive"`,
      `done dumping \`${t.ns}\` (${t.count} documents)`,
    ]);
    const documents = targets.reduce((sum, t) => sum + t.count, 0);
    return simulateTool(args.channel, lines, {
      collections: targets.length,
      documents,
      failures: 0,
    });
  },
  // Copies, like a real backend: handing out the mutated arrays hides changes from caching.
  list_backup_runs: () => backupRuns.map((run) => ({ ...run })),
  list_backup_schedules: () => backupSchedules.map((schedule) => ({ ...schedule })),
  choose_backup_folder: () => ({ token: crypto.randomUUID(), path: "/Users/ada/Backups" }),
  save_backup_schedule: (args) => {
    const input = args.input as Record<string, unknown> & { enabled: boolean };
    const existing = backupSchedules.find((s) => s.id === args.id);
    if (!existing && !args.folderToken)
      fail("validation", "invalid input: choose a folder for the backups");
    const schedule: MockSchedule =
      existing ??
      ({
        id: crypto.randomUUID(),
        enabled: input.enabled,
        folder: "/Users/ada/Backups",
        createdAt: Date.now(),
        lastRunAt: null,
      } satisfies MockSchedule);
    Object.assign(schedule, input, { nextRunAt: input.enabled ? Date.now() + 6 * hour : null });
    if (!existing) backupSchedules.push(schedule);
    backupsChanged();
    return schedule;
  },
  delete_backup_schedule: (args) => {
    const index = backupSchedules.findIndex((s) => s.id === args.id);
    if (index >= 0) backupSchedules.splice(index, 1);
    return null;
  },
  run_backup_schedule_now: (args) => {
    const schedule =
      backupSchedules.find((s) => s.id === args.id) ??
      fail("notFound", "backup schedule not found");
    simulateScheduledRun(schedule);
    return null;
  },
  delete_backup_run: (args) => {
    const index = backupRuns.findIndex((r) => r.id === args.id);
    if (index >= 0) backupRuns.splice(index, 1);
    return null;
  },
  reveal_backup: () => null,
  restore_source_from_backup: (args) => {
    const run = backupRuns.find((r) => r.id === args.id) ?? fail("notFound", "backup not found");
    return { token: crypto.randomUUID(), name: String(run.archive).split("/").at(-1) };
  },
  restore_contents: (args) => {
    const { databases } = serverOf(id("connectionId", args));
    return Object.entries(databases).flatMap(([db, colls]) =>
      Object.keys(colls)
        .filter((name) => !name.startsWith("system.") && db !== "admin")
        .map((name) => `${db}.${name}`),
    );
  },
  choose_restore_source: (args) => {
    const token = crypto.randomUUID();
    return { token, name: args.source === "directory" ? "dump" : "shop.archive.gz" };
  },
  restore_database: (args) => {
    if (!toolsInstalled())
      fail("notFound", "MongoDB Database Tools (mongodump and mongorestore) not found");
    const { connection } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    const request = args.request as {
      database: string | null;
      renameTo: string | null;
      drop: boolean;
    };
    const db = request.renameTo ?? request.database ?? "shop";
    const lines = [
      "preparing collections to restore from",
      ...(request.drop ? [`dropping collection \`${db}.users\` before restoring`] : []),
      `finished restoring \`${db}.users\` (1240 documents, 0 failures)`,
      `finished restoring \`${db}.orders\` (350 documents, 0 failures)`,
      "1590 document(s) restored successfully. 0 document(s) failed to restore.",
    ];
    return simulateTool(args.channel, lines, { collections: 2, documents: 1590, failures: 0 });
  },
  mongosh_status: () =>
    localStorage.getItem("odin-mock-no-mongosh") === "1"
      ? { available: false, version: null, downloadVersion: "2.13.0" }
      : { available: true, version: "2.13.0", downloadVersion: "2.13.0" },
  download_mongosh: (args) => {
    const send = channelSender(args.channel);
    const operationId = crypto.randomUUID();
    const operation = { cancelled: false };
    operations.set(operationId, operation);
    const total = 72_400_000;
    let received = 0;
    const tick = () => {
      if (operation.cancelled) {
        send({ event: "cancelled" });
        operations.delete(operationId);
        return;
      }
      received = Math.min(total, received + total / 12);
      send({ event: "data", data: { received, total } });
      if (received < total) {
        setTimeout(tick, 200);
        return;
      }
      // `odin-mock-download-fails` simulates a checksum mismatch.
      if (localStorage.getItem("odin-mock-download-fails") === "1") {
        send({
          event: "failed",
          data: {
            kind: "integrity",
            message:
              "the downloaded mongosh does not match its published checksum, so it was not installed; try again",
          },
        });
      } else {
        localStorage.removeItem("odin-mock-no-mongosh");
        send({ event: "completed" });
      }
      operations.delete(operationId);
    };
    setTimeout(tick, 200);
    return operationId;
  },
  open_shell: (args) => {
    serverOf(id("connectionId", args));
    const shellId = crypto.randomUUID();
    shells.set(shellId, { send: channelSender(args.channel), line: "" });
    setTimeout(() => shellOutput(shellId, PROMPT), 300);
    return shellId;
  },
  shell_write: (args) => {
    const shellId = id("id", args);
    const session = shells.get(shellId) ?? fail("notFound", "shell session not found");
    for (const char of args.data as string) {
      if (char === "\r") {
        const line = session.line;
        session.line = "";
        shellOutput(shellId, "\r\n");
        evaluateShell(shellId, line);
      } else if (char === "\u007f") {
        if (session.line.length > 0) {
          session.line = session.line.slice(0, -1);
          shellOutput(shellId, "\b \b");
        }
      } else {
        session.line += char;
        shellOutput(shellId, char);
      }
    }
    return null;
  },
  shell_resize: () => null,
  shell_ack: () => null,
  close_shell: (args) => {
    shells.delete(id("id", args));
    return null;
  },
  explain_aggregate: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const pipeline = args.pipeline as Doc[];
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    if (pipeline.some((stage) => "$out" in stage || "$merge" in stage))
      return fail("validation", "invalid input: pipelines with $out or $merge cannot be explained");
    const output = aggregate(coll.docs, pipeline);
    const operators = pipeline.map((stage) => Object.keys(stage)[0] ?? "?");
    // The leading $match runs in the query; the rest on its output.
    const later = operators[0] === "$match" ? operators.slice(1) : operators;
    const queried =
      operators[0] === "$match" ? aggregate(coll.docs, pipeline.slice(0, 1)) : coll.docs;
    return {
      stages: ["COLLSCAN"],
      indexes: [],
      collectionScan: true,
      returned: queried.length,
      documentsExamined: coll.docs.length,
      keysExamined: 0,
      milliseconds: 4,
      plansConsidered: 1,
      steps: [
        {
          stage: "COLLSCAN",
          depth: 0,
          returned: coll.docs.length,
          milliseconds: 2,
          documentsExamined: coll.docs.length,
          keysExamined: null,
          indexName: null,
          keyPattern: null,
        },
      ],
      pipeline: later.map((stage, index) => ({
        stage,
        depth: 0,
        returned: index === later.length - 1 ? output.length : null,
        milliseconds: 3 + index,
        documentsExamined: null,
        keysExamined: null,
        indexName: null,
        keyPattern: null,
      })),
      raw: { stages: pipeline },
    };
  },
  explain_find: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const request = args.request as { filter: Doc };
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    const matched = coll.docs.filter((doc) => matchesFilter(doc, request.filter)).length;
    const fields = Object.keys(request.filter);
    const index = indexesOf(coll).find(
      (spec) => fields.length > 0 && Object.keys((spec.key as Doc) ?? {})[0] === fields[0],
    );
    const stages = index ? ["IXSCAN", "FETCH"] : ["COLLSCAN"];
    return {
      stages,
      indexes: index ? [index.name as string] : [],
      collectionScan: !index,
      returned: matched,
      documentsExamined: index ? matched : coll.docs.length,
      keysExamined: index ? matched : 0,
      milliseconds: 3,
      plansConsidered: index ? 2 : 1,
      steps: index
        ? [
            {
              stage: "FETCH",
              depth: 0,
              returned: matched,
              milliseconds: 2,
              documentsExamined: matched,
              keysExamined: null,
              indexName: null,
              keyPattern: null,
            },
            {
              stage: "IXSCAN",
              depth: 1,
              returned: matched,
              milliseconds: 1,
              documentsExamined: null,
              keysExamined: matched,
              indexName: index.name as string,
              keyPattern: index.key as Doc,
            },
          ]
        : [
            {
              stage: "COLLSCAN",
              depth: 0,
              returned: matched,
              milliseconds: 3,
              documentsExamined: coll.docs.length,
              keysExamined: null,
              indexName: null,
              keyPattern: null,
            },
          ],
      raw: {
        queryPlanner: {
          winningPlan: index
            ? { stage: "FETCH", inputStage: { stage: "IXSCAN", indexName: index.name as string } }
            : { stage: "COLLSCAN" },
        },
        executionStats: { nReturned: { $numberInt: String(matched) } },
      },
    };
  },
  sample_fields: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    const filter = args.filter as Doc | null;
    const docs = filter ? coll.docs.filter((doc) => matchesFilter(doc, filter)) : coll.docs;
    return fieldPathsOf(docs.slice(0, args.size as number));
  },
  find_documents: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const request = args.request as FindRequest;
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    if (request.options?.maxTimeMs === 1)
      return fail(
        "timeLimit",
        "the server stopped it at its time limit: Executor error during find command :: caused by :: operation exceeded time limit",
      );
    const caseless = ignoresCase(request.options);
    let docs = coll.docs.filter((doc) => matchesFilter(doc, request.filter as Doc, caseless));
    if (request.sort) docs = sortDocs(docs, request.sort as Doc);
    docs = docs.slice(
      request.skip ?? 0,
      request.limit ? (request.skip ?? 0) + request.limit : undefined,
    );
    const cursorId = crypto.randomUUID();
    cursors.set(cursorId, {
      docs: docs.map((doc) => project(doc, request.projection as Doc | null)),
      offset: 0,
    });
    return page(cursorId, request.batchSize);
  },
  fetch_more_documents: (args) => page(id("cursorId", args), args.batchSize as number),
  close_cursor: (args) => {
    cursors.delete(id("cursorId", args));
    return null;
  },
  count_documents: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    const caseless = ignoresCase((args.options as QueryOptions | null | undefined) ?? undefined);
    return coll.docs.filter((doc) => matchesFilter(doc, args.filter as Doc, caseless)).length;
  },
  insert_document: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(
      id("connectionId", args),
      ns.database,
      ns.collection,
      {
        create: true,
      },
    );
    ensureWritable(connection);
    const document = { ...(args.document as Doc) };
    if (document._id === undefined) document._id = oid();
    if (coll.docs.some((d) => JSON.stringify(d._id) === JSON.stringify(document._id))) {
      fail("database", "E11000 duplicate key error collection: _id_ dup key");
    }
    coll.docs.unshift(document);
    return document._id;
  },
  set_document_field: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    const field = args.field as string;
    if (field === "_id" || field.includes(".") || field.startsWith("$"))
      fail(
        "validation",
        `invalid input: ${field} cannot be edited on its own; edit the whole document instead`,
      );
    const doc =
      coll.docs.find((d) => JSON.stringify(d._id) === JSON.stringify(args.id)) ??
      fail("notFound", "document not found");
    doc[field] = args.value as JsonValue;
    return null;
  },
  unset_document_field: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    const doc =
      coll.docs.find((d) => JSON.stringify(d._id) === JSON.stringify(args.id)) ??
      fail("notFound", "document not found");
    delete doc[args.field as string];
    return null;
  },
  replace_document: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    const index = coll.docs.findIndex((d) => JSON.stringify(d._id) === JSON.stringify(args.id));
    if (index < 0) fail("notFound", "document not found");
    coll.docs[index] = { _id: args.id as JsonValue, ...(args.document as Doc) };
    return null;
  },
  delete_document: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    const index = coll.docs.findIndex((d) => JSON.stringify(d._id) === JSON.stringify(args.id));
    if (index < 0) fail("notFound", "document not found");
    coll.docs.splice(index, 1);
    return null;
  },
  list_users: (args) => {
    serverOf(id("connectionId", args));
    return mockUsers.map((user) => ({ ...user, roles: [...user.roles] }));
  },
  list_roles: (args) => [
    ...["read", "readWrite", "dbAdmin", "dbOwner", "userAdmin", "readAnyDatabase", "root"].map(
      (role) => ({ role, db: String(args.database), builtIn: true }),
    ),
    ...mockRoles
      .filter((role) => role.db === args.database)
      .map((role) => ({ role: role.role, db: role.db, builtIn: false })),
  ],
  list_custom_roles: (args) => {
    serverOf(id("connectionId", args));
    return structuredClone(mockRoles);
  },
  create_role: (args) => {
    const { connection } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    const name = String(args.name).trim();
    if (!name) fail("validation", "enter a role name");
    if (mockRoles.some((r) => r.role === name && r.db === args.database))
      fail("database", `Role "${name}@${String(args.database)}" already exists`);
    const privileges = args.privileges as MockPrivilege[];
    if (privileges.some((p) => p.actions.every((a) => !a.trim())))
      fail("validation", "every privilege needs at least one action");
    mockRoles.push({
      role: name,
      db: String(args.database),
      privileges,
      roles: args.roles as { role: string; db: string }[],
    });
    return null;
  },
  update_role: (args) => {
    const { connection } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    const role =
      mockRoles.find((r) => r.role === args.name && r.db === args.database) ??
      fail("database", `Role "${String(args.name)}" not found`);
    const privileges = args.privileges as MockPrivilege[];
    if (privileges.some((p) => p.actions.every((a) => !a.trim())))
      fail("validation", "every privilege needs at least one action");
    role.privileges = privileges;
    role.roles = args.roles as { role: string; db: string }[];
    return null;
  },
  drop_role: (args) => {
    const { connection } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    const index = mockRoles.findIndex((r) => r.role === args.name && r.db === args.database);
    if (index >= 0) mockRoles.splice(index, 1);
    return null;
  },
  create_user: (args) => {
    const { connection } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    const name = String(args.name).trim();
    if (mockUsers.some((u) => u.user === name && u.db === args.database))
      fail("database", `User "${name}@${String(args.database)}" already exists`);
    mockUsers.push({
      user: name,
      db: String(args.database),
      roles: args.roles as { role: string; db: string }[],
      mechanisms: ["SCRAM-SHA-256"],
    });
    return null;
  },
  set_user_roles: (args) => {
    const { connection } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    const user = mockUsers.find((u) => u.user === args.name && u.db === args.database);
    if (user) user.roles = args.roles as { role: string; db: string }[];
    return null;
  },
  change_user_password: (args) => {
    const { connection } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    return null;
  },
  drop_user: (args) => {
    const { connection } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    const index = mockUsers.findIndex((u) => u.user === args.name && u.db === args.database);
    if (index >= 0) mockUsers.splice(index, 1);
    return null;
  },
  sharding_status: (args) => {
    const connection =
      connections.get(id("connectionId", args)) ?? fail("notConnected", "connection is not open");
    const profile = profiles.find((p) => p.id === connection.profileId);
    // The tenants cluster plays a sharded cluster; the other profiles are replica sets.
    if (!profile?.connectionString.includes("tenants")) return null;
    return {
      shards: [
        { id: "shard01", host: "shard01/tenants-a1:27018,tenants-a2:27018", draining: false },
        { id: "shard02", host: "shard02/tenants-b1:27018,tenants-b2:27018", draining: false },
        { id: "shard03", host: "shard03/tenants-c1:27018", draining: true },
      ],
      balancerMode: "full",
      balancerRunning: false,
      collections: [
        {
          namespace: "tenant_0001.events",
          key: { tenantId: { $numberInt: "1" }, at: { $numberInt: "1" } },
          unique: false,
        },
        { namespace: "tenant_0001.users", key: { _id: "hashed" }, unique: false },
      ],
    };
  },
  collection_activity: (args) => {
    if (serverOf(id("connectionId", args)).databases === servers.large) return null;
    // Counters that grow with time at different paces, so two samples give believable rates.
    const t = Date.now() / 1000;
    const entry = (namespace: string, msPerSecond: number, reads: number, writes: number) => ({
      namespace,
      totalMicros: Math.round(t * msPerSecond * 1000),
      totalCount: Math.round(t * (reads + writes)),
      readMicros: Math.round(t * msPerSecond * 700),
      readCount: Math.round(t * reads),
      writeMicros: Math.round(t * msPerSecond * 300),
      writeCount: Math.round(t * writes),
    });
    return [
      entry("shop.orders", 42, 120, 18),
      entry("analytics.events", 31, 40, 95),
      entry("shop.users", 12, 60, 2),
      entry("shop.products", 3, 25, 0),
    ];
  },
  replica_set_status: (args) => {
    if (serverOf(id("connectionId", args)).databases === servers.large) return null;
    const uptime = Math.round(Date.now() / 1000) % 1_000_000;
    return {
      set: "rs0",
      members: [
        {
          name: "localhost:27017",
          state: "PRIMARY",
          healthy: true,
          isSelf: true,
          uptimeSeconds: uptime,
          pingMs: null,
          lagSeconds: 0,
          syncSource: null,
          message: null,
        },
        {
          name: "localhost:27018",
          state: "SECONDARY",
          healthy: true,
          isSelf: false,
          uptimeSeconds: uptime - 40,
          pingMs: 2,
          lagSeconds: 14,
          syncSource: "localhost:27017",
          message: null,
        },
        {
          name: "localhost:27019",
          state: "(not reachable/healthy)",
          healthy: false,
          isSelf: false,
          uptimeSeconds: 0,
          pingMs: null,
          lagSeconds: null,
          syncSource: null,
          message: "Error connecting to localhost:27019 :: caused by :: Connection refused",
        },
      ],
    } satisfies ReplicaSetStatus;
  },
  server_status: (args) => {
    const sharded = serverOf(id("connectionId", args)).databases === servers.large;
    const now = Date.now();
    // Counters grow with time, so consecutive samples give believable rates.
    const t = now / 1000;
    return {
      host: "localhost:27017",
      version: "8.0.4",
      process: sharded ? "mongos" : "mongod",
      uptimeSeconds: Math.floor(t % 864000),
      connectionsCurrent: 12 + Math.round(Math.sin(t / 7) * 3),
      connectionsAvailable: 838848,
      opcounters: {
        insert: Math.floor(t * 40),
        query: Math.floor(t * 120 + Math.sin(t) * 30),
        update: Math.floor(t * 25),
        delete: Math.floor(t * 4),
        getmore: Math.floor(t * 10),
        command: Math.floor(t * 300),
      },
      residentMb: 512,
      virtualMb: 2048,
      networkBytesIn: Math.floor(t * 80_000),
      networkBytesOut: Math.floor(t * 240_000 + Math.sin(t) * 50_000),
      sampledAt: now,
    };
  },
  current_ops: (args) => {
    serverOf(id("connectionId", args));
    return mockOps.map((op) => ({
      ...op,
      secsRunning: Math.floor((Date.now() - op.startedAt) / 1000),
    }));
  },
  profiling_status: (args) => {
    serverOf(id("connectionId", args));
    return mockProfiling.get(String(args.database)) ?? { level: "off", slowMs: 100 };
  },
  set_profiling_status: (args) => {
    const { connection } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    mockProfiling.set(String(args.database), args.status as { level: string; slowMs: number });
    return null;
  },
  profile_entries: (args) => {
    serverOf(id("connectionId", args));
    const { database } = args.query as { database: string };
    if ((mockProfiling.get(database)?.level ?? "off") === "off") return [];
    const now = Date.now();
    return [
      {
        at: now - 4_000,
        op: "query",
        ns: `${database}.users`,
        millis: 412,
        docsExamined: 120_000,
        keysExamined: 0,
        returned: 3,
        planSummary: "COLLSCAN",
        appName: "orders-api",
        command: { find: "users", filter: { email: "ada@example.com" } },
      },
      {
        at: now - 9_000,
        op: "update",
        ns: `${database}.orders`,
        millis: 130,
        docsExamined: 1,
        keysExamined: 1,
        returned: null,
        planSummary: "IXSCAN { _id: 1 }",
        appName: null,
        command: { q: { _id: { $numberInt: "7" } }, u: { $set: { paid: true } } },
      },
    ];
  },
  kill_op: (args) => {
    const { connection } = serverOf(id("connectionId", args));
    ensureWritable(connection);
    const index = mockOps.findIndex((op) => op.opid === args.opid);
    if (index >= 0) mockOps.splice(index, 1);
    return null;
  },
  distinct_values: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    const counts = new Map<string, { value: JsonValue; count: number }>();
    for (const doc of coll.docs.filter((d) => matchesFilter(d, args.filter as Doc))) {
      const raw = fieldValue(doc, args.field as string);
      const values = Array.isArray(raw) ? (raw.length ? raw : [null]) : [raw ?? null];
      for (const value of values) {
        const key = JSON.stringify(value);
        const entry = counts.get(key) ?? { value, count: 0 };
        entry.count += 1;
        counts.set(key, entry);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, args.limit as number);
  },
  update_documents: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    const update = args.update as Record<string, Doc>;
    if (Object.keys(update).length === 0 || !Object.keys(update).every((k) => k.startsWith("$")))
      fail(
        "validation",
        "invalid input: an update needs operators such as { $set: { field: value } }",
      );
    const matched = coll.docs.filter((doc) => matchesFilter(doc, args.filter as Doc));
    const originals = matched.length <= 1000 ? structuredClone(matched) : null;
    for (const doc of matched) {
      Object.assign(doc, update.$set ?? {});
      for (const field of Object.keys(update.$unset ?? {})) delete doc[field];
    }
    return { matched: matched.length, modified: matched.length, originals };
  },
  change_field: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    const field = args.field as string;
    const change = args.change as FieldChange;
    if (field === "_id") fail("validation", "invalid input: _id cannot be changed");
    if (change.kind === "rename" && (!change.to.trim() || change.to.trim() === field))
      fail("validation", `invalid input: ${field} is already called ${change.to}`);
    // Top-level fields only, and the simplest conversions: enough for the dialogs.
    const convert = (value: JsonValue, to: ConvertTarget): JsonValue | undefined => {
      const plain = scalarOf(value);
      if (to === "string") return typeof plain === "string" ? undefined : String(plain);
      const number = Number(plain);
      if (to === "bool") return typeof plain === "boolean" ? undefined : Boolean(plain);
      if (Number.isNaN(number) || typeof plain === "boolean") return value;
      if (to === "int" && Number.isInteger(number)) return { $numberInt: String(number) };
      if (to === "double") return { $numberDouble: String(number) };
      return value;
    };
    let matched = 0;
    let modified = 0;
    const concerned = coll.docs.filter(
      (d) => matchesFilter(d, args.filter as Doc) && d[field] !== undefined,
    );
    const originals = concerned.length <= 1000 ? structuredClone(concerned) : null;
    for (const doc of concerned) {
      const value = doc[field];
      if (value === undefined) continue;
      if (change.kind === "convert") {
        const next = convert(value, change.to);
        if (next === undefined) continue;
        matched += 1;
        if (next === value) continue;
        doc[field] = next;
      } else {
        matched += 1;
        if (change.kind === "rename") doc[change.to.trim()] = value;
        delete doc[field];
      }
      modified += 1;
    }
    return { matched, modified, originals };
  },
  restore_documents: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    let restored = 0;
    for (const original of args.originals as Doc[]) {
      const key = JSON.stringify(original._id);
      const index = coll.docs.findIndex((doc) => JSON.stringify(doc._id) === key);
      if (index < 0) continue;
      coll.docs[index] = structuredClone(original);
      restored += 1;
    }
    return restored;
  },
  delete_documents: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    const before = coll.docs.length;
    coll.docs = coll.docs.filter((doc) => !matchesFilter(doc, args.filter as Doc));
    return before - coll.docs.length;
  },
};

export function installMockBackend() {
  // `localStorage["odin-mock-empty"] = "1"` shows the first-run state.
  if (localStorage.getItem("odin-mock-empty") === "1") profiles.splice(0);
  // `localStorage["odin-mock-many"] = "1"` adds 100 connections in 10 groups.
  if (localStorage.getItem("odin-mock-many") === "1") {
    for (let i = 0; i < 100; i++) {
      profiles.push({
        id: `0192f000-0000-7000-8000-${String(1000 + i).padStart(12, "0")}`,
        name: `Customer ${String(i + 1).padStart(3, "0")}`,
        connectionString: `mongodb://customer-${i + 1}.example.net:27017`,
        readOnly: i % 3 === 0,
        hasPassword: true,
        color: PROFILE_COLORS[i % PROFILE_COLORS.length] ?? null,
        ssh: null,
        hasSshSecret: false,
        sshHostKey: null,
        group: `Region ${(i % 10) + 1}`,
      });
    }
  }
  mockIPC(
    async (command, payload) => {
      const handler =
        handlers[command] ?? fail("internal", `mock backend: unknown command ${command}`);
      await sleep(command === "connect" ? 450 : 90 + Math.random() * 120);
      return handler((payload ?? {}) as Record<string, unknown>);
    },
    { shouldMockEvents: true },
  );
  // UI reviews and browser tests simulate a server going down or coming back.
  Object.assign(window, {
    odinMock: {
      // Files dragged over the window, then dropped (or not), as the native drag and drop does.
      dragFiles: (hovering: boolean) => void emit("file-drag-changed", { hovering }),
      dropFiles: (files: { name: string; directory?: boolean }[]) => {
        void emit("file-drag-changed", { hovering: false });
        void emit("files-dropped", {
          files: files.map((file) => {
            const token = crypto.randomUUID();
            droppedFiles.set(token, { name: file.name, directory: file.directory ?? false });
            return { token, name: file.name, directory: file.directory ?? false };
          }),
        });
      },
      requestQuit: (operations: number) => void emit("quit-requested", { operations }),
      setReachable: (profileName: string, reachable: boolean) => {
        const profile = profiles.find((p) => p.name === profileName);
        const connection = [...connections.values()].find((c) => c.profileId === profile?.id);
        if (connection)
          void emit("connection-health-changed", { connectionId: connection.id, reachable });
      },
    },
  });
}
