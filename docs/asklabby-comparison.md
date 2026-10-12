# AskLabby ZIP inspection and AuraSolve filling fixes

Inspected archive: `ask-labby-2.2.0(2).zip`, version 2.2.0.
SHA-256: `355e177c98a8a51e117bd6adb96789824d841e00933f5e140f2a77f5d90fba65`.
The archive contains 438 entries and 17 JavaScript files. This was static inspection, not execution against a signed-in Pearson activity.

## Evidence in the supplied files

| Area | Evidence | Implication |
| --- | --- | --- |
| Frame targeting | `manifest.json` injects content scripts into all matching Pearson frames. Integration configuration is filtered by URL and top/iframe context in `c7s4/29db2909.js` and `c7s4/42d4dcbd.js`. | Inspect the question's frame rather than assuming every field belongs to the outer document. |
| Native-page access | `background.js` handles integration execution and method calls through `chrome.scripting.executeScript` in the MAIN world. | Isolated content-script DOM access alone does not expose a page's editor APIs. |
| Input detection | The selector inventory names native `input.focusNode`, `span.eqEditor.inputField`, `span.eqEditor[widgetid]`, accounting-table textboxes, and custom dropdowns separately. | A single generic text-input query does not cover Pearson's custom controls. |
| Question layouts | The selector inventory uses `div[id*="xl_player_layout"]` and `.section > .bd`, not just TopBottomLayout. | Recognize multiple player layouts and restrict field discovery to question content. |
| Remote adapters | The integration loader requests `config.json` and named `.min.js` files from its configured integration service, refreshes auth and supplies auth headers, then installs exported classes. | The actual adapter implementations cannot be reconstructed from the loader alone. |
| Missing bundled fallback | No `cdn-local` or `r8f2/full-access` files occur in the uploaded archive, although the loader supports them. | The ZIP does not contain the named local fallback adapters either. |

## What was independently implemented in AuraSolve

- Detection across frames and multiple question layouts, automatically selecting an empty supported scalar field.
- Activation of lazy Pearson-style answer widgets before detecting their input.
- Capability-checked page-world MathQuill/Dojo writes with read-back; native and contenteditable input handling.
- Explicit separation between an automatically chosen field and a manually focused field when selecting a question frame.
- Original page exceptions returned as structured results instead of losing them behind a generic error.
- Tutor results rendered before attempting any mutation.
- A visible build number in the emoji panel and toolbar popup, to distinguish installed code from stale tabs or another unpacked extension directory.

No AskLabby server code, account credentials, branding, or remote execution loader was copied. Unavailable remote adapters were not fetched or bypassed. Custom Pearson graphs, dropdowns and editors without an exposed supported API remain unsupported until a live representative widget can be inspected.

## Reported click-first message

The exact string `Click the answer field on the page first, then choose Fill a field.` was present on `main` at commit `eca126df7a3c3a97f43e682d583d4a9e42abb206`. It was absent from the 1.13.7 fix branch. Seeing it means older page code is executing, whether from an old tab, an old checkout, or a different loaded extension directory. It does not prove which of these is responsible on the user's Mac.

The 1.13.8 release is intended for both main and the existing fix branch, eliminating the branch mismatch. Chrome still requires reloading the unpacked extension and refreshing the existing page. This environment cannot inspect which local Mac folder Chrome has loaded.
