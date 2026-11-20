import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";

// Optional context for idle notifications, not proof that a turn completed.
// Read only the supplied session file, never discover or scan Claude history.
export function assistantExcerpt(source) {
  if (
    typeof source.transcript_path !== "string" ||
    !path.isAbsolute(source.transcript_path) ||
    !source.transcript_path.endsWith(".jsonl") ||
    typeof source.session_id !== "string" ||
    !source.session_id
  )
    return "";
  let fd;
  try {
    fd = openSync(source.transcript_path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) return "";
    const start = Math.max(0, stat.size - 1024 * 1024);
    const buffer = Buffer.alloc(Math.min(stat.size, 1024 * 1024));
    const bytes = readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8", 0, bytes).split("\n");
    if (start) lines.shift(); // The first bounded line can be incomplete.
    for (const line of lines.reverse()) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry?.sessionId !== source.session_id || entry.isSidechain) continue;
      // Never cross a later user message to reuse an earlier answer. Tool
      // results are user-role messages too, so skip only their typed blocks.
      const content = entry.message?.content;
      if (entry.type === "user") {
        if (
          typeof content === "string" ||
          (Array.isArray(content) && content.some((block) => block?.type === "text"))
        )
          return "";
        continue;
      }
      if (entry.type !== "assistant" || !Array.isArray(content)) continue;
      const text = content
        .filter((block) => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (text) return text.slice(0, 4000);
    }
  } catch {
    // Missing, rotated, unreadable or changed-format history must not lose the
    // notification, block the worker, or leak paths/content to its terminal.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return "";
}
