Zyi 0.5.5 improves terminal interaction and attention previews.

- Fix mouse-aware CLI scrolling after switching sessions or reconnecting: snapshots now preserve mouse-report encoding as well as tracking. The regression failed before the change and passes without resizing after it.
- Add **Copy selection** and **Paste** to the original terminal. Hold **Option on Mac** or **Shift on Windows/Linux** while dragging to select text in an agent that captures mouse clicks. Paste inserts text without Enter and cancels if the target changes while clipboard access is pending. Refresh the terminal when the window regains visibility or focus.
- Claude idle cards show an excerpt of the latest available assistant response instead of a repeated generic waiting message. This is a local preview, not a paid model summary or proof of completion. Missing/unreadable context falls back to **Input needed · no response preview**.
- A later completion enriches the same automatic idle card, retaining its identity, priority and deferral. Specific results, questions, permissions and manually classified items are preserved.

Quit Zyi, install the matching Windows x64 or Mac arm64/x64 package, then reopen and resume your sessions. No data migration is required. Existing saved cards receive context on a later hook event; the upgrade does not scan historical conversations.

Automated acceptance uses real PTYs, the shipped hook bridge, temporary transcripts and packaged desktop apps. No paid inference or personal Claude history is used. The reproduced protocol defect explains a terminal failure mode; testing on your installed Claude/Mac remains necessary to confirm it covers every intermittent freeze. Windows remains unsigned; Mac builds remain ad-hoc signed and not notarized.
