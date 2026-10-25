export const AUTH_MECHANISMS = [
  "SCRAM-SHA-256",
  "SCRAM-SHA-1",
  "MONGODB-X509",
  // LDAP: the user is checked by an LDAP server, through $external.
  "PLAIN",
  "MONGODB-AWS",
  "MONGODB-OIDC",
] as const;
export const READ_PREFERENCES = [
  "primary",
  "primaryPreferred",
  "secondary",
  "secondaryPreferred",
  "nearest",
] as const;

/** The parts of a connection string the form edits; everything else is kept as is. */
export interface ConnectionFields {
  srv: boolean;
  /** `host:port` pairs separated by commas, or the SRV host name. */
  hosts: string;
  username: string;
  /** Kept when the string has one; the form edits the password separately. */
  password: string | null;
  database: string;
  authSource: string;
  authMechanism: string;
  tls: boolean;
  tlsAllowInvalidCertificates: boolean;
  /** A certificate authority file, for servers whose certificate it signed. */
  tlsCAFile: string;
  /** A PEM file with this client's certificate and key, for X.509 or mutual TLS. */
  tlsCertificateKeyFile: string;
  replicaSet: string;
  directConnection: boolean;
  readPreference: string;
  /** Other options, in their original order. */
  extra: [string, string][];
}

// Compared in lower case: option names are case-insensitive.
const FORM_OPTIONS = new Set(
  [
    "authSource",
    "authMechanism",
    "tls",
    "ssl",
    "tlsAllowInvalidCertificates",
    "tlsCAFile",
    "tlsCertificateKeyFile",
    "replicaSet",
    "directConnection",
    "readPreference",
  ].map((name) => name.toLowerCase()),
);

const URI = /^(mongodb(?:\+srv)?):\/\/(?:([^@/]*)@)?([^/?]*)(?:\/([^?]*))?(?:\?(.*))?$/;

/** `null` when the text is not a MongoDB connection string the form can represent. */
export function parseConnectionString(text: string): ConnectionFields | null {
  const match = URI.exec(text.trim());
  if (!match) return null;
  const [, scheme, userinfo, hosts = "", database = "", query = ""] = match;
  const [user = "", ...passwordParts] = (userinfo ?? "").split(":");
  const options = query
    .split("&")
    .filter(Boolean)
    .map((pair): [string, string] => {
      const [key = "", ...value] = pair.split("=");
      return [decode(key), decode(value.join("="))];
    });
  const option = (name: string) =>
    options.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  const srv = scheme === "mongodb+srv";
  const tlsOption = option("tls") ?? option("ssl");

  return {
    srv,
    hosts,
    username: decode(user),
    password: passwordParts.length > 0 ? decode(passwordParts.join(":")) : null,
    database: decode(database),
    authSource: option("authSource") ?? "",
    authMechanism: option("authMechanism") ?? "",
    // SRV connections use TLS unless told otherwise; so does a string naming certificate files.
    tls:
      tlsOption === undefined
        ? srv || option("tlsCAFile") !== undefined || option("tlsCertificateKeyFile") !== undefined
        : tlsOption === "true",
    tlsAllowInvalidCertificates: option("tlsAllowInvalidCertificates") === "true",
    tlsCAFile: option("tlsCAFile") ?? "",
    tlsCertificateKeyFile: option("tlsCertificateKeyFile") ?? "",
    replicaSet: option("replicaSet") ?? "",
    directConnection: option("directConnection") === "true",
    readPreference: option("readPreference") ?? "",
    extra: options.filter(([key]) => !FORM_OPTIONS.has(key.toLowerCase())),
  };
}

export function buildConnectionString(fields: ConnectionFields): string {
  const scheme = fields.srv ? "mongodb+srv" : "mongodb";
  const userinfo = fields.username
    ? `${encode(fields.username)}${fields.password !== null ? `:${encode(fields.password)}` : ""}@`
    : "";
  const options: [string, string][] = [];
  if (fields.authSource) options.push(["authSource", fields.authSource]);
  if (fields.authMechanism) options.push(["authMechanism", fields.authMechanism]);
  // Only written when it differs from the scheme's default.
  if (fields.tls !== fields.srv) options.push(["tls", String(fields.tls)]);
  if (fields.tls && fields.tlsAllowInvalidCertificates) {
    options.push(["tlsAllowInvalidCertificates", "true"]);
  }
  if (fields.tls && fields.tlsCAFile) options.push(["tlsCAFile", fields.tlsCAFile]);
  if (fields.tls && fields.tlsCertificateKeyFile) {
    options.push(["tlsCertificateKeyFile", fields.tlsCertificateKeyFile]);
  }
  if (fields.replicaSet) options.push(["replicaSet", fields.replicaSet]);
  if (fields.directConnection && !fields.srv) options.push(["directConnection", "true"]);
  if (fields.readPreference) options.push(["readPreference", fields.readPreference]);
  options.push(...fields.extra);

  const query = options.map(([key, value]) => `${encode(key)}=${encode(value)}`).join("&");
  const path = fields.database || query ? `/${encode(fields.database)}` : "";
  return `${scheme}://${userinfo}${fields.hosts.trim()}${path}${query ? `?${query}` : ""}`;
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function encode(text: string): string {
  return encodeURIComponent(text);
}
