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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-favorites-${name}.png` });
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
const menuFor = async (name) => {
  await aside()
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .hover();
  await aside()
    .getByRole("button", { name: `Actions for ${name}` })
    .first()
    .click();
};
await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await aside().getByRole("button", { name: /^shop/ }).first().click();
await aside()
  .getByRole("button", { name: /^analytics/ })
  .first()
  .click();

await check("starred collections appear in Favorites", async () => {
  await menuFor("orders");
  await page.getByRole("menuitem", { name: "Add to favorites" }).click();
  await menuFor("events");
  await page.getByRole("menuitem", { name: "Add to favorites" }).click();
  const favorites = aside().getByRole("region", { name: "Favorites" });
  await favorites.getByRole("button", { name: /^orders/ }).waitFor();
  await favorites.getByRole("button", { name: /^events/ }).waitFor();
  await page.waitForTimeout(150);
  await shot("01-favorites");
});

await check("a favorite opens its collection, even after a restart", async () => {
  await page.reload();
  const favorites = aside().getByRole("region", { name: "Favorites" });
  await favorites.getByRole("button", { name: /^events/ }).click();
  await page.getByRole("main").getByRole("button", { name: "Connect" }).click();
  await page.getByRole("heading", { name: "events", level: 1 }).waitFor();
});

await check("renaming and unstarring keep favorites in sync", async () => {
  await aside()
    .getByRole("button", { name: /^Local development/ })
    .click();
  await aside().getByRole("button", { name: /^shop/ }).first().click();
  await aside()
    .getByRole("button", { name: /^orders/ })
    .nth(1)
    .waitFor();
  await aside()
    .getByRole("button", { name: /^orders/ })
    .last()
    .hover();
  await aside().getByRole("button", { name: "Actions for orders" }).last().click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByRole("dialog").getByLabel(/name/i).fill("sales");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Rename/ })
    .click();
  const favorites = aside().getByRole("region", { name: "Favorites" });
  await favorites.getByRole("button", { name: /^sales/ }).waitFor();
  await favorites.getByRole("button", { name: /^events/ }).hover();
  await favorites.getByRole("button", { name: "Actions for events" }).click();
  await page.getByRole("menuitem", { name: "Remove from favorites" }).click();
  await favorites.getByRole("button", { name: /^events/ }).waitFor({ state: "detached" });
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
