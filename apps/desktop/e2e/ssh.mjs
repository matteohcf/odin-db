import { chromium } from "playwright";
import { connect, sidebarReady } from "./lib/connect.mjs";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: scheme,
  locale: "en-US",
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-ssh-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const aside = () => page.getByRole("complementary");
const KEY = "SHA256:q6z8m1Kc0rTQ3o5vY2bX9eW4nJ7hLsF0aUuD1pG8kM4";
await page.goto("http://localhost:1420/");
await sidebarReady(page);

await check("first connection asks to trust the host key", async () => {
  await connect(page, "Staging (bastion)", { wait: false });
  const dialog = page.getByRole("alertdialog", { name: "Trust this SSH server?" });
  await dialog.getByText(KEY).waitFor();
  await page.waitForTimeout(150);
  await shot("01-unknown");
  await dialog.getByRole("button", { name: "Trust and connect" }).click();
  await aside().getByRole("button", { name: /^shop/ }).first().waitFor();
});

await check("a changed key needs explicit confirmation", async () => {
  const profileId = "0192f000-0000-7000-8000-000000000003";
  await page.evaluate(
    (id) =>
      window.__TAURI_INTERNALS__.invoke("trust_ssh_host_key", { id, fingerprint: "SHA256:old" }),
    profileId,
  );
  await aside()
    .getByRole("button", { name: /^Staging \(bastion\)/ })
    .hover();
  await aside().getByRole("button", { name: "Actions for Staging (bastion)" }).click();
  await page.getByRole("menuitem", { name: "Disconnect" }).click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await aside().getByRole("button", { name: /^shop/ }).waitFor({ state: "detached" });
  // Let the disconnect finish: until then a click only folds the tree.
  await page.waitForTimeout(600);
  await connect(page, "Staging (bastion)", { wait: false });
  const dialog = page.getByRole("alertdialog", { name: "The SSH server's key has changed" });
  await dialog.waitFor();
  const trust = dialog.getByRole("button", { name: "Trust the new key" });
  if (!(await trust.isDisabled())) throw new Error("trust enabled without confirmation");
  await page.waitForTimeout(150);
  await shot("02-changed");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  // The connection manager stays open behind a cancelled prompt.
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Connections" }).waitFor({ state: "detached" });
});

await check("set up an SSH tunnel in a new connection and test it", async () => {
  await aside().getByRole("button", { name: "New connection" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Reports (bastion)");
  await dialog
    .getByRole("textbox", { name: "Connection string", exact: true })
    .first()
    .fill("mongodb://reports.internal:27017");
  await dialog.getByRole("tab", { name: "SSH tunnel" }).click();
  await dialog.getByRole("switch", { name: "Connect through an SSH tunnel" }).click();
  await dialog.getByLabel("SSH host").fill("bastion.example.com");
  await dialog.getByLabel("SSH user").fill("ada");
  await dialog.getByLabel("SSH password").fill("tunnel-pw");
  await page.waitForTimeout(150);
  await shot("03-form");
  await dialog.getByRole("button", { name: "Test connection" }).click();
  await dialog.getByRole("alert").getByText(KEY).waitFor();
  await dialog.getByRole("button", { name: "Trust and test again" }).click();
  await dialog
    .getByText(/Connected|MongoDB 8\.0\.4/)
    .first()
    .waitFor();
  await dialog.getByRole("tab", { name: "SSH tunnel" }).click();
  await dialog.getByText(`Trusted host key: ${KEY}`).waitFor();
  await dialog.getByRole("button", { name: "Save and connect" }).click();
  await aside()
    .getByRole("button", { name: /^Reports \(bastion\)/ })
    .waitFor();
  await page
    .getByRole("alertdialog")
    .waitFor({ state: "detached", timeout: 3000 })
    .catch(() => {
      throw new Error("asked again for a key trusted while testing");
    });
});

await check("a private key is chosen through the system dialog", async () => {
  await aside()
    .getByRole("button", { name: /^Reports \(bastion\)/ })
    .hover();
  await aside().getByRole("button", { name: "Actions for Reports (bastion)" }).click();
  await page.getByRole("menuitem", { name: /Edit/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "SSH tunnel" }).click();
  await dialog.getByRole("radio", { name: "Private key" }).click();
  await dialog.getByRole("button", { name: "Choose key…" }).click();
  await dialog.getByText("/Users/ada/.ssh/id_ed25519").waitFor();
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
