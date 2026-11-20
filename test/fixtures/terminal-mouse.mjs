// A deterministic full-screen CLI that accepts modern mouse reports only.
process.stdin.setRawMode(true);
process.stdin.resume();
let wheel = 0;
const modes = "\x1b[?1000h\x1b[?1006h\x1b[?2004h";
process.stdout.write(`${modes}\x1b[2J\x1b[HMOUSE_READY\r\nCOPY_THIS_TEXT\r\n`);
process.stdin.on("data", (data) => {
  const text = data.toString();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Match the terminal's SGR mouse protocol.
  if (/\x1b\[<6[45];\d+;\d+M/.test(text)) process.stdout.write(`\x1b[4;1HWHEEL_${++wheel}`);
  if (text.includes("PASTE_MARKER")) process.stdout.write("\x1b[5;1HPASTE_RECEIVED");
});
