# Verification — AuraSolve 1.0.1

Build date: 2026-10-11 UTC.

- `npm test`: **23 passed, 0 failed** (Node.js 24.16.0).
- `npm run check`: **passed** — JavaScript syntax and manifest entry-file existence.
- Tests use DOM doubles and mocked Chrome/OpenAI interfaces, not real browser sessions.
- Policy cases: positive practice indicators, negative grading indicators, unknown status, blocked child-frame context, consent page binding and expiry.
- Solution cases: valid fields, forbidden targets, duplicate targets, graph bounds, dropdown values, drop destinations, incomplete API responses, missing key.
- Action cases: native setter/input/change events, changed question, grading appeared, incomplete plan, hidden page, complete submission.
- Worker cases: required consent, apply once, Stop invalidates pending plans, practice recheck before mutation, changed snapshot rejection.

## Live read-only inspection for 1.0.1

Inspected the user's Chrome Pearson player without changing any answer. The prompt and eight native radio choices were inside `xl_player_layout_TopBottomLayout_0`, nested beneath the Question Viewer and `activityFrame` frames. Added that layout family to question detection. The open activity was labeled “Chapter 1 Pre-Test” with points possible, so practice-only filling/submission was not attempted. This validates the observed selector and field structure, not an end-to-end installed-extension or OpenAI run.

## Not verified in this environment

- Chrome extension installation/rendering: launching the test Chrome process was blocked by the execution environment.
- Live local demo: binding localhost port 4318 was denied by the execution environment. The included server can be run from the user's terminal.
- Real OpenAI request: run against Railway with OPENAI_API_KEY set in server env.
- Live signed-in Pearson/MyLab pages, their proprietary graph widgets, and custom drag controls.

Before relying on a real practice page, test Explain, then a single field, and then a short AutoPilot run on known ungraded material. Review actual page feedback. The local lab provides repeatable controls for each implemented action family.


## 1.13.5 verification

`npm test`: 30 passing Node regression tests, including native inputs, editor API read-back, missing Dojo setters, parent-frame submission/feedback, changed-question rejection, and preservation of LaTeX instructions.

`npm run check`: syntax and manifest entry-point validation.

An optional `node tests/browser-fixtures.mjs` suite covers actual contenteditable input and keeping tutor cards visible on a failed AutoPilot fill. It requires Playwright and its Chromium browser. It could not be executed in the build environment: Chromium was absent and its download returned invalid ZIP data. These browser cases are therefore **unverified**, not passing.

No live signed-in Pearson/MyMathLab or other lab integration was tested. MathQuill/Dojo tests use API doubles; actual sites must expose the supported API.

## 1.13.6 follow-up: Fill field

- `npm test`: 34 tests pass, including tests that execute the real injected page-call function rather than mocking away its exception handling.
- The three browser fixtures now pass in Chromium 153: real contenteditable writes and stable snapshots; tutor visibility after an AutoPilot failure; and clicking Fill field to write a selected native input, display the explanation, and leave Submit untouched. The AI response and Chrome messaging are stubbed; these are not live Pearson tests.
- The browser was obtained through a separately installed Chromium package after the Playwright browser download failed. Run `CHROMIUM_PATH=/path/to/chromium node tests/browser-fixtures.mjs` with an installed Chromium, or omit the variable with Playwright's bundled browser installed.
- Added recognition of Pearson `span.eqEditor[widgetid]` and lookup through the exposed Dojo registry using the widget ID. It still requires a real supported value API; this is not a promise that all Pearson editors work.
- Removed the generic “The page action failed” wrapper: synchronous and asynchronous page exceptions now retain their original error message, and stale page scripts give a refresh instruction.
- No signed-in Pearson session was available to reproduce the reported field failure.

## 1.13.7: automatic selection

The Fill-button browser fixture now explicitly avoids focusing or clicking the answer input. It still fills the native input and preserves the explanation without submitting. A fourth Chromium fixture verifies activation of a lazy Pearson-style widget that creates an input on click. These are simulated page fixtures, not a live Pearson verification.
