# AuraSolve — Practice Tutor

A fresh, dependency-free Chrome Manifest V3 extension backed by **AuraSolve Cloud** on Railway. Original implementation; no AskLabby code, branding, account system, or assets are included. Source is separated by responsibility and runs directly in Chrome; no compilation is needed.

## How it works

```
Chrome extension  →  Railway API  →  OpenAI
                    (your key lives here)
```

Users install the extension and start practicing. **No API key in Chrome.** Your OpenAI key stays in Railway environment variables.

## Deploy to Railway (one-time)

1. Push this repo to GitHub (already done at `coleperrilliat-maker/aurasolve`).
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select `aurasolve`.
3. In Railway → **Variables**, add:
   - `OPENAI_API_KEY` — your OpenAI API key
   - `OPENAI_MODEL` — e.g. `gpt-4.1`
   - `CLIENT_KEY` — a long random string (e.g. run `openssl rand -hex 32`)
4. Railway → **Settings** → **Networking** → **Generate Domain**. Copy the public URL (e.g. `https://aurasolve-production.up.railway.app`).
5. Set Railway variable `CLIENT_KEY` to match `src/shared/config.js` (already configured for `aurasolve-production.up.railway.app`).
6. **Reload the extension** in Chrome after pulling updates.

Railway runs `npm start` (`node server/index.js`). Health check: `/api/v1/health`.

### Local API dev

```sh
cp .env.example .env   # fill in OPENAI_API_KEY and CLIENT_KEY
npm start              # http://localhost:8787
```

Point `src/shared/config.js` at `http://localhost:8787` while developing, then switch back to your Railway URL before sharing the extension.

## Install the extension (no ZIP)

One-time setup — after this, code updates are just `git pull` + **Reload** in Chrome.

1. Clone once (or use the copy already at `~/Projects/aurasolve`):
   ```sh
   git clone git@github.com:coleperrilliat-maker/aurasolve.git ~/Projects/aurasolve
   ```
2. Open `chrome://extensions` → enable **Developer mode**.
3. Click **Load unpacked** → select **`~/Projects/aurasolve`** (the folder with `manifest.json`).
4. Pin AuraSolve. Open **Settings** — server should show **Online**.
5. Refresh any open practice page.

**After updates:** in Terminal run `git -C ~/Projects/aurasolve pull`, then click **Reload** on the AuraSolve card in `chrome://extensions`. No ZIP, no re-download.

No OpenAI setup in the browser. Usage is billed through your Railway server.

## Modes

**AutoPilot:** Starts at the question and part currently visible. The default **All unfinished** run follows the Pearson question list, skips questions already marked correct, and returns to earlier incomplete questions after reaching the end. It uses the explicitly labeled Check answer control for each part, then Continue or the question list to advance. It closes answer feedback with OK and chooses No on the specific incomplete-question warning. Partial/incorrect completed questions use Similar question, up to five times, to try for full credit. It never clicks Save best score or final assignment Submit; unlabeled command metadata is not enough to authorize an answer check.

AutoPilot keeps a local checkpoint before submitting, so a reopened panel reads the live page before continuing. If a submission's result is uncertain, it waits and pauses instead of replaying it. Keep the question tab and panel open while running; reopen and start again to resume after closing them. A new run is bound to its original tab and invalidates older runs.

**Fill Math:** On a math question, the inline button captures one screenshot, solves it, and fills supported math inputs. It verifies each value by reading it back, asks before replacing an existing answer, and does not click Check answer or Submit. It stays hidden on English and writing questions. Disabled or completed fields are excluded.

**Explain:** Reads the current question and returns a worked explanation without changing answers.

**Cost controls:** Navigation and score reading make no AI calls. The default assignment budget is 200 solves (select 50, 200, or 500); usage and retry counts survive a panel reopen. Each solve uses at most two model calls. A narrow arithmetic parser checks unambiguous calculations locally after one model call; other actionable answers retain independent verification. Repeated rejected answers are blocked, and page feedback is provided when reconsidering a wrong answer. These checks do not guarantee answer accuracy. For an account-wide dollar limit, configure the API account's budget separately.

Pause waits before the next action. Stop cancels pending model requests and prevents further actions, but cannot undo a submission already sent. Unsupported controls, unreadable figures, exhausted attempts, missing feedback, or model disagreement pause with a reason.

## Honor code

AutoPilot requires typing **This is not a graded homework assignment** and signing your name. Capitalization, extra spaces, and a trailing period are ignored. The signature is tied to this page for up to four hours, and cleared on Stop or tab close. Fill and Explain do not require it. Use the tool where your course permits it.

## Supported controls and limits

| Feature | Implemented support |
| --- | --- |
| Text answers | Native text/number inputs, textareas, and plain contenteditable controls; focus, input/change, blur, and read-back checks |
| Choices | Native radio buttons, checkboxes, single-select dropdowns |
| Number lines | Horizontal ARIA sliders with numeric min/max/current values and an exposed step; every write is read back |
| Graphs | One point on an explicit coordinate-grid adapter; not arbitrary graph canvases, lines, curves, or regions |
| Drag and drop | Explicit draggable/drop adapters with HTML5 drag events and confirmed containment; ARIA drop targets are recognized |
| Pearson detection | Common question-container selectors, text, accessible math labels, and accessible matching frames |
| Math editors | Capability-checked MathQuill, MathLive, WIRIS, Pearson focus inputs, and Dojo widgets. Each write is read back; editors without a value API stay manual. |
| Fill-in menus | Native selects, Dojo widgets, ARIA comboboxes/listboxes, and older Pearson popups discovered after opening; exact options and the retained selection are verified |
| Pearson graph widgets | Proprietary graph/drag controls still need dedicated adapters |
| Images | Text/alt labels plus a question screenshot for visual problems when capture succeeds |
| AutoPilot | Pearson multipart progress, per-question correctness, all-frame feedback, Continue, Similar question, and remaining-question navigation; ambiguous states pause |

This is a working implementation with a local practice lab, not universal automation for every Pearson question. Pearson's help page describes user interactions, not the proprietary DOM/API contracts required to automate them. AuraSolve solves and explains visual questions from a screenshot, but only fills a graph, number line, menu, or drag control when the page exposes bounds/options/targets and the result can be read back. Calculator, data, and Show work are student helpers rather than answer types and are not automated. The live Pearson DOM was inspected read-only; the submission flow was exercised on browser fixtures, not a complete live assignment. Detection prefers recognized question containers and falls back to a container around visible answer controls. If several questions are visible, click a field in the intended question to disambiguate.

## Try the included practice lab

With Node.js 20 or newer installed, open a terminal in this folder:

```sh
npm start          # AuraSolve Cloud API (required for AI)
npm run demo       # practice lab on http://localhost:4318
```

Open `http://localhost:4318`. There are five questions: a text answer, a radio choice, a plotted point, an even/odd drag, and a dropdown. They are real local practice controls, not prerecorded results. The title toggle changes the demo label; the signed declaration, not automatic title classification, controls AutoPilot consent. No packages need to be installed. Press Ctrl+C in the terminal to stop the lab.

## Organization

```text
manifest.json                  Chrome entry points and permissions
server/index.js                Railway HTTP API
server/openai.js               OpenAI Responses API (server-side only)
src/background/worker.js       Request routing, consent, cancellation, plans
src/background/api.js          Extension → Railway client
src/content/detection.js       Question, field, feedback, and button detection
src/content/actions.js         Validated field changes and practice navigation
src/content/ui.js              Inline Fill Math button
src/shared/pilot-engine.js      Durable AutoPilot controller
src/shared/player-state.js      Question/part navigation decisions
src/content/player.js           Pearson progress and question-list reader
src/popup/popup.js              AutoPilot controls and results
src/content/ui.css             White-and-blue isolated sidebar styling
src/content/app.js             Content runtime assembly
src/content/bootstrap.js       Content module loader
src/shared/config.js           Railway URL + client key (update after deploy)
src/shared/policy.js           Practice classification and confirmation checks
src/shared/solution.js         Answer schema and action validation
src/options/                   Cloud status and model preference
demo/                          Five-question local practice lab
tests/                         Policy, action, API, and mocked worker tests
scripts/                       Validation and demo server
railway.toml                   Railway deploy config
```

Native JavaScript ES modules and CSS keep the loadable source readable and avoid shipping framework build dependencies. There is no React/TypeScript build pipeline in this edition.

### Adding a site adapter

Start in `detection.js` with a verified question-container selector. Add site-specific control extraction and read-back validation to `actions.js`; never infer screen coordinates without known graph bounds. The demo's graph contract is `data-aura-graph="point"`, numeric `data-x-min/x-max/y-min/y-max`, and read-back `data-aura-point-x/y`. The drag contract is `data-aura-draggable` plus `data-aura-drop`, with the moved element inside its destination after a drop. These markers are an adapter contract, not indicators of grading status.

Do not add generic clicks returned by the model. Action targets must exist in the current snapshot, stale plans must fail, and every new control should have an explicit read-back check before submitting.

## Privacy and permissions

- No accounts, subscriptions, or analytics in the extension.
- Detected questions and field descriptors are sent to your Railway server, then to OpenAI. Conversation storage is disabled in the API request.
- The OpenAI API key lives only on Railway, not in Chrome.
- The user signature stays in Chrome session storage. Run checkpoints (question IDs, attempt counts, and recent rejected answers) stay in trusted extension local storage for resuming. Screenshots and credentials are not saved in those checkpoints.
- Automatic content-script access is limited to the listed Pearson-family domains and the local lab. The toolbar uses activeTab permission for other pages.

## Verification

```sh
npm test
npm run check
```

Tests cover multipart resume/retries, cost limits, consent expiry/page binding, model-action validation, graph bounds, native field events, changed-question rejection, complete-field submission, hidden-tab stopping, Railway API client behavior, and mocked worker flows. These do not replace live browser/site integration testing. See `TESTING.md` for build results.

## Troubleshooting

- **Manifest missing:** select the extracted folder directly containing `manifest.json`.
- **Server offline:** confirm Railway is deployed, variables are set, and `src/shared/config.js` matches your domain and `CLIENT_KEY`.
- **No question found:** the site needs a selector/adapter or is inside a frame the extension cannot access.
- **Filling unavailable:** confirm the practice declaration and inspect the displayed limitation. Unsupported answer editors require a dedicated adapter.
- **401 / 429:** check Railway `OPENAI_API_KEY`, API credits, limits, and model access.
- **No visible buttons:** refresh the page or click the toolbar icon. Chrome internal pages and Chrome Web Store pages cannot be injected.
- **Graph/drag stopped:** complete it manually; do not assume a generic canvas can accept automated actions.
- **After code changes:** reload the extension at `chrome://extensions` — commits to GitHub do not update Chrome automatically.

API documentation used: https://developers.openai.com/api/reference/resources/responses/methods/create
Chrome documentation used: https://developer.chrome.com/docs/extensions/reference/api/scripting and https://developer.chrome.com/docs/extensions/reference/api/storage


## 1.13.5 filling and tutor fixes

- Both the page panel and toolbar popup render Answer and Explanation before attempting to fill, so an editor or Submit failure no longer hides the tutor.
- Nested question containers no longer count as separate questions. A single supported text/select field is selected automatically.
- Plain editable fields, exposed MathQuill editors, and Pearson-style Dojo widgets with a real value setter have explicit adapters. MathQuill receives raw LaTeX; normal inputs receive plain text. Values are read back before success is reported.
- A question iframe can use Submit/Next and feedback in its parent frame. Ambiguous buttons and changed questions stop the operation.
- LaTeX backslashes in the tutor prompt are preserved.

These changes have automated regression coverage but are not a claim of compatibility with every MyLab product. Graphs, custom dropdowns, and editors without an accessible supported API may still require manual input. See TESTING.md for verification limits.

### 1.13.6: Fill-field follow-up

Field actions now carry page errors back intact, so an unsupported or stale editor no longer becomes the unhelpful “The page action failed” message. Pearson equation-editor discovery also recognizes widget IDs and the Dojo registry. The Fill button has a browser regression fixture proving that a selected native input receives the value and is not submitted. Live proprietary Pearson widgets still need verification. After installing an update, reload the extension **and refresh the already-open lab tab** to replace its old page script.

### 1.13.7: automatic answer-field selection

Fill no longer requires clicking the answer box first. It inspects the detected question, prefers an empty supported text/dropdown field, and can activate a Pearson-style equation widget that creates its input only when clicked. A manually selected supported field still takes precedence. If no supported field is found, it explains the question and reports that detection limitation instead of asking for a click repeatedly. Custom graph widgets and automatic multiple-choice selection are not added by this change.

### 1.13.8: release visibility and Pearson layouts

The panel and popup now display their build number. Question detection recognizes additional Pearson player layout IDs and Mastering question bodies, while frame selection distinguishes an automatic field choice from a manual selection. The click-first gate remains removed. See `docs/asklabby-comparison.md` for the ZIP inspection findings and the limit imposed by its missing remote adapters.

### 1.13.9: recovery after reloading the extension

The old page's emoji panel can lose its Chrome messaging context when the extension is reloaded or removed. All messaging paths now handle a missing runtime and invalidated context without dereferencing undefined. The panel offers Refresh this page and disables further actions until refreshed. It never reloads a lab or retries a write automatically. Updating the extension still requires refreshing existing lab tabs.
