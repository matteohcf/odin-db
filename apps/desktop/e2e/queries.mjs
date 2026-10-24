// My queries: saved queries and pipelines of every connection, searched, opened and removed.
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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-queries-${name}.png` });
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
// Saved the way the query history and the pipeline builder save them.
const profileId = await page.evaluate(async () => {
  const internals = window.__TAURI_INTERNALS__;
  const list = await internals.invoke("list_profiles", {});
  return list.find((p) => p.name === "Local development").id;
});
await page.evaluate((id) => {
  const key = (collection) => JSON.stringify([id, "shop", collection]);
  const form = {
    filter: '{ status: "paid" }',
    sort: "{ total: -1 }",
    projection: "",
    skip: "",
    limit: "20",
  };
  localStorage.setItem(
    "odin-query-history",
    JSON.stringify({
      state: { entries: {}, saved: { [key("orders")]: [{ form, ranAt: Date.now() - 60_000 }] } },
      version: 2,
    }),
  );
  localStorage.setItem(
    "odin-saved-pipelines",
    JSON.stringify({
      state: {
        pipelines: {
          [key("orders")]: [
            {
              name: "Revenue by city",
              stages: [
                { operator: "$match", body: '{ status: "paid" }', enabled: true },
                {
                  operator: "$group",
                  body: '{ _id: "$city", total: { $sum: "$total" } }',
                  enabled: false,
                },
              ],
              savedAt: Date.now() - 3_600_000,
            },
          ],
        },
      },
      version: 1,
    }),
  );
}, profileId);
await page.reload();

await check("the sidebar footer opens every saved query and pipeline", async () => {
  await page.getByRole("button", { name: "Queries", exact: true }).click();
  await page.getByRole("heading", { name: "My queries" }).waitFor();
  await page.getByText('{ status: "paid" }').first().waitFor();
  await page.getByText("Revenue by city").waitFor();
  await page.getByText("$match → $group").waitFor();
  await shot("01-list");
});

await check("search narrows the list", async () => {
  const search = page.getByRole("searchbox", { name: "Search saved queries and pipelines" });
  await search.fill("revenue");
  if (await page.getByText('{ status: "paid" }', { exact: true }).count())
    throw new Error("query still shown");
  await search.fill("");
});

await check("a saved query opens in its collection and runs", async () => {
  await page
    .getByRole("listitem")
    .filter({ hasText: "Query" })
    .getByRole("button", { name: "Open" })
    .click();
  await page.getByRole("tab", { name: /orders/ }).waitFor();
  await page
    .getByRole("textbox", { name: /Filter/ })
    .first()
    .waitFor();
  const filter = await page.locator(".cm-content").first().innerText();
  if (!filter.includes("paid")) throw new Error(filter);
});

await check("a saved pipeline opens in the aggregation builder", async () => {
  await page.getByRole("button", { name: "Queries", exact: true }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Revenue by city" })
    .getByRole("button", { name: "Open" })
    .click();
  const second = page.getByRole("region", { name: "Stage 2" });
  await second.waitFor();
  // A skipped stage stays skipped, not dropped or turned back on.
  if ((await second.getByRole("switch").getAttribute("aria-checked")) !== "false")
    throw new Error("the skipped stage came back enabled");
  await shot("02-pipeline");
});

await check("removing asks nothing and can be undone", async () => {
  await page.getByRole("button", { name: "Queries", exact: true }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Revenue by city" });
  await row.hover();
  await row.getByRole("button", { name: "Remove" }).click();
  await row.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByText("Revenue by city").waitFor();
});

await check("the sidebar footer fits at the narrowest sidebar", async () => {
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("odin-settings") ?? '{"state":{},"version":1}');
    saved.state.sidebarWidth = 264;
    localStorage.setItem("odin-settings", JSON.stringify(saved));
  });
  await page.reload();
  const footer = page.locator("footer").first();
  await footer.getByRole("button", { name: "Queries" }).waitFor();
  if (await footer.evaluate((el) => el.scrollWidth > el.clientWidth))
    throw new Error("footer overflows");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
