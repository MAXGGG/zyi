import assert from "node:assert/strict";
import { test } from "node:test";
import { ingestEvent } from "../../src/core/events.ts";
import type { WorkerEvent } from "../../src/core/types.ts";
import { Workspace } from "../../src/core/workspace.ts";

function fixture() {
  const w = new Workspace();
  const session = w.addSession({ name: "Worker", project: "repo", cwd: ".", mode: "claude" });
  return { w, session, emit: (event: WorkerEvent) => ingestEvent(w, session.id, event) };
}

test("turn question, user answer, and review are separate attention transitions", () => {
  const { w, session, emit } = fixture();
  emit({ hook_event_name: "SessionStart", session_id: "claude-conversation" });
  assert.equal(session.claudeId, "claude-conversation");
  emit({ hook_event_name: "Stop", last_assistant_message: "Which approach?", eventId: "one" });
  emit({ hook_event_name: "Stop", last_assistant_message: "Duplicate?", eventId: "one" });
  assert.equal(w.queue().length, 1);
  assert.equal(w.queue()[0].kind, "question");
  assert.equal(w.queue()[0].confidence, "suggested");
  emit({ hook_event_name: "UserPromptSubmit" });
  assert.equal(w.queue().length, 0);
  assert.equal(session.status, "working");
  emit({ hook_event_name: "Stop", message: "The change is ready." });
  emit({ hook_event_name: "UserPromptSubmit" });
  assert.equal(
    w.queue()[0].kind,
    "review",
    "hooks without observed user submission preserve results",
  );
  emit({ hook_event_name: "Stop", last_assistant_message: "" });
  assert.equal(w.queue().length, 2);
});

test("completion without message text and idle notifications still request attention", () => {
  const { w, session, emit } = fixture();
  emit({ hook_event_name: "UserPromptSubmit" });
  emit({ hook_event_name: "Stop", eventId: "empty-stop" });
  assert.equal(w.queue().length, 1);
  assert.equal(w.queue()[0].kind, "review");
  assert.equal(w.queue()[0].confidence, "detected");
  assert.equal(session.status, "waiting");
  emit({ hook_event_name: "Notification", notification_type: "idle_prompt" });
  assert.equal(w.queue().length, 1, "idle notice must not duplicate a completion");
  w.resolve(w.queue()[0].id);
  emit({ hook_event_name: "Notification", notification_type: "idle_prompt" });
  assert.equal(w.queue()[0].kind, "activity");
  assert.equal(w.queue()[0].confidence, "suggested");
  emit({ hook_event_name: "UserPromptSubmit" });
  assert.equal(w.queue().length, 0);
});

test("idle cards show response context and a late Stop enriches the same deferred item", () => {
  const { w, emit } = fixture();
  emit({
    hook_event_name: "Notification",
    notification_type: "idle_prompt",
    assistant_excerpt:
      "## Review complete\n\n**Two issues** remain in [checkout](https://example.test). Which fix should I apply?",
  });
  const item = w.queue()[0];
  assert.equal(
    item.title,
    "Review complete Two issues remain in checkout. Which fix should I apply?",
  );
  assert.equal(item.kind, "activity", "an excerpt is context, not a structured question");
  assert.match(item.detail, /excerpt; verify/);
  w.snooze(item.id);
  emit({
    hook_event_name: "Notification",
    notification_type: "idle_prompt",
    assistant_excerpt: "Two checkout issues need your review.",
  });
  assert.equal(item.status, "snoozed");
  const until = item.snoozedUntil;
  emit({ hook_event_name: "Stop", last_assistant_message: "Fixed checkout. All 12 tests pass." });
  assert.equal(w.state.items.length, 1);
  assert.equal(item.kind, "review");
  assert.equal(item.source, "turn-result");
  assert.equal(item.title, "Fixed checkout. All 12 tests pass.");
  assert.equal(item.snoozedUntil, until);
  emit({
    hook_event_name: "Notification",
    notification_type: "idle_prompt",
    assistant_excerpt: "Do not replace the direct result.",
  });
  assert.equal(item.title, "Fixed checkout. All 12 tests pass.");
});

test("missing previews are explicit and context cannot replace user-owned attention", () => {
  const { w, emit } = fixture();
  emit({ hook_event_name: "Notification", notification_type: "idle_prompt" });
  assert.equal(w.queue()[0].title, "Input needed · no response preview");
  w.classify(w.queue()[0].id, "question");
  emit({
    hook_event_name: "Notification",
    notification_type: "idle_prompt",
    assistant_excerpt: "Other text",
  });
  assert.equal(w.queue()[0].title, "Input needed · no response preview");
  w.resolve(w.queue()[0].id);
  emit({ hook_event_name: "Stop" });
  const item = w.queue()[0];
  emit({
    hook_event_name: "Notification",
    notification_type: "idle_prompt",
    assistant_excerpt: "A long response ".repeat(40),
  });
  assert.equal(w.queue()[0].id, item.id);
  assert.ok(item.title.length <= 180);
  assert.ok(item.title.endsWith("…"));
  assert.equal(item.kind, "review");
  assert.match(item.detail, /Latest assistant response/);
  w.resolve(item.id);
  emit({
    hook_event_name: "Notification",
    notification_type: "idle_prompt",
    assistant_excerpt: "Preserve this available context.",
  });
  const idle = w.queue()[0];
  emit({ hook_event_name: "Stop" });
  assert.equal(w.queue().length, 1);
  assert.equal(w.queue()[0].id, idle.id);
  assert.equal(idle.kind, "review");
  assert.equal(idle.title, "Preserve this available context.");
});

test("a submitted reply acknowledges only the captured automatic results in its session", () => {
  const { w, session, emit } = fixture();
  emit({ hook_event_name: "Stop", message: "First result" });
  const first = w.queue()[0];
  emit({ hook_event_name: "Stop", message: "Older deferred result" });
  const deferred = w.queue().find((item) => item.id !== first.id);
  assert.ok(deferred);
  w.snooze(deferred.id);
  emit({ hook_event_name: "Stop", message: "Keep this as a manual decision" });
  const manual = w.queue().find((item) => item.id !== first.id);
  assert.ok(manual);
  w.classify(manual.id, "review");
  emit({ hook_event_name: "PermissionRequest", tool_name: "Bash" });
  emit({ hook_event_name: "StopFailure", message: "Unresolved failure" });
  const other = w.addSession({ name: "Other", project: "repo", cwd: ".", mode: "claude" });
  ingestEvent(w, other.id, { hook_event_name: "Stop", message: "Other session result" });
  const captured = w.state.items.map((item) => item.id);
  emit({ hook_event_name: "Stop", message: "New result after input" });
  const submit = { hook_event_name: "UserPromptSubmit", eventId: "user-reply" };
  ingestEvent(w, session.id, submit, captured);
  assert.equal(first.status, "resolved");
  assert.equal(deferred.status, "resolved");
  assert.equal(deferred.snoozedUntil, undefined);
  assert.ok(first.resolvedAt);
  assert.equal(manual.status, "pending");
  assert.deepEqual(
    w
      .queue()
      .map((item) => item.title)
      .sort(),
    [
      "Keep this as a manual decision",
      "New result after input",
      "Other session result",
      "Permission requested for Bash. Open the terminal to decide.",
      "Unresolved failure",
    ].sort(),
  );
  ingestEvent(
    w,
    session.id,
    submit,
    w.queue().map((item) => item.id),
  );
  assert.ok(
    w.queue().some((item) => item.title === "New result after input"),
    "duplicate hooks cannot acknowledge newer results",
  );
  w.reopen(first.id);
  assert.equal(first.status, "pending", "handled history remains recoverable");
});

test("structured questions resolve only after the question tool completes", () => {
  const { w, emit } = fixture();
  emit({ hook_event_name: "PreToolUse", tool_name: "Read" });
  emit({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion" });
  emit({
    hook_event_name: "PreToolUse",
    tool_name: "AskUserQuestion",
    tool_input: {
      questions: [
        { header: "Empty" },
        { question: "Pick a database" },
        { question: "Pick a region" },
      ],
    },
  });
  assert.equal(w.queue().length, 2);
  emit({ hook_event_name: "Stop", last_assistant_message: "Please answer the questions." });
  assert.equal(w.queue().length, 2);
  emit({ hook_event_name: "UserPromptSubmit" });
  assert.equal(w.queue().length, 2);
  emit({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion" });
  assert.equal(w.queue().length, 0);
});

test("permission notices deduplicate and only matching execution clears the request", () => {
  const { w, emit } = fixture();
  emit({ hook_event_name: "PermissionRequest", tool_name: "Bash" });
  emit({
    hook_event_name: "Notification",
    notification_type: "permission_prompt",
    message: "Permission needed",
  });
  emit({ hook_event_name: "Notification", notification_type: "idle_prompt" });
  assert.equal(w.queue().length, 1);
  emit({ hook_event_name: "PostToolUse", tool_name: "Read" });
  emit({ hook_event_name: "PostToolUse" });
  assert.equal(w.queue().length, 1);
  emit({ hook_event_name: "PostToolUse", tool_name: "Bash" });
  assert.equal(w.queue().length, 0);
  emit({ hook_event_name: "PermissionRequest" });
  assert.match(w.queue()[0].title, /a tool/);
  w.resolve(w.queue()[0].id);
  emit({ hook_event_name: "Notification", notification_type: "permission_prompt" });
  assert.match(w.queue()[0].title, /Permission requested/);
});

test("background work, failures and session closure preserve pending attention", () => {
  const { w, session, emit } = fixture();
  emit({
    hook_event_name: "Stop",
    last_assistant_message: "Waiting for worker",
    background_tasks: [{}],
  });
  assert.equal(session.status, "working");
  assert.equal(w.queue().length, 0);
  emit({ hook_event_name: "Stop", session_crons: [{}] });
  assert.equal(session.status, "working");
  emit({ hook_event_name: "StopFailure" });
  assert.equal(w.queue()[0].kind, "error");
  emit({ hook_event_name: "StopFailure", message: "Rate limit" });
  assert.equal(w.queue().length, 2);
  emit({ hook_event_name: "SessionEnd" });
  emit({ hook_event_name: "Unknown" });
  assert.equal(session.status, "stopped");
  assert.equal(w.queue().length, 2);
});
