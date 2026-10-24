// Database diagram: collections, inferred references, search, field modes, opening a collection.
import { chromium } from "playwright";

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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-diagram-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const tree = page.getByRole("complementary");
const nodes = page.locator(".react-flow__node");
const node = (name) => nodes.filter({ has: page.getByText(name, { exact: true }) }).first();

await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await tree
  .getByRole("button", { name: /^Local development/ })
  .first()
  .click();

await check("the database row opens its diagram", async () => {
  const shop = tree.getByRole("button", { name: /^shop/ }).first();
  await shop.hover();
  await tree
    .locator("li[data-index]")
    .filter({ has: page.getByRole("button", { name: /^shop/ }) })
    .getByRole("button", { name: "Show diagram" })
    .click();
  await page.getByRole("heading", { name: "Diagram of shop" }).waitFor();
  await nodes.first().waitFor({ timeout: 15000 });
  if ((await nodes.count()) !== 8) throw new Error(`${await nodes.count()} nodes`);
  await page.getByText("8 collections, 9 references").waitFor();
  await page.waitForTimeout(500);
  await shot("01-diagram");
});

await check("references are drawn and light up on hover", async () => {
  if ((await page.locator(".react-flow__edge").count()) !== 9) throw new Error("edges");
  await node("orders").hover();
  await page.locator(".react-flow__edge.animated").first().waitFor();
  if ((await page.locator(".react-flow__edge.animated").count()) !== 3)
    throw new Error(`${await page.locator(".react-flow__edge.animated").count()} lit`);
  await shot("02-hover");
});

await check("keys only lists _id and references", async () => {
  await page.getByRole("radio", { name: "Keys only" }).click();
  const rows = node("orders").locator("li");
  await page.waitForTimeout(200);
  const texts = await rows.allInnerTexts();
  if (!texts.some((text) => text.includes("items.productId"))) throw new Error(texts.join("|"));
  if (texts.some((text) => text.startsWith("status"))) throw new Error("status still listed");
  await shot("03-keys");
  await page.getByRole("radio", { name: "All fields" }).click();
});

await check("searching selects and centers a collection", async () => {
  await page.getByRole("combobox", { name: "Find a collection" }).fill("supp");
  await page.getByRole("combobox", { name: "Find a collection" }).press("Enter");
  await page.locator(".react-flow__node.selected").filter({ hasText: "suppliers" }).waitFor();
});

await check("the diagram copies as Mermaid and saves as an image", async () => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy as Mermaid diagram" }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  if (!text.startsWith("erDiagram") || !text.includes('orders }o--o{ products : "items.productId"'))
    throw new Error(text.slice(0, 200));
  await page.getByRole("button", { name: "Save as image…" }).click();
  await page.getByText("Saved to /Users/ada/Downloads/shop-diagram.png").waitFor();
});

await check("double-clicking a collection opens it", async () => {
  await page.getByRole("button", { name: "Fit to screen" }).click();
  await page.waitForTimeout(400);
  await node("users").dblclick();
  await page.getByRole("tab", { name: /users/ }).waitFor();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
