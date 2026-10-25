// Every saved connection is in the sidebar; clicking one connects and expands it (ADR-0059).

/**
 * Connects to `name` from its sidebar row, which then shows expanded. An already open
 * connection is only expanded. `wait: false` returns right after the click, e.g. when a host
 * key prompt follows.
 */
export async function connect(page, name = "Local development", { wait = true } = {}) {
  // An open connection manager, a closing menu or dialog hide the sidebar from the
  // accessibility tree: close or let them go first.
  await page.getByRole("menu").waitFor({ state: "detached" });
  await page.locator('[role="dialog"][data-state="closed"]').waitFor({ state: "detached" });
  const manager = page.getByRole("dialog", { name: "Connections" });
  if (await manager.count()) {
    await manager.getByRole("button", { name: "Close" }).last().click();
    await manager.waitFor({ state: "detached" });
  }
  const row = page
    .getByRole("complementary")
    .getByRole("button", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) })
    .first();
  if ((await row.getAttribute("aria-expanded")) === "true") return;
  await row.click();
  if (wait) {
    await page.waitForFunction(
      (element) => element?.getAttribute("aria-expanded") === "true",
      await row.elementHandle(),
    );
  }
}

/** Waits for the sidebar's saved connections. */
export async function sidebarReady(page) {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^Local development/ })
    .first()
    .waitFor();
}
