import path from "node:path";
import { expect, test } from "@playwright/test";
import { projectRoot } from "../../src/server/app.ts";
import { testApp } from "../helpers.ts";

test("background idle cards explain each session and retain the full context on opening", async ({
  page,
}) => {
  const app = await testApp(false);
  try {
    for (const [name, excerpt] of [
      [
        "Checkout review",
        "**Checkout review:** two retry paths can charge twice. Which approach should I use?",
      ],
      [
        "Documentation",
        "## Updated API guide\nExamples now cover retries and timeouts. All documentation checks pass.",
      ],
      ["No preview", ""],
    ]) {
      const created = await app.request("/api/sessions", {
        name,
        mode: "custom",
        cwd: projectRoot,
        executable: process.execPath,
        args: [path.join(projectRoot, "test/fixtures/terminal-worker.mjs")],
      });
      const id = created.body.state.selectedSessionId;
      await app.request("/api/hook", {
        relaySessionId: id,
        runId: app.terminals.records.get(id)?.runId,
        event: {
          hook_event_name: "Notification",
          notification_type: "idle_prompt",
          assistant_excerpt: excerpt,
        },
      });
    }
    await page.goto(app.url);
    await expect(page.locator(".queue-card")).toHaveCount(3);
    await expect(page.locator("#queue")).toContainText(
      "Checkout review: two retry paths can charge twice.",
    );
    await expect(page.locator("#queue")).toContainText(
      "Updated API guide Examples now cover retries and timeouts.",
    );
    await expect(page.locator("#queue")).toContainText("Input needed · no response preview");
    await page.screenshot({ path: "test-artifacts/attention-previews.png" });
    await page.locator(".queue-open").filter({ hasText: "Checkout review" }).click();
    await expect(page.locator("#terminal-name")).toHaveText("Checkout review");
    await expect(page.locator("#focus-item")).toContainText(
      "Latest assistant response (excerpt; verify in terminal)",
    );
    await expect(page.locator(".queue-card")).toHaveCount(3);
  } finally {
    await app.cleanup();
  }
});
