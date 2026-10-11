# AuraSolve — Practice Tutor

A fresh, dependency-free Chrome Manifest V3 extension. Original implementation; no AskLabby code, branding, backend, account system, or assets are included. Source is separated by responsibility and runs directly in Chrome; no compilation is needed.

## Install

1. Unzip `AuraSolve-1.0.1.zip` into a folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the folder that directly contains `manifest.json`. Do not select the ZIP or its parent folder.
4. Pin AuraSolve. Open its extension options or click **API key & settings** in the sidebar.
5. Enter your OpenAI API key and a Responses API model with structured-output support. The default is `gpt-4.1-mini`; availability depends on your API account. Click **Save settings**.
6. Refresh any already-open practice page. On other HTTP(S) websites, click the toolbar icon to attach AuraSolve for that visit.

No hosted backend is required. API calls go from the extension service worker directly to OpenAI. OpenAI API usage is billed separately from ChatGPT.

### If you prefer an .env file

Copy `.env.example` to `.env`, enter `OPENAI_API_KEY` and optionally `OPENAI_MODEL`, then import it using the Settings page and click Save. Chrome does not automatically load `.env` files. Never share your real `.env` or API key. The packaged ZIP contains only the placeholder example.

## Modes

**✈️ AutoPilot:** On a clearly identified practice page, check the practice-only declaration and type your name. AuraSolve solves one question, fills supported answers, clicks the page's check/submit button, displays a tutor paragraph, and waits for explicit correct feedback. After a short reading pause, it clicks Next. Each run is limited to five questions. A wrong answer, uncertain result, unsupported control, changed page, missing feedback, expired confirmation, or ambiguous button stops the run. It does not retry incorrect answers automatically. Navigating the full page ends the current run.

**✍️ Fill a field:** Click a supported field on the page, then choose Fill a field. Confirm practice status, review the generated preview, and click Fill this field. This mode never submits. Graph points and draggable items count as fields only when an explicit adapter exists.

**💡 Explain:** Reads the detected question and returns a paragraph explaining the solution without filling, submitting, or advancing.

Closing the sidebar during a running request, switching tabs, or pressing Stop cancels further work. Already completed fills or submissions cannot be undone by Stop. A synchronous fill-and-submit operation already in progress may finish before cancellation is processed.

## Practice-only behavior

The confirmation is page-bound, expires in 30 minutes, and is cleared on Stop or tab close. The extension checks titles, headings, breadcrumbs, page paths, and grading attributes in accessible frames before actions. Exam, quiz, test, assessment, homework, grading, proctoring, and related indicators block filling and AutoPilot. A positive practice or study-plan indicator is required; unknown pages remain explain-only. A signed notice never overrides a detected grading indicator.

These are conservative heuristics, not a guarantee that a site is ungraded. Some practice pages will be blocked. Hidden/inaccessible frames or misleading site text can prevent reliable classification. Use only activities you know are ungraded; do not represent this extension as enforcing a school's grading policy.

## Supported controls and limits

| Feature | Implemented support |
| --- | --- |
| Text answers | Native text/number inputs and textareas, using native value setters with input/change events |
| Choices | Native radio buttons, checkboxes, single-select dropdowns |
| Graphs | One point on an explicit coordinate-grid adapter; not arbitrary graph canvases, lines, curves, or regions |
| Drag and drop | Explicit draggable/drop adapters with HTML5 drag events and confirmed containment |
| Pearson detection | Common question-container selectors, text, accessible math labels, and accessible matching frames |
| Pearson graph/math widgets | Not verified; custom math editors and proprietary graph/drag controls need dedicated adapters |
| Images | Alt text only; no screenshot vision or OCR |
| AutoPilot | Exactly identified check/submit and next controls; visible correctness feedback required |

This is a working implementation with a local practice lab, not universal automation for every Pearson question. It has not been tested against a signed-in live Pearson activity or with a real API key in the build environment. Detection refuses pages without a recognized question container. If several questions are visible, click a field in the intended question to disambiguate.

## Try the included practice lab

With Node.js 20 or newer installed, open a terminal in this folder:

```sh
npm run demo
```

Open `http://localhost:4318`. There are five questions: a text answer, a radio choice, a plotted point, an even/odd drag, and a dropdown. They are real local practice controls, not prerecorded results. AI features require your key. Toggle **Simulate graded assignment** to verify the mutation gate. No packages need to be installed. Press Ctrl+C in the terminal to stop the lab.

## Organization

```text
manifest.json                  Chrome entry points and permissions
src/background/worker.js       Request routing, consent, cancellation, plans
src/background/openai.js       Responses API and structured answer generation
src/content/detection.js       Question, field, feedback, and button detection
src/content/actions.js         Validated field changes and practice navigation
src/content/ui.js              Sidebar and bounded AutoPilot controller
src/content/ui.css             White-and-blue isolated sidebar styling
src/content/app.js             Content runtime assembly
src/content/bootstrap.js       Content module loader
src/shared/policy.js           Practice classification and confirmation checks
src/shared/solution.js         Answer schema and action validation
src/options/                   API-key and model settings
demo/                          Five-question local practice lab
tests/                         Policy, action, and mocked API tests
scripts/                       Validation and demo server
```

Native JavaScript ES modules and CSS keep the loadable source readable and avoid shipping framework build dependencies. There is no React/TypeScript build pipeline in this edition.

### Adding a site adapter

Start in `detection.js` with a verified question-container selector. Add site-specific control extraction and read-back validation to `actions.js`; never infer screen coordinates without known graph bounds. The demo's graph contract is `data-aura-graph="point"`, numeric `data-x-min/x-max/y-min/y-max`, and read-back `data-aura-point-x/y`. The drag contract is `data-aura-draggable` plus `data-aura-drop`, with the moved element inside its destination after a drop. These markers are an adapter contract, not indicators of grading status.

Do not add generic clicks returned by the model. Action targets must exist in the current snapshot, stale plans must fail, and every new control should have an explicit read-back check before submitting.

## Privacy and permissions

- No accounts, subscriptions, analytics, remote code, or AuraSolve server.
- Only the detected question and field descriptors are sent to OpenAI when requested; conversation storage is disabled in the API request. This does not change OpenAI's separate API data-retention policies.
- The API key is saved in this Chrome profile, not encrypted and not synced. Content scripts cannot access extension local storage. Use Remove key in Settings to erase it.
- The user signature stays in Chrome session storage. Tutor notes stay in the current tab's sidebar and are lost on refresh.
- Automatic content-script access is limited to the listed Pearson-family domains and the local lab. The toolbar uses activeTab permission for other pages. Extension settings and OpenAI are not sent site login cookies.

## Verification

```sh
npm test
npm run check
```

Tests cover practice blocking, consent expiry/page binding, model-action validation, graph bounds, native field events, changed-question rejection, complete-field submission, hidden-tab stopping, and mocked OpenAI responses. These do not replace live browser/site integration testing. See `TESTING.md` for build results.

## Troubleshooting

- **Manifest missing:** select the extracted folder directly containing `manifest.json`.
- **No question found:** the site needs a selector/adapter or is inside a frame the extension cannot access.
- **Explain only:** the activity is unknown or has a grading indicator.
- **401 / 429:** check the API key, API credits, limits, and model access in your OpenAI account.
- **No visible buttons:** refresh the page or click the toolbar icon. Chrome internal pages and Chrome Web Store pages cannot be injected.
- **Graph/drag stopped:** complete it manually; do not assume a generic canvas can accept automated actions.

API documentation used: https://developers.openai.com/api/reference/resources/responses/methods/create
Chrome documentation used: https://developer.chrome.com/docs/extensions/reference/api/scripting and https://developer.chrome.com/docs/extensions/reference/api/storage
