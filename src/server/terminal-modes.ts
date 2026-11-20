import type { Terminal } from "@xterm/headless";

// SerializeAddon preserves mouse tracking but omits its encoding. Observe the
// same parsed sequences as xterm (including split writes), without consuming
// them or reaching into xterm's private services.
export function trackMouseEncoding(screen: Terminal): () => string {
  let encoding = 0;
  for (const final of ["h", "l"]) {
    screen.parser.registerCsiHandler({ prefix: "?", final }, (params) => {
      for (const mode of params)
        if (mode === 1006 || mode === 1016) encoding = final === "h" ? mode : 0;
      return false;
    });
  }
  screen.parser.registerEscHandler({ final: "c" }, () => {
    encoding = 0;
    return false;
  });
  return () => (encoding ? `\x1b[?${encoding}h` : "");
}
