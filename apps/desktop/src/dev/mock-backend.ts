/**
 * In-memory stand-in for the Rust backend, installed only by `vite dev` outside Tauri.
 * It honors the same command contract (typed errors, cursor paging, read-only
 * profiles) so the UI can be developed and reviewed in a plain browser.
 * Query support is deliberately shallow: simple filters, projections and common stages.
 */
import type {
  CollectionInfo,
  ConnectionInfo,
  ConnectionProfile,
  DatabaseInfo,
  DocumentPage,
  FindRequest,
  IpcError,
  JsonValue,
  ProfileInput,
} from "@odin-db/bindings";
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fieldPathsOf } from "@/lib/ejson-fields";

type Doc = { [key: string]: JsonValue };
type Collections = Record<
  string,
  {
    kind: CollectionInfo["kind"];
    docs: Doc[];
    indexes?: Doc[];
    validation?: { validator: JsonValue; level: string; action: string };
  }
>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (kind: IpcError["kind"], message: string): never => {
  throw { kind, message } satisfies IpcError;
};

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
const plans = ["free", "pro", "team", "enterprise"];

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
    score: { $numberDouble: String(((i * 13) % 1000) / 10) },
    loginCount: { $numberLong: String(i * 1_234_567) },
    createdAt: { $date: { $numberLong: String(1_672_531_200_000 + i * 3_600_000) } },
    tags: i % 3 === 0 ? ["beta", "newsletter"] : ["newsletter"],
    address: { city: cities[i % cities.length] ?? "Milano", zip: String(20100 + (i % 90)) },
  };
  if (i % 7 === 0) doc.referrer = null;
  if (i % 11 === 0) doc.avatar = { $binary: { base64: "iVBORw0KGgo=", subType: "00" } };
  return doc;
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
    placedAt: { $date: { $numberLong: String(1_700_000_000_000 + i * 86_400_000) } },
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
    },
    admin: {},
  },
};

const profiles: ConnectionProfile[] = [
  {
    id: "0192f000-0000-7000-8000-000000000001",
    name: "Local development",
    connectionString: "mongodb://localhost:27017",
    readOnly: false,
    hasPassword: false,
    color: "green",
  },
  {
    id: "0192f000-0000-7000-8000-000000000002",
    name: "Production (Atlas)",
    connectionString: "mongodb+srv://reader@cluster0.example.net/?retryWrites=true",
    readOnly: true,
    hasPassword: true,
    color: "red",
  },
];

const connections = new Map<string, ConnectionInfo>();
const cursors = new Map<string, { docs: Doc[]; offset: number }>();

function serverOf(connectionId: string) {
  const connection =
    connections.get(connectionId) ?? fail("notConnected", "connection is not open");
  // Every profile points at the same fake server.
  return { connection, databases: servers.local ?? {} };
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

/** Plain JS value of a canonical EJSON scalar, for comparisons. */
function scalar(value: JsonValue | undefined): unknown {
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

function matchesFilter(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, condition]) => {
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
  const documents = cursor.docs.slice(cursor.offset, cursor.offset + batchSize);
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

const importFiles = new Map<string, { rows: string[][]; headers: string[] }>();
const importFolders = new Set<string>();

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
    });
    return { ...profile };
  },
  export_connections: () => "/Users/ada/odin-db-connections.json",
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
    return { serverVersion: "8.0.4" };
  },
  connect: (args) => {
    const profileId = id("profileId", args);
    const existing = [...connections.values()].find((c) => c.profileId === profileId);
    if (existing) return existing;
    const profile =
      profiles.find((p) => p.id === profileId) ?? fail("notFound", "connection profile not found");
    if (profile.connectionString.includes("unreachable")) {
      fail("network", "cannot reach the server: Server selection timeout: No available servers.");
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
        sizeOnDisk: Object.values(colls).reduce((sum, c) => sum + c.docs.length * 412, 40_960),
      }),
    ),
  list_collections: (args) =>
    Object.entries(serverOf(id("connectionId", args)).databases[id("database", args)] ?? {})
      .map(([name, coll]): CollectionInfo => ({ name, kind: coll.kind }))
      .sort((a, b) => a.name.localeCompare(b.name)),
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
    databases[ns.database] ??= {};
    (databases[ns.database] as Record<string, unknown>)[ns.collection] = {
      kind: "collection",
      docs: [],
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
    indexesOf(coll).push(spec);
    return name;
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
    return fieldPathsOf(coll.docs.slice(0, args.size as number));
  },
  find_documents: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const request = args.request as FindRequest;
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    let docs = coll.docs.filter((doc) => matchesFilter(doc, request.filter as Doc));
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
    return coll.docs.filter((doc) => matchesFilter(doc, args.filter as Doc)).length;
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
    if (args.value === null) delete doc[field];
    else doc[field] = args.value as JsonValue;
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
  server_status: (args) => {
    serverOf(id("connectionId", args));
    const now = Date.now();
    // Counters grow with time, so consecutive samples give believable rates.
    const t = now / 1000;
    return {
      host: "localhost:27017",
      version: "8.0.4",
      process: "mongod",
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
    for (const doc of matched) {
      Object.assign(doc, update.$set ?? {});
      for (const field of Object.keys(update.$unset ?? {})) delete doc[field];
    }
    return { matched: matched.length, modified: matched.length };
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
