import path from "node:path";
import { expect, test } from "@playwright/test";
import { projectRoot } from "../../src/server/app.ts";
import { testApp, waitUntil } from "../helpers.ts";

test("a reattached mouse-aware CLI scrolls and accepts clipboard text without resizing", async ({
  page,
  context,
}) => {
  const app = await testApp(false);
  try {
    const launch = async (name: string, fixture: string) => {
      const result = await app.request("/api/sessions", {
        name,
        mode: "custom",
        cwd: projectRoot,
        executable: process.execPath,
        args: [path.join(projectRoot, `test/fixtures/${fixture}.mjs`), "--history"],
      });
      return result.body.state.selectedSessionId as string;
    };
    const id = await launch("Mouse CLI", "terminal-mouse");
    await waitUntil(() => app.terminals.output(id).includes("MOUSE_READY"));
    const other = await launch("Other CLI", "terminal-worker");
    await page.goto(app.url);
    await expect(page.locator(".xterm-accessibility-tree")).toContainText("WORKER_READY");
    for (let turn = 1; turn <= 3; turn++) {
      await page.getByRole("button", { name: "Open Mouse CLI", exact: true }).click();
      await expect(page.locator(".xterm-accessibility-tree")).toContainText("MOUSE_READY");
      await page.locator(".xterm-screen").hover();
      await page.mouse.wheel(0, 120);
      await expect(page.locator(".xterm-accessibility-tree")).toContainText(`WHEEL_${turn}`);
      if (turn < 3) {
        await page.getByRole("button", { name: "Open Other CLI", exact: true }).click();
        await expect(page.locator(".xterm-accessibility-tree")).toContainText("WORKER_READY");
      }
    }
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const row = page.locator(".xterm-rows > div").filter({ hasText: "COPY_THIS_TEXT" });
    const bounds = await row.boundingBox();
    if (!bounds) throw new Error("Copy fixture row is not visible");
    const modifier = (await page.evaluate(() => /Mac/.test(navigator.platform))) ? "Alt" : "Shift";
    await page.keyboard.down(modifier);
    await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 160, bounds.y + bounds.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up(modifier);
    await page.getByRole("button", { name: "Copy selection", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(/^COPY_THIS_TEXT\s*$/);
    await page.evaluate(() => navigator.clipboard.writeText("PASTE_MARKER"));
    await page.getByRole("button", { name: "Paste", exact: true }).click();
    await expect(page.locator(".xterm-accessibility-tree")).toContainText("PASTE_RECEIVED");
    await page.screenshot({ path: "test-artifacts/terminal-interaction.png" });
    // Clipboard permission can be asynchronous. Changing the target while it
    // resolves must not deliver the text to either terminal.
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "readText", {
        value: () =>
          new Promise<string>((resolve) => {
            (window as any).finishClipboardRead = resolve;
          }),
      });
    });
    await page.getByRole("button", { name: "Paste", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).finishClipboardRead))
      .toBe("function");
    await page.getByRole("button", { name: "Open Other CLI", exact: true }).click();
    await expect(page.locator(".xterm-accessibility-tree")).toContainText("WORKER_READY");
    await page.evaluate(() => (window as any).finishClipboardRead("NEVER_ROUTE_THIS"));
    await expect(page.locator("#toast")).toContainText("Session changed");
    expect(app.terminals.output(other)).not.toContain("NEVER_ROUTE_THIS");
    expect(app.terminals.output(id)).not.toContain("NEVER_ROUTE_THIS");
    await page.reload();
    await expect(page.locator(".xterm-accessibility-tree")).toContainText("WORKER_READY");
    await page.locator(".xterm-screen").hover();
    await page.mouse.wheel(0, -600);
    await expect(page.locator(".xterm-accessibility-tree")).not.toContainText("WORKER_READY");
    await expect(page.locator(".xterm-accessibility-tree")).toContainText("HISTORY_LINE_");
  } finally {
    await app.cleanup();
  }
});
