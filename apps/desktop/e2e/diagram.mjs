// Database diagram: collections, inferred and drawn references, notes, search, field modes,
// opening a collection.
import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

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
await connect(page, "Local development");

await check("the database row opens its diagram", async () => {
  await tree.getByRole("button", { name: /^shop/ }).first().hover();
  await tree.getByRole("button", { name: "Actions for shop" }).first().click();
  await page.getByRole("menuitem", { name: "Show diagram" }).click();
  const heading = page.getByRole("heading", { name: "Diagram of shop" });
  await heading.waitFor();
  // The title has room: it is not cut short.
  if (await heading.evaluate((h) => h.scrollWidth > h.clientWidth)) throw new Error("truncated");
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
  const search = page.getByRole("textbox", { name: "Find a collection" });
  await search.fill("s");
  await page.getByText(/^1 of \d+$/).waitFor();
  await search.fill("supp");
  await page.getByText("1 of 1").waitFor();
  await page.locator(".react-flow__node.selected").filter({ hasText: "suppliers" }).waitFor();
  // Everything else steps back while searching.
  if (!(await node("orders").getAttribute("class"))?.includes("opacity-30"))
    throw new Error("not dimmed");
  await shot("04-search");
  await search.press("Escape");
  if ((await node("orders").getAttribute("class"))?.includes("opacity-30"))
    throw new Error("still dimmed");
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

await check("no key removes a collection from the diagram", async () => {
  await page.getByRole("button", { name: "Fit to screen" }).click();
  await page.waitForTimeout(400);
  await node("coupons").click();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  if ((await nodes.count()) !== 8) throw new Error(`${await nodes.count()} nodes`);
});

const edge = (id) => page.getByTestId(`rf__edge-${id}`);

await check("a field dragged onto a collection draws a reference", async () => {
  await page.getByRole("button", { name: "Fit to screen" }).click();
  await page.waitForTimeout(400);
  const row = node("coupons").locator("li").filter({ hasText: "code" });
  await row.hover();
  const handle = row.locator('.react-flow__handle[data-handleid="code"]');
  const from = await handle.boundingBox();
  const to = await node("users").boundingBox();
  if (!from || !to) throw new Error("no geometry");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 20, { steps: 12 });
  await shot("05-drawing");
  await page.mouse.up();
  await edge("coupons.code->users").waitFor();
  await page.getByRole("button", { name: "Copy as Mermaid diagram" }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  if (!text.includes('coupons }o--|| users : "code"')) throw new Error("not in Mermaid");
});

await check("a drawn reference is dashed and can be removed", async () => {
  const drawn = edge("coupons.code->users");
  const dash = await drawn.locator(".react-flow__edge-path").getAttribute("style");
  if (!dash?.includes("stroke-dasharray")) throw new Error(`style ${dash}`);
  await drawn.dispatchEvent("click");
  await page.getByText("drawn").waitFor();
  await shot("06-drawn-selected");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await drawn.waitFor({ state: "detached" });
});

await check("a wrong inferred reference can be hidden and shown again", async () => {
  await edge("orders.couponId->coupons").dispatchEvent("click");
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await edge("orders.couponId->coupons").waitFor({ state: "detached" });
  await page.getByText("1 reference hidden").waitFor();
  await shot("07-hidden");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await edge("orders.couponId->coupons").waitFor();
  if (await page.getByRole("button", { name: "Hide", exact: true }).isVisible())
    throw new Error("still selected");
});

await check("a note is added, kept, and deleted", async () => {
  await page.getByRole("button", { name: "Add a note" }).click();
  const note = page.getByRole("textbox", { name: "Note" });
  await note.waitFor();
  await page.keyboard.type("Orders are archived after 2 years");
  await page.waitForTimeout(300);
  await shot("08-note");
  await page.reload();
  await connect(page, "Local development");
  await page.getByRole("heading", { name: "Diagram of shop" }).waitFor();
  await note.waitFor({ timeout: 15000 });
  if ((await note.inputValue()) !== "Orders are archived after 2 years") throw new Error("lost");
  await note.hover();
  await page.getByRole("button", { name: "Delete note" }).click();
  await note.waitFor({ state: "detached" });
});

await check("an area groups collections and carries them along", async () => {
  await page.getByRole("button", { name: "Fit to screen" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Add an area" }).click();
  const name = page.getByRole("textbox", { name: "Area name" });
  await name.waitFor();
  await page.keyboard.type("Catalog");
  const area = page.locator(".react-flow__node-area");
  const box = await area.boundingBox();
  const coupons = node("coupons");
  const from = await coupons.locator("div").first().boundingBox();
  if (!box || !from) throw new Error("no geometry");
  // Drop coupons in the middle of the area, by its header.
  await page.mouse.move(from.x + 60, from.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + 60, { steps: 10 });
  await page.mouse.up();
  const placed = await coupons.boundingBox();
  const areaBefore = await area.boundingBox();
  // Then move the area by its title strip.
  const handle = area.locator(".diagram-area-handle");
  const strip = await handle.boundingBox();
  if (!placed || !strip) throw new Error("no geometry");
  await page.mouse.move(strip.x + strip.width - 60, strip.y + strip.height / 2);
  await page.mouse.down();
  await page.mouse.move(strip.x + strip.width - 60 + 120, strip.y + strip.height / 2 + 80, {
    steps: 10,
  });
  await page.mouse.up();
  const after = await coupons.boundingBox();
  const areaAfter = await area.boundingBox();
  if (!after || !areaBefore || !areaAfter) throw new Error("no geometry");
  const dx = areaAfter.x - areaBefore.x;
  const dy = areaAfter.y - areaBefore.y;
  if (dx < 50 || Math.abs(after.x - placed.x - dx) > 2 || Math.abs(after.y - placed.y - dy) > 2)
    throw new Error(`coupons did not follow: ${JSON.stringify({ dx, dy, placed, after })}`);
  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 400 } });
  await page.waitForTimeout(200);
  await shot("09-area");
  await page.reload();
  await connect(page, "Local development");
  await name.waitFor({ timeout: 15000 });
  if ((await name.inputValue()) !== "Catalog") throw new Error("area lost");
  await handle.hover();
  await page.getByRole("button", { name: "Delete area" }).click();
  await area.waitFor({ state: "detached" });
});

await check(
  "dragging several selected collections keeps them all where they were dropped",
  async () => {
    await page.getByRole("button", { name: "Fit to screen" }).click();
    await page.waitForTimeout(400);
    const header = (name) => node(name).locator("div").first();
    await header("suppliers").click();
    await header("categories").click({ modifiers: ["Meta"] });
    const before = {
      s: await node("suppliers").boundingBox(),
      c: await node("categories").boundingBox(),
    };
    const grip = await header("suppliers").boundingBox();
    if (!before.s || !before.c || !grip) throw new Error("no geometry");
    await page.mouse.move(grip.x + 40, grip.y + 12);
    await page.mouse.down();
    await page.mouse.move(grip.x - 60, grip.y + 92, { steps: 10 });
    await page.mouse.up();
    const moved = await node("categories").boundingBox();
    if (!moved || Math.abs(moved.y - before.c.y) < 30)
      throw new Error("categories did not move along");
    // Any annotation rebuilds the nodes from what was saved: nothing may snap back.
    await page.getByRole("button", { name: "Add a note" }).click();
    await page.waitForTimeout(300);
    const after = await node("categories").boundingBox();
    if (!after || Math.abs(after.y - moved.y) > 2) throw new Error("categories snapped back");
    await page.getByRole("button", { name: "Delete note" }).first().click({ force: true });
  },
);

await check("double-clicking a collection opens it", async () => {
  await page.getByRole("button", { name: "Fit to screen" }).click();
  await page.waitForTimeout(400);
  await node("users").dblclick();
  await page.getByRole("tab", { name: /users/ }).waitFor();
});

await check("the command palette opens a database's diagram", async () => {
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("diagram of analytics");
  await page.getByRole("option", { name: "Show diagram of analytics" }).click();
  await page.getByRole("heading", { name: "Diagram of analytics" }).waitFor();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
