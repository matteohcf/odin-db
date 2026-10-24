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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-sidebar-${name}.png` });
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
await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.waitForSelector("text=shop");

await check("the filter narrows collections across databases and highlights matches", async () => {
  await page.keyboard.press("Meta+Shift+f");
  await page.keyboard.type("ev");
  await aside()
    .getByRole("button", { name: /^events/ })
    .waitFor();
  if (
    await aside()
      .getByRole("button", { name: /^orders/ })
      .count()
  )
    throw new Error("orders still shown");
  if (await aside().getByRole("button", { name: /^shop/ }).count())
    throw new Error("shop has no match");
  const marks = await aside().locator("mark").allInnerTexts();
  if (!marks.includes("ev")) throw new Error(marks.join(","));
  await shot("01-filter");
});

await check("a matching database shows all its collections", async () => {
  await page.getByRole("searchbox").fill("shop");
  await aside().getByRole("button", { name: /^shop/ }).first().click();
  await aside()
    .getByRole("button", { name: /^orders/ })
    .first()
    .waitFor();
});

await check("Escape clears the filter", async () => {
  await page.getByRole("searchbox").press("Escape");
  if ((await page.getByRole("searchbox").inputValue()) !== "") throw new Error("not cleared");
  await aside()
    .getByRole("button", { name: /^analytics/ })
    .first()
    .waitFor();
});

await check("collapse all folds the tree", async () => {
  if (
    !(await aside()
      .getByRole("button", { name: /^orders/ })
      .count())
  )
    await aside().getByRole("button", { name: /^shop/ }).first().click();
  await aside()
    .getByRole("button", { name: /^orders/ })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Collapse all" }).click();
  await aside()
    .getByRole("button", { name: /^orders/ })
    .waitFor({ state: "detached" });
});

await check("the sidebar resizes by drag, keys and double-click, and remembers", async () => {
  const handle = page.getByRole("separator", { name: "Resize the sidebar" });
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(360, box.y + 220, { steps: 6 });
  await page.mouse.up();
  const width = async () => Math.round((await aside().boundingBox()).width);
  if (Math.abs((await width()) - 360) > 4) throw new Error(`drag ${await width()}`);
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  if (Math.abs((await width()) - 344) > 4) throw new Error(`key ${await width()}`);
  await page.waitForTimeout(150);
  await shot("02-wide");
  await page.reload();
  await page.waitForSelector("text=Local development");
  if (Math.abs((await width()) - 344) > 4) throw new Error(`reload ${await width()}`);
  await page.getByRole("separator", { name: "Resize the sidebar" }).dblclick();
  if (Math.abs((await width()) - 288) > 4) throw new Error(`reset ${await width()}`);
});

await check("the filter matches connection names and explains no match", async () => {
  const input = page.getByRole("searchbox", { name: "Filter databases and collections" });
  await input.fill("staging");
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^Staging/ })
    .waitFor();
  if (
    await page
      .getByRole("complementary")
      .getByRole("button", { name: /^Production/ })
      .count()
  )
    throw new Error("unfiltered");
  await input.fill("zzz-nothing");
  await page.getByText("Nothing matches “zzz-nothing”.").waitFor();
  await input.fill("");
});
await check("hovering a row shows its menu button; right-click opens the row menu", async () => {
  await page.keyboard.press("Escape");
  const connection = aside()
    .getByRole("button", { name: /^Local development/ })
    .first();
  // Earlier checks may leave it closed.
  if (!(await aside().getByRole("button", { name: /^shop/ }).count())) await connection.click();
  await aside().getByRole("button", { name: /^shop/ }).first().click();
  await connection.hover();
  // Only the "…" menu shows on hover: every action lives in it.
  await aside().getByRole("button", { name: "Actions for Local development" }).waitFor();
  if (await aside().getByRole("button", { name: "Open shell" }).count())
    throw new Error("inline action");
  await shot("hover-actions");
  await aside()
    .getByRole("button", { name: /^orders/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to…" }).waitFor();
  await shot("context-menu");
  await page.keyboard.press("Escape");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
