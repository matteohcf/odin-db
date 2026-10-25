// Accessibility: axe-core finds no violations on the main screens.
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const axePath = fileURLToPath(import.meta.resolve("axe-core/axe.min.js"));
const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const results = [];
const audit = async (name) => {
  await page.waitForTimeout(600);
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const report = await window.axe.run(document, { resultTypes: ["violations"] });
    return report.violations.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 3)
          .join(", ")}`,
    );
  });
  results.push(violations.length === 0 ? `ok   ${name}` : `FAIL ${name}: ${violations.join("; ")}`);
};
const aside = () => page.getByRole("complementary");
const profileMenu = async (name, item) => {
  await aside()
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .hover();
  await aside()
    .getByRole("button", { name: `Actions for ${name}` })
    .first()
    .click();
  await page.getByRole("menuitem", { name: item }).click();
};

await page.goto("http://localhost:1420/");
await audit("welcome");
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^users$/ }).click();
await page.waitForSelector("[role=grid] tbody tr");
await audit("documents");
await page.getByRole("button", { name: "Insert document" }).click();
await audit("insert document dialog");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "More actions" }).click();
await page.getByRole("menuitem", { name: /^Export/ }).click();
await audit("export dialog");
await page.keyboard.press("Escape");
for (const view of ["Aggregation", "Schema", "Indexes", "Validation"]) {
  await page.getByRole("tab", { name: new RegExp(`^${view}`) }).click();
  await audit(view.toLowerCase());
}
await page.getByRole("tab", { name: /^Indexes/ }).click();
await page.getByRole("button", { name: "Create index" }).click();
await audit("create index dialog");
await page.keyboard.press("Escape");
await profileMenu("Local development", "Server status");
await audit("server status");
await profileMenu("Local development", /Search values/);
await audit("value search dialog");
await page.keyboard.press("Escape");
await profileMenu("shop", /Create collection/);
await audit("create collection dialog");
await page.keyboard.press("Escape");
await profileMenu("Local development", "Users and roles");
await audit("users and roles");
await page.getByRole("button", { name: "New user" }).click();
await audit("new user dialog");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "New role" }).click();
await audit("new role dialog");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Backups" }).click();
await audit("backups");
await page
  .getByRole("button", { name: /Settings/ })
  .first()
  .click();
await audit("settings");
await page.keyboard.press("Meta+k");
await audit("command palette");
await page.keyboard.press("Escape");
await aside().getByRole("button", { name: "New connection" }).first().click();
await audit("connection dialog");

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
