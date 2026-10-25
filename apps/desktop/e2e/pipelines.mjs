// Aggregation builder and index management flows against the mock backend.
import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-pipe-${name}.png` });
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
const typeInEditor = async (editor, text) => {
  await editor.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText(text);
};

await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.removeItem("odin-saved-pipelines"));
await page.reload();
await connect(page);
await page.click("text=shop");
await page.getByRole("button", { name: /^orders$/ }).click();
await page.getByRole("tab", { name: "Aggregation" }).click();
const stage1 = page.getByRole("region", { name: "Stage 1" });
await stage1.locator(".cm-content").waitFor();

await check("save a pipeline under a name", async () => {
  await typeInEditor(stage1.locator(".cm-content"), '{ status: "paid" }');
  await page.getByRole("button", { name: "Add stage", exact: true }).last().click();
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.getByLabel("Pipeline name").fill("Paid orders");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved Paid orders").waitFor();
  await page.getByText("$match → $match").waitFor();
  await page.waitForTimeout(250);
  await shot("saved-pipeline");
  await page.keyboard.press("Escape");
});

await check("load replaces the current pipeline", async () => {
  await page
    .getByRole("region", { name: "Stage 2" })
    .getByRole("button", { name: "Remove stage" })
    .click();
  await typeInEditor(stage1.locator(".cm-content"), '{ status: "refunded" }');
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.getByRole("button", { name: /^Paid orders/ }).click();
  await page.getByText("Loaded Paid orders").waitFor();
  await page.getByRole("region", { name: "Stage 2" }).waitFor();
  const body = await page
    .getByRole("region", { name: "Stage 1" })
    .locator(".cm-content")
    .innerText();
  if (!body.includes('"paid"')) throw new Error(body);
});

await check("delete a saved pipeline", async () => {
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.getByRole("button", { name: "Delete Paid orders" }).click();
  await page.getByText("Pipelines you save for this collection appear here.").waitFor();
  await page.keyboard.press("Escape");
});

await check("a pipeline copied from a shell pastes in as stages, and can be undone", async () => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() =>
    navigator.clipboard.writeText(
      'db.orders.aggregate([{ $match: { status: "paid" } }, { $group: { _id: "$city", n: { $sum: 1 } } }, { $sort: { n: -1 } }])',
    ),
  );
  await page.getByRole("button", { name: "Paste pipeline" }).click();
  await page.getByText("Pasted 3 stages").waitFor();
  await page.getByRole("region", { name: "Stage 3" }).waitFor();
  await shot("paste");
  await page.getByRole("button", { name: "Undo" }).click();
  if (await page.getByRole("region", { name: "Stage 3" }).count()) throw new Error("not undone");
});

await check("text mode edits the whole pipeline and goes back to stages", async () => {
  await page.getByRole("radio", { name: "Text" }).click();
  const editor = page.getByRole("textbox", { name: "Pipeline as text" });
  await editor.waitFor();
  if (!(await editor.innerText()).includes("$match")) throw new Error("pipeline not shown as text");
  await typeInEditor(
    editor,
    '[{ $match: { status: "paid" } }, { $sort: { total: -1 } }, { $limit: 5 }]',
  );
  await shot("text");
  await page.getByRole("radio", { name: "Stages" }).click();
  await page.getByRole("region", { name: "Stage 3" }).waitFor();
  // Text that does not parse keeps you in text mode, with the reason.
  await page.getByRole("radio", { name: "Text" }).click();
  await typeInEditor(page.getByRole("textbox", { name: "Pipeline as text" }), "[{ $match: ");
  await page.getByRole("radio", { name: "Stages" }).click();
  await page
    .getByRole("alert")
    .getByText(/pipeline text is not valid/)
    .waitFor();
  await typeInEditor(page.getByRole("textbox", { name: "Pipeline as text" }), "[{ $limit: 1 }]");
  await page.getByRole("radio", { name: "Stages" }).click();
  await page.getByRole("region", { name: "Stage 1" }).waitFor();
});

await check("a skipped stage survives a trip through text mode", async () => {
  await page.getByRole("radio", { name: "Text" }).click();
  await typeInEditor(
    page.getByRole("textbox", { name: "Pipeline as text" }),
    '[{ $match: { status: "paid" } }, { $limit: 2 }]',
  );
  await page.getByRole("radio", { name: "Stages" }).click();
  const second = page.getByRole("region", { name: "Stage 2" });
  await second.getByRole("switch", { name: "Include this stage" }).click();
  await page.getByRole("radio", { name: "Text" }).click();
  await page.getByRole("radio", { name: "Stages" }).click();
  await second.waitFor();
  if ((await second.getByRole("switch").getAttribute("aria-checked")) !== "false")
    throw new Error("the stage came back included");
});

await check("loading a saved pipeline in text mode shows it in the editor", async () => {
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.getByLabel("Pipeline name").fill("Two paid");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "Text" }).click();
  const editor = page.getByRole("textbox", { name: "Pipeline as text" });
  await typeInEditor(editor, '[{ $count: "n" }]');
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.getByRole("button", { name: /^Two paid/ }).click();
  await page.getByText("Loaded Two paid").waitFor();
  const text = await editor.innerText();
  if (!text.includes("paid") || text.includes("$count")) throw new Error(text);
  await page.getByRole("radio", { name: "Stages" }).click();
});

await check("a stage collapses to one line and grows for long bodies", async () => {
  const first = page.getByRole("region", { name: "Stage 1" });
  const editor = first.locator(".cm-editor");
  const before = (await editor.boundingBox())?.height ?? 0;
  await first.getByRole("button", { name: "More room to edit" }).click();
  const after = (await editor.boundingBox())?.height ?? 0;
  if (after <= before * 1.5) throw new Error(`${before} -> ${after}`);
  await first.getByRole("button", { name: "Collapse the stage" }).click();
  await editor.waitFor({ state: "hidden" });
  await first.locator("header code").waitFor();
  await shot("collapsed");
  await first.getByRole("button", { name: "Expand the stage" }).click();
  await editor.waitFor();
});

await check("a pipeline is explained stage by stage", async () => {
  await page.getByRole("button", { name: "Add stage", exact: true }).last().click();
  const second = page.getByRole("region", { name: "Stage 2" });
  await second.locator(".cm-content").waitFor();
  await page.getByRole("button", { name: "Explain" }).click();
  const dialog = page.getByRole("dialog", { name: "Query plan" });
  await dialog.getByText("COLLSCAN").first().waitFor();
  await dialog.getByText("Then, on what the query returned").waitFor();
  await shot("explain");
  await page.keyboard.press("Escape");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
