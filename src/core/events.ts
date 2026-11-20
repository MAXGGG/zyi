import type { WorkerEvent } from "./types.ts";
import type { Workspace } from "./workspace.ts";

const emptyResult = "Claude finished its turn. Open the terminal to review the result.";
function preview(text: string): string {
  const plain = text
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|[-*][ \t]+|\d+\.[ \t]+|```[^\n]*)/gm, "")
    .replace(/\[([^[\]\r\n]{1,500})\]\([^()\r\n]{1,2000}\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= 180) return plain;
  const end = plain.lastIndexOf(" ", 179);
  return `${plain.slice(0, end > 120 ? end : 179)}…`;
}

export function pendingClaudeReviews(workspace: Workspace, sessionId: string) {
  return workspace.state.items.filter(
    (item) =>
      item.sessionId === sessionId &&
      item.status !== "resolved" &&
      item.source === "turn-result" &&
      item.kind === "review" &&
      item.confidence !== "manual",
  );
}

export function ingestEvent(
  workspace: Workspace,
  sessionId: string,
  event: WorkerEvent,
  submittedReviewIds: readonly string[] = [],
): void {
  const session = workspace.session(sessionId);
  if (event.eventId && !workspace.recordEvent(`${sessionId}:${event.eventId}`)) return;
  if (event.session_id) {
    session.claudeId = event.session_id;
    session.conversationId = event.session_id;
  }
  const text = (event.last_assistant_message ?? event.message ?? "").trim().slice(0, 20000);
  const add = (
    kind: "question" | "approval" | "review" | "error",
    detail: string,
    source: string,
    requestKey?: string,
    suggested = false,
  ) => {
    const input = {
      kind,
      detail,
      title: preview(detail) || "Session needs attention",
      source,
      ...(requestKey ? { requestKey } : {}),
      confidence: suggested ? ("suggested" as const) : ("detected" as const),
    };
    // A delayed Stop enriches the existing idle card instead of creating a
    // duplicate. Keep its ID, priority, deferral and user-owned classifications.
    const idle =
      (source === "turn-result" || source === "turn-question") &&
      workspace.state.items.find(
        (item) =>
          item.sessionId === sessionId &&
          item.source === "idle-prompt" &&
          item.status !== "resolved" &&
          item.confidence !== "manual",
      );
    if (idle) Object.assign(idle, input);
    else workspace.enqueue(sessionId, input);
  };
  const resolveQuestions = (source: string, requestKey?: string) => {
    for (const item of workspace.state.items) {
      if (
        item.sessionId === sessionId &&
        item.status !== "resolved" &&
        item.source === source &&
        (!requestKey || item.requestKey === requestKey)
      )
        workspace.resolve(item.id);
    }
  };

  switch (event.hook_event_name) {
    case "SessionStart":
      session.status = "idle";
      break;
    case "UserPromptSubmit":
      session.status = "working";
      session.lastActivityAt = workspace.now();
      resolveQuestions("turn-question");
      resolveQuestions("idle-prompt");
      // A follow-up acknowledges earlier responses, not approval requests or
      // correctness. The server supplies only IDs captured at explicit input.
      for (const item of pendingClaudeReviews(workspace, sessionId))
        if (submittedReviewIds.includes(item.id)) workspace.resolve(item.id);
      break;
    case "PreToolUse":
      if (event.tool_name === "AskUserQuestion") {
        session.status = "waiting";
        for (const question of event.tool_input?.questions ?? []) {
          if (question.question) add("question", question.question, "structured-question");
        }
      }
      break;
    case "PermissionRequest":
      session.status = "waiting";
      add(
        "approval",
        text ||
          `Permission requested for ${event.tool_name ?? "a tool"}. Open the terminal to decide.`,
        "permission",
        event.tool_name,
      );
      break;
    case "PostToolUse":
      if (event.tool_name === "AskUserQuestion") resolveQuestions("structured-question");
      if (event.tool_name) resolveQuestions("permission", event.tool_name);
      session.status = "working";
      break;
    case "Notification":
      if (event.notification_type === "idle_prompt") {
        session.status = "waiting";
        const pending = workspace.state.items.filter(
          (item) => item.sessionId === sessionId && item.status !== "resolved",
        );
        const context = (event.assistant_excerpt ?? event.last_assistant_message ?? "")
          .trim()
          .slice(0, 4000);
        const detail = context
          ? `Latest assistant response (excerpt; verify in terminal):\n${context}`
          : text ||
            "Claude reported an idle prompt. No response preview is available; open the terminal to see what it needs.";
        const title = context ? preview(context) : "Input needed · no response preview";
        const generic = pending.find(
          (item) =>
            item.confidence !== "manual" &&
            (item.source === "idle-prompt" ||
              (item.source === "turn-result" && item.detail === emptyResult)),
        );
        if (generic && context) Object.assign(generic, { title, detail });
        if (!pending.length)
          workspace.enqueue(sessionId, {
            kind: "activity",
            title,
            detail,
            source: "idle-prompt",
            confidence: "suggested",
          });
      }
      if (event.notification_type === "permission_prompt") {
        session.status = "waiting";
        if (
          !workspace.state.items.some(
            (item) =>
              item.sessionId === sessionId &&
              item.source === "permission" &&
              item.status !== "resolved",
          )
        ) {
          add(
            "approval",
            text || "Permission requested. Open the terminal to decide.",
            "permission",
          );
        }
      }
      break;
    case "Stop": {
      session.lastActivityAt = workspace.now();
      if (event.background_tasks?.length || event.session_crons?.length) {
        session.status = "working";
        break;
      }
      session.status = "waiting";
      const structured = workspace.state.items.some(
        (item) =>
          item.sessionId === sessionId &&
          item.source === "structured-question" &&
          item.status !== "resolved",
      );
      if (!structured) {
        const question = /\?\s*$/.test(text);
        add(
          question ? "question" : "review",
          text || emptyResult,
          question ? "turn-question" : "turn-result",
          undefined,
          Boolean(text),
        );
      }
      break;
    }
    case "StopFailure":
      session.status = "error";
      add(
        "error",
        text || "Claude could not complete its response. Inspect the terminal.",
        "failure",
      );
      break;
    case "SessionEnd":
      session.status = "stopped";
      break;
    default:
      break;
  }
}
