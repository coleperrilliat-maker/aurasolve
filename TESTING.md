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
- Real OpenAI request: no API key was supplied.
- Live signed-in Pearson/MyLab pages, their proprietary graph widgets, and custom drag controls.

Before relying on a real practice page, test Explain, then a single field, and then a short AutoPilot run on known ungraded material. Review actual page feedback. The local lab provides repeatable controls for each implemented action family.
