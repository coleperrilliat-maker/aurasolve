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

## 1.13.8

37 Node tests pass; four Chromium fixtures pass; syntax/manifest validation passes. Release tests ensure the visible build, manifest and package versions agree and the removed click-first gate is absent from both Fill entry points. The browser suite verifies the visible panel build number. Live signed-in MyMathLab remains unverified.

## 1.13.9: disconnected extension runtime

41 Node tests and five Chromium fixtures pass; syntax/manifest checks pass. A browser fixture removes chrome.runtime after creating the panel, then clicks Fill and verifies a refresh recovery button, a clear reconnect message, and disabled action buttons instead of a sendMessage TypeError. The messaging helper also tests context invalidation, absent replies, successful replies and real application errors. Writes are not retried automatically. This verifies recovery behavior, not live Pearson compatibility.

## 1.15.0 — resumable Pearson AutoPilot (2026-10-12)

Validation: `npm test` passed 84 tests; `npm run check` passed JavaScript syntax and manifest checks. `git diff --check` passed. These are workflow/validation checks, not an answer-accuracy benchmark.

New automated scenarios cover resuming Part 3 without restarting, OK feedback, Continue versus Next despite reused Pearson command attributes, partial credit, Similar retries, returning to earlier incomplete questions, No on the incomplete-question warning, already-correct questions, unknown scores, delayed feedback, pending-submit recovery, three-attempt/five-similar limits, cumulative request budgets, Stop during solve, changed questions, switched tabs, and replaced runs. Verification tests cover independent disagreement, repeated rejected answers, local arithmetic, and retaining two model calls for diagrams or ambiguous prompts.

In Chrome, `node scripts/browser-test-server.js` served `/tests/browser-scenarios.html`. The actual DOM reader and content actions completed a simulated flow from Question 21's last part, handled the leave warning, moved to Question 22, continued after a wrong first part, generated one Similar retry, and finished both questions. Exactly five mock solves and five submissions occurred. No locked field was overwritten. The browser suite was rerun against the final source.

The same server's `/tests/popup-fixture.html` exercised the actual panel. It displayed Question 21, Part 3 of 3, paused while the mock solve finished (zero submissions), resumed once (one submission), respected the one-question limit, and displayed the correct part-level result. The existing optional Playwright suite's panel transport fixture was updated for the new protocol; that optional suite was not rerun in this environment because Playwright is not installed.

Read-only inspection of the signed-in Pearson player established the live heading, Part n of n, question-label status, disabled-field, and command-button structures. No real assignment answers were submitted during verification. Proprietary graphs, inaccessible editors, native browser dialogs, unavailable Similar retries, and changed site layouts may still require manual work. The engine pauses on ambiguous transitions or unconfirmed submissions rather than guessing or replaying them. Keep the tab and panel open; after reopening, Start reads the live page and the saved checkpoint.

Pearson references consulted:
- https://help.pearsoncmg.com/xl/student/bb/Content/do_homework.htm
- https://help.pearsoncmg.com/mfdl/student/player/Content/use_player_html5.htm
- https://help.pearsoncmg.com/mfdl/student/Content/player_activity_html.htm

Navigation and score reading use no AI. The budget is 50, 200 (default), or 500 solves per assignment, with at most two model calls per solve. Failed requests consume a budget slot conservatively. This is a client workflow limit, not an account-wide dollar cap; actual costs depend on model, token/image size, and usage from other clients.

## 1.15.1 — honor the extension's selected model

The production health check exposed a legacy Railway `OPENAI_MODEL=gpt-4.1-mini` default overriding the extension's gpt-4.1 preference. Model selection now uses the explicit extension preference first, with the Railway model as a fallback, matching the existing Settings UI contract. The example environment now defaults to gpt-4.1. A regression checks the actual OpenAI request payload in both cases without spending API credits. All 85 tests and syntax/manifest checks passed.
