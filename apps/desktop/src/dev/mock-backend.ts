/**
 * In-memory stand-in for the Rust backend, installed only by `vite dev` outside Tauri.
 * It honors the same command contract (typed errors, cursor paging, read-only
 * profiles) so the UI can be developed and reviewed in a plain browser.
 * Query support is deliberately shallow: equality filters and inclusion projections.
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
import { mockIPC } from "@tauri-apps/api/mocks";

type Doc = { [key: string]: JsonValue };
type Collections = Record<string, { kind: CollectionInfo["kind"]; docs: Doc[] }>;

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
      users: { kind: "collection", docs: Array.from({ length: 1240 }, (_, i) => user(i)) },
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
  },
  {
    id: "0192f000-0000-7000-8000-000000000002",
    name: "Production (Atlas)",
    connectionString: "mongodb+srv://reader@cluster0.example.net/?retryWrites=true",
    readOnly: true,
    hasPassword: true,
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

function collectionOf(connectionId: string, database: string, collection: string) {
  const { connection, databases } = serverOf(connectionId);
  databases[database] ??= {};
  const db = databases[database];
  db[collection] ??= { kind: "collection", docs: [] };
  return { connection, coll: db[collection] };
}

function matches(doc: Doc, filter: Doc) {
  return Object.entries(filter).every(
    ([key, value]) => key.startsWith("$") || JSON.stringify(doc[key]) === JSON.stringify(value),
  );
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

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  app_info: () => ({
    version: "0.0.0",
    tauriVersion: "mock",
    webviewVersion: navigator.userAgent,
    os: "browser",
    arch: "mock",
  }),
  perf_autorun_enabled: () => false,
  list_profiles: () => [...profiles].sort((a, b) => a.name.localeCompare(b.name)),
  create_profile: (args) => {
    const input = args.input as ProfileInput;
    validate(input);
    const profile: ConnectionProfile = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      connectionString: input.connectionString.trim().replace(/\/\/([^:@/]+):[^@/]*@/, "//$1@"),
      readOnly: input.readOnly,
      hasPassword: input.password !== null || /\/\/[^:@/]+:[^@/]*@/.test(input.connectionString),
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
    });
    return profile;
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
  find_documents: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const request = args.request as FindRequest;
    const { coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    let docs = coll.docs.filter((doc) => matches(doc, request.filter as Doc));
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
    return coll.docs.filter((doc) => matches(doc, args.filter as Doc)).length;
  },
  insert_document: (args) => {
    const ns = args.namespace as { database: string; collection: string };
    const { connection, coll } = collectionOf(id("connectionId", args), ns.database, ns.collection);
    ensureWritable(connection);
    const document = { ...(args.document as Doc) };
    if (document._id === undefined) document._id = oid();
    if (coll.docs.some((d) => JSON.stringify(d._id) === JSON.stringify(document._id))) {
      fail("database", "E11000 duplicate key error collection: _id_ dup key");
    }
    coll.docs.unshift(document);
    return document._id;
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
};

export function installMockBackend() {
  mockIPC(async (command, payload) => {
    const handler =
      handlers[command] ?? fail("internal", `mock backend: unknown command ${command}`);
    await sleep(command === "connect" ? 450 : 90 + Math.random() * 120);
    return handler((payload ?? {}) as Record<string, unknown>);
  });
}
