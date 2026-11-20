import assert from "node:assert/strict";
import { test } from "node:test";
import serialize from "@xterm/addon-serialize";
import headless from "@xterm/headless";
import { trackMouseEncoding } from "../../src/server/terminal-modes.ts";

test("screen snapshots preserve mouse encoding across split sequences, mode changes and resets", async () => {
  const screen = new headless.Terminal({ allowProposedApi: true });
  const mirror = new headless.Terminal({ allowProposedApi: true });
  const serializer = new serialize.SerializeAddon();
  screen.loadAddon(serializer);
  const encoding = trackMouseEncoding(screen);
  const write = (target: typeof screen, data: string) =>
    new Promise<void>((resolve) => target.write(data, resolve));
  try {
    for (const sequence of [
      "\x1b[?1000;1006h",
      "\x1b[?1016h",
      "\x1b[?1006l",
      "\x1b[?1006h",
      "\x1bc",
    ]) {
      for (const chunk of sequence) await write(screen, chunk);
      mirror.reset();
      await write(mirror, serializer.serialize() + encoding());
      const replies = async (target: typeof screen) => {
        let result = "";
        const listener = target.onData((data) => {
          result += data;
        });
        await write(target, "\x1b[?1006$p\x1b[?1016$p");
        listener.dispose();
        return result;
      };
      assert.equal(await replies(mirror), await replies(screen));
    }
  } finally {
    screen.dispose();
    mirror.dispose();
  }
});
