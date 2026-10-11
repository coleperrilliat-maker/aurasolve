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
   - `OPENAI_MODEL` — e.g. `gpt-4.1-mini`
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

**✈️ AutoPilot:** On a clearly identified practice page, check the practice-only declaration and type your name. AuraSolve solves one question, fills supported answers, clicks the page's check/submit button, displays a tutor paragraph, and waits for explicit correct feedback. After a short reading pause, it clicks Next. Each run is limited to five questions. A wrong answer, uncertain result, unsupported control, changed page, missing feedback, expired confirmation, or ambiguous button stops the run. It does not retry incorrect answers automatically. Navigating the full page ends the current run.

**✍️ Fill a field:** Click a supported field on the page, then choose Fill a field. Confirm practice status; the answer and explanation appear, then the selected supported field is filled. Review it before clicking Submit & next. When there is exactly one supported text field or dropdown, it is selected automatically. Graph points and draggable items count as fields only when an explicit adapter exists.

**💡 Explain:** Reads the detected question and returns a paragraph explaining the solution without filling, submitting, or advancing.

Closing the sidebar during a running request, switching tabs, or pressing Stop cancels further work. Already completed fills or submissions cannot be undone by Stop. A synchronous fill-and-submit operation already in progress may finish before cancellation is processed.

## Honor code

AuraSolve does not try to guess whether a page is graded. Before **Fill a field** or **AutoPilot** runs, you must type exactly **This is not a graded homework assignment** and sign your name. Capitalization, extra spaces, and a trailing period are ignored; any other wording is rejected. **Explain** never needs a signature because it doesn't change the page.

The signature is tied to the page, lasts 30 minutes, and is cleared on Stop or when the tab closes. You are responsible for using fill and AutoPilot only where your course allows it.

## Supported controls and limits

| Feature | Implemented support |
| --- | --- |
| Text answers | Native text/number inputs, textareas, and plain contenteditable controls; focus, input/change, blur, and read-back checks |
| Choices | Native radio buttons, checkboxes, single-select dropdowns |
| Graphs | One point on an explicit coordinate-grid adapter; not arbitrary graph canvases, lines, curves, or regions |
| Drag and drop | Explicit draggable/drop adapters with HTML5 drag events and confirmed containment |
| Pearson detection | Common question-container selectors, text, accessible math labels, and accessible matching frames |
| Math editors | Capability-checked MathQuill API and Pearson-style Dojo widgets with a real value setter; unsupported proprietary editors remain manual. Not verified on live Pearson. |
| Pearson graph widgets | Proprietary graph/drag controls still need dedicated adapters |
| Images | Text/alt labels plus a question screenshot for visual problems when capture succeeds |
| AutoPilot | Exactly identified check/submit and next controls in the question or parent frame; visible correctness feedback required |

This is a working implementation with a local practice lab, not universal automation for every Pearson question. It has not been tested against a signed-in live Pearson activity. Detection prefers recognized question containers and falls back to a container around visible answer controls. If several questions are visible, click a field in the intended question to disambiguate.

## Try the included practice lab

With Node.js 20 or newer installed, open a terminal in this folder:

```sh
npm start          # AuraSolve Cloud API (required for AI)
npm run demo       # practice lab on http://localhost:4318
```

Open `http://localhost:4318`. There are five questions: a text answer, a radio choice, a plotted point, an even/odd drag, and a dropdown. They are real local practice controls, not prerecorded results. Toggle **Simulate graded assignment** to verify the mutation gate. No packages need to be installed. Press Ctrl+C in the terminal to stop the lab.

## Organization

```text
manifest.json                  Chrome entry points and permissions
server/index.js                Railway HTTP API
server/openai.js               OpenAI Responses API (server-side only)
src/background/worker.js       Request routing, consent, cancellation, plans
src/background/api.js          Extension → Railway client
src/content/detection.js       Question, field, feedback, and button detection
src/content/actions.js         Validated field changes and practice navigation
src/content/ui.js              Sidebar and bounded AutoPilot controller
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
- The user signature stays in Chrome session storage. Tutor notes stay in the current tab's sidebar and are lost on refresh.
- Automatic content-script access is limited to the listed Pearson-family domains and the local lab. The toolbar uses activeTab permission for other pages.

## Verification

```sh
npm test
npm run check
```

Tests cover practice blocking, consent expiry/page binding, model-action validation, graph bounds, native field events, changed-question rejection, complete-field submission, hidden-tab stopping, Railway API client behavior, and mocked worker flows. These do not replace live browser/site integration testing. See `TESTING.md` for build results.

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
