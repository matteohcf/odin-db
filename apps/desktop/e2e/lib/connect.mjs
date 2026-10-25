// Saved connections live in the connection manager, not the sidebar (ADR-0058).

/**
 * Opens the connection manager and connects to `name`, which then shows expanded in the
 * sidebar. `wait: false` returns right after the click, e.g. when a host key prompt follows.
 */
export async function connect(page, name = "Local development", { wait = true } = {}) {
  const manager = page.getByRole("dialog", { name: "Connections" });
  // A closing menu hides the dialogs below it from the accessibility tree, and a closing
  // dialog is about to go: let both finish first.
  await page.getByRole("menu").waitFor({ state: "detached" });
  await page.locator('[role="dialog"][data-state="closed"]').waitFor({ state: "detached" });
  if (!(await manager.count())) {
    await page.getByRole("button", { name: "Open connection…" }).first().click();
  }
  await manager
    .getByRole("button", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) })
    .click();
  if (wait) await manager.waitFor({ state: "detached" });
}

/** Waits for the sidebar, before anything is connected. */
export async function sidebarReady(page) {
  await page.getByRole("button", { name: "Open connection…" }).first().waitFor();
}
