// Query bar: autocompletion, history, reset.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-connform-${name}.png` });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};

await page.goto("http://localhost:1420/");
await page.getByRole("button", { name: "New connection" }).first().click();
const dialog = page.getByRole("dialog", { name: "New connection" });
await dialog.waitFor();

await check(
  "switching tabs keeps the dialog size, and names are not auto-capitalized",
  async () => {
    const height = () => dialog.evaluate((el) => el.getBoundingClientRect().height);
    await page.waitForTimeout(300);
    const before = await height();
    for (const tab of ["Form", "SSH tunnel", "Connection string"]) {
      await dialog.getByRole("tab", { name: tab }).click();
      const after = await height();
      if (Math.abs(after - before) > 1) throw new Error(`${tab}: ${before} → ${after}`);
    }
    const name = dialog.getByLabel("Name");
    if ((await name.getAttribute("autocapitalize")) !== "off") throw new Error("autocapitalize");
  },
);

await check("the form edits the connection string", async () => {
  await dialog.getByRole("tab", { name: "Form" }).click();
  await dialog.getByLabel("Hosts").fill("db1:27017,db2:27017");
  await dialog.getByLabel("Username").fill("ada@corp");
  await dialog.getByLabel("Authentication database").fill("admin");
  await dialog.getByLabel("Replica set").fill("rs0");
  await dialog.getByRole("switch", { name: "Use TLS" }).click();
  await page.waitForTimeout(200);
  await shot("01-form");
  await dialog.getByRole("tab", { name: "Connection string" }).click();
  const uri = await dialog.getByRole("textbox", { name: "Connection string" }).inputValue();
  const expected =
    "mongodb://ada%40corp@db1:27017,db2:27017/?authSource=admin&tls=true&replicaSet=rs0";
  if (uri !== expected) throw new Error(uri);
});

await check("TLS takes a CA and a client certificate file", async () => {
  await dialog.getByRole("tab", { name: "Form" }).click();
  await dialog.getByLabel("Certificate authority").waitFor();
  await dialog.getByRole("button", { name: "Choose…" }).first().click();
  await page.waitForFunction(
    () => document.querySelector("input[value$='company-ca.pem']") !== null,
  );
  await dialog.getByLabel("Client certificate").fill("/Users/ada/certs/me.pem");
  await shot("02-certificates");
  await dialog.getByRole("tab", { name: "Connection string" }).click();
  const uri = await dialog.getByRole("textbox", { name: "Connection string" }).inputValue();
  if (
    !uri.includes("tlsCAFile=%2FUsers%2Fada%2Fcerts%2Fcompany-ca.pem") ||
    !uri.includes("tlsCertificateKeyFile=%2FUsers%2Fada%2Fcerts%2Fme.pem")
  )
    throw new Error(uri);
});

await check("SRV switches scheme and TLS default", async () => {
  await dialog
    .getByRole("textbox", { name: "Connection string" })
    .fill("mongodb://localhost:27017/?appName=demo");
  await dialog.getByRole("tab", { name: "Form" }).click();
  await dialog.getByRole("switch", { name: "DNS seed list (mongodb+srv)" }).click();
  await dialog.getByLabel("Cluster host").fill("cluster0.abc.mongodb.net");
  if (await dialog.getByRole("switch", { name: "Direct connection" }).count())
    throw new Error("direct shown for SRV");
  await dialog.getByRole("tab", { name: "Connection string" }).click();
  const uri = await dialog.getByRole("textbox", { name: "Connection string" }).inputValue();
  if (uri !== "mongodb+srv://cluster0.abc.mongodb.net/?appName=demo") throw new Error(uri);
});

await check("strings the form cannot show are explained", async () => {
  await dialog.getByRole("textbox", { name: "Connection string" }).fill("not a uri");
  await dialog.getByRole("tab", { name: "Form" }).click();
  await dialog.getByText(/can't be shown as a form/).waitFor();
});

await check("saving a new connection connects and expands it", async () => {
  await dialog.getByRole("tab", { name: "Connection string" }).click();
  await dialog
    .getByRole("textbox", { name: "Connection string" })
    .fill("mongodb://localhost:27017");
  await dialog.getByLabel("Name").fill("Staging");
  await dialog.getByRole("button", { name: "Save and connect" }).click();
  await page
    .getByRole("button", { name: /^Staging/ })
    .first()
    .waitFor();
  await page.getByRole("button", { name: /^shop/ }).first().waitFor();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
