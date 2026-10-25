import { describe, expect, it } from "vitest";
import { buildConnectionString, parseConnectionString } from "./connection-uri";

describe("connection strings", () => {
  it("reads the parts the form edits", () => {
    const fields = parseConnectionString(
      "mongodb://ada%40corp:s%3Acret@db1:27017,db2:27018/shop?replicaSet=rs0&authSource=admin&appName=x",
    );
    expect(fields).toMatchObject({
      srv: false,
      hosts: "db1:27017,db2:27018",
      username: "ada@corp",
      password: "s:cret",
      database: "shop",
      authSource: "admin",
      replicaSet: "rs0",
      tls: false,
      extra: [["appName", "x"]],
    });
  });

  it("defaults TLS on for SRV connections", () => {
    expect(parseConnectionString("mongodb+srv://cluster0.abc.mongodb.net")?.tls).toBe(true);
    expect(parseConnectionString("mongodb+srv://c.net/?tls=false")?.tls).toBe(false);
  });

  it("rebuilds an equivalent string, keeping unknown options", () => {
    const text =
      "mongodb://ada@db1:27017/shop?authSource=admin&tls=true&replicaSet=rs0&retryWrites=false";
    const fields = parseConnectionString(text);
    expect(fields && buildConnectionString(fields)).toBe(text);
  });

  it("writes only what differs from the defaults", () => {
    const fields = parseConnectionString("mongodb://localhost:27017");
    expect(fields && buildConnectionString({ ...fields, directConnection: true })).toBe(
      "mongodb://localhost:27017/?directConnection=true",
    );
    const srv = parseConnectionString("mongodb+srv://c.net");
    expect(srv && buildConnectionString(srv)).toBe("mongodb+srv://c.net");
  });

  it("reads and writes certificate files, only with TLS on", () => {
    const text =
      "mongodb://db1:27017/?tls=true&tlsCAFile=%2Fetc%2Fssl%2Fca.pem&tlsCertificateKeyFile=%2Fhome%2Fada%2Fme.pem";
    const fields = parseConnectionString(text);
    expect(fields).toMatchObject({
      tlsCAFile: "/etc/ssl/ca.pem",
      tlsCertificateKeyFile: "/home/ada/me.pem",
      extra: [],
    });
    expect(fields && buildConnectionString(fields)).toBe(text);
    expect(fields && buildConnectionString({ ...fields, tls: false })).toBe("mongodb://db1:27017");
  });

  it("keeps certificate files given without tls=true, and option names in any case", () => {
    const fields = parseConnectionString("mongodb://h/?tlsCAFile=%2Fx.pem");
    expect(fields?.tls).toBe(true);
    expect(fields && buildConnectionString(fields)).toBe(
      "mongodb://h/?tls=true&tlsCAFile=%2Fx.pem",
    );
    const mixed = parseConnectionString("mongodb://h/?TLS=true&ReplicaSet=rs0");
    expect(mixed?.extra).toEqual([]);
    expect(mixed?.replicaSet).toBe("rs0");
  });

  it("rejects text that is not a MongoDB connection string", () => {
    expect(parseConnectionString("postgres://x")).toBeNull();
    expect(parseConnectionString("localhost:27017")).toBeNull();
  });
});
