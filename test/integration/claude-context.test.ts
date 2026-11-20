import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { assistantExcerpt } from "../../scripts/claude-context.mjs";
import { removeTemporary, temporaryDirectory } from "../helpers.ts";

test("idle preview reads bounded session-local assistant text, excluding tools and older turns", () => {
  const directory = temporaryDirectory();
  try {
    const file = path.join(directory, "fixture.jsonl");
    const source = { transcript_path: file, session_id: "fixture-session" };
    const row = (type: string, content: unknown, extra = {}) =>
      `${JSON.stringify({ type, sessionId: source.session_id, message: { content }, ...extra })}\n`;
    const response = row("assistant", [
      { type: "thinking", thinking: "not a preview" },
      { type: "text", text: "Fixed the checkout regression. Twelve tests pass." },
      { type: "tool_use", input: { token: "fixture-only-do-not-forward" } },
    ]);
    writeFileSync(
      file,
      "x".repeat(1100000) +
        "\n" +
        response +
        row("user", [{ type: "tool_result", content: "private tool result" }]) +
        row("assistant", [{ type: "text", text: "Other session" }], { sessionId: "other" }) +
        row("assistant", [{ type: "text", text: "Sidechain" }], { isSidechain: true }) +
        '{"partial":',
    );
    assert.equal(assistantExcerpt(source), "Fixed the checkout regression. Twelve tests pass.");
    appendFileSync(file, `\n${row("user", [{ type: "text", text: "A new task" }])}`);
    assert.equal(
      assistantExcerpt(source),
      "",
      "must not reuse a response before the latest prompt",
    );
    writeFileSync(file, response + row("user", "A newer plain-text prompt"));
    assert.equal(assistantExcerpt(source), "");
    writeFileSync(file, row("assistant", [{ type: "text", text: "结果".repeat(10000) }]));
    assert.equal(assistantExcerpt(source).length, 4000);
    writeFileSync(file, row("assistant", [{ type: "thinking", thinking: "private" }]));
    assert.equal(assistantExcerpt(source), "");
    mkdirSync(path.join(directory, "directory.jsonl"));
    for (const invalid of [
      {},
      { transcript_path: "relative.jsonl", session_id: source.session_id },
      { ...source, session_id: "other" },
      { ...source, transcript_path: path.join(directory, "missing.jsonl") },
      { ...source, transcript_path: path.join(directory, "directory.jsonl") },
      { ...source, transcript_path: file.replace(".jsonl", ".txt") },
    ])
      assert.equal(assistantExcerpt(invalid), "");
  } finally {
    removeTemporary(directory);
  }
});
