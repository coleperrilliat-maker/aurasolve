import {runFillAssignment} from '../shared/pilot-engine.js';
import {renderSolution, renderRich, answerLines} from "../shared/render.js";
import {BUILD_VERSION} from '../shared/version.js';
import {sendExtension} from '../shared/messaging.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
$('version').textContent = `AuraSolve ${BUILD_VERSION}`;

let pilotTabId = null, token = 0, busy = false, paused = false, runLog = [];
let chat = [], attachedImage = null;

async function send(message) {
  return sendExtension(pilotTabId === null ? message : {...message, pilotTabId: message.pilotTabId ?? pilotTabId});
}

/* ---------- Views and rail ---------- */
function show(view) {
  document.querySelectorAll('.view').forEach(section => { section.hidden = section.dataset.view !== view; });
  document.querySelectorAll('.rail-btn[data-goto]').forEach(button => button.classList.toggle('active', button.dataset.goto === view));
  if (view === 'history') renderHistory();
  if (view === 'home') $('prompt').focus();
}
document.querySelectorAll('[data-goto]').forEach(button => button.addEventListener('click', () => show(button.dataset.goto)));

/* ---------- Settings ---------- */
const PILOT_IDS = ['speed-run', 'random-timing', 'time-min', 'time-max', 'question-limit', 'solve-budget'];
const CHAT_IDS = ['attach-default', 'keep-history'];
for (const id of ['time-min', 'time-max']) {
  for (let seconds = 10; seconds <= 120; seconds += 10) $(id).add(new Option(seconds + ' seconds', seconds));
}
$('time-min').value = '20'; $('time-max').value = '40';
function paceSummary() {
  const limit = $('question-limit').value === '0' ? 'every unfinished question' : `${$('question-limit').value} question${$('question-limit').value === '1' ? '' : 's'}`;
  const pace = $('speed-run').checked ? 'no wait' : $('random-timing').checked ? `${$('time-min').value}–${$('time-max').value}s per question` : `${$('time-min').value}s per question`;
  $('pace-summary').textContent = `Answers ${limit}, ${pace}.`;
}
function updateTiming() {
  $('timing-settings').hidden = $('speed-run').checked;
  $('max-label').hidden = !$('random-timing').checked;
  if (+$('time-max').value < +$('time-min').value) $('time-max').value = $('time-min').value;
  paceSummary();
}
function saveSettings(key, ids) {
  try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(ids.map(id => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value])))); } catch {}
}
function loadSettings(key, ids) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    for (const [id, value] of Object.entries(saved)) {
      if (!ids.includes(id)) continue;
      if ($(id).type === 'checkbox') $(id).checked = Boolean(value);
      else if ([...$(id).options].some(option => option.value === String(value))) $(id).value = value;
    }
  } catch {}
}
loadSettings('pilotSettings', PILOT_IDS);
loadSettings('chatSettings', CHAT_IDS);
for (const id of PILOT_IDS) $(id).addEventListener('change', () => { updateTiming(); saveSettings('pilotSettings', PILOT_IDS); });
for (const id of CHAT_IDS) $(id).addEventListener('change', () => saveSettings('chatSettings', CHAT_IDS));
updateTiming();

/* ---------- History ---------- */
async function readHistory() {
  try { return (await chrome.storage.local.get('history')).history || []; } catch { return []; }
}
async function saveHistory(entry) {
  if (!$('keep-history').checked) return;
  try {
    const history = await readHistory();
    history.unshift({...entry, time: Date.now()});
    await chrome.storage.local.set({history: history.slice(0, 40)});
  } catch {}
}
async function renderHistory() {
  const history = await readHistory();
  $('history-list').replaceChildren(...history.map(item => {
    const details = el('details');
    const summary = el('summary');
    summary.append(el('strong', '', item.title || 'Answer'), el('small', '', `${item.kind} · ${new Date(item.time).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}`));
    const body = el('div', 'entry');
    body.append(item.result ? renderSolution(item.result, '') : renderRich(item.text));
    details.append(summary, body);
    return details;
  }));
  $('history-empty').hidden = history.length > 0;
}
$('clear-history').onclick = async () => { try { await chrome.storage.local.remove('history'); } catch {} renderHistory(); };

/* ---------- Thread ---------- */
function scrollDown() { requestAnimationFrame(() => { $('feed').scrollTop = $('feed').scrollHeight; }); }
function hideEmpty() { $('empty').hidden = true; }
function addUser(text, image) {
  hideEmpty();
  const row = el('div', 'msg msg-user');
  const bubble = el('div', 'bubble');
  if (image) { const img = el('img'); img.src = image; img.alt = 'Screenshot sent'; bubble.append(img); }
  if (text) bubble.append(text);
  row.append(bubble);
  $('results').append(row);
  scrollDown();
}
function addReply(tag, content, {error = false} = {}) {
  hideEmpty();
  const row = el('div', 'msg');
  const avatar = el('span', 'avatar');
  const icon = el('img'); icon.src = '../../icons/icon-32.png'; icon.alt = '';
  avatar.append(icon);
  const reply = el('div', 'reply' + (error ? ' error' : ''));
  if (tag) reply.append(el('span', 'reply-tag', tag));
  if (typeof content === 'string') reply.append(el('p', '', content)); else reply.append(content);
  row.append(avatar, reply);
  $('results').append(row);
  scrollDown();
  return reply;
}
function status(text) { $('status').textContent = text; }
function working(text, stoppable = true) {
  $('loader').hidden = false;
  $('loader').classList.remove('idle');
  $('stop').hidden = !stoppable;
  status(text);
  $('feed').append($('loader'));
  scrollDown();
}
function idle() { $('loader').hidden = true; $('stop').hidden = true; }

function setBusy(value) {
  busy = value;
  document.querySelectorAll('[data-action], #start-pilot, #send, .chip').forEach(button => { button.disabled = value; });
  document.querySelectorAll('#autopilot-settings input, #autopilot-settings select').forEach(input => { input.disabled = value; });
  $('pause').disabled = !value;
  if (!value) { paused = false; pauseUI(); }
}
function begin() {
  const mine = ++token;
  setBusy(true);
  return () => { if (mine !== token) throw new Error('Stopped.'); };
}
function finish(error) {
  idle();
  setBusy(false);
  if (error && error.message !== 'Stopped.') addReply('', error.message, {error: true});
}
function firstLine(text) {
  const line = String(text || '').split('\n').map(part => part.replace(/\*\*|\\\(|\\\)/g, '').replace(/^answer:\s*/i, '').trim()).find(Boolean) || '';
  return line.length > 80 ? line.slice(0, 77) + '…' : line;
}
function pilotState(text) { $('pilot-state').textContent = text; $('pilot-state').dataset.state = text.toLowerCase(); }
function setActive(action) {
  document.querySelectorAll('[data-action]').forEach(button => button.classList.toggle('active', button.dataset.action === action));
}

/* ---------- Screenshot ---------- */
async function capture() {
  const {image} = await send({type: 'captureScreen'});
  return image;
}
const SCREENSHOT_PROMPT = "Solve the question in this screenshot. If it has several blanks or parts, answer every one.";
async function screenshotSolve(note) {
  setActive('screenshot');
  const live = begin();
  try {
    working('Taking a screenshot…');
    const image = await capture(); live();
    addUser(note ? 'Solve it from my screen' : 'Solve what\'s on my screen', image);
    working('Solving from your screenshot…');
    const reply = (await send({type: 'ask', messages: [...chat.slice(-8), {role: 'user', content: SCREENSHOT_PROMPT}], image, solve: true})).reply; live();
    chat.push({role: 'user', content: SCREENSHOT_PROMPT + ' (screenshot attached)'}, {role: 'assistant', content: reply});
    const body = renderRich(reply);
    if (note) body.prepend(el('p', 'reply-note', note));
    addReply('Screenshot', body);
    saveHistory({kind: 'Screenshot', title: firstLine(reply), text: reply});
    finish();
  } catch (error) { finish(error); }
}

/* ---------- Help me solve ---------- */
const NO_QUESTION = /no supported question|no answer boxes|needs a site adapter|open a practice page|could not detect a supported answer box/i;
function applyMessage(applied) {
  if (applied.retry?.retried) return 'Pearson said that was incorrect. OK was pressed so you can try again.';
  if (applied.retry?.asked) return 'Pearson said that was incorrect. The message was left open.';
  if (applied.checked === 'final') return 'Filled and pressed Final Check.';
  if (applied.advanced === 'check') return 'Filled and pressed Check answer.';
  if (applied.advanced === 'next') return 'Filled and pressed Next.';
  return 'Filled in.';
}
async function helpSolve() {
  setActive('solve');
  const live = begin();
  let result;
  try {
    working('Reading the question…');
    pilotTabId = null;
    await send({type: 'prepareField'}).catch(() => {}); live();
    working('Solving…');
    result = await send({type: 'solve', mode: 'field'}); live();
  } catch (error) {
    if (error.message !== 'Stopped.' && NO_QUESTION.test(error.message || '')) {
      finish();
      return screenshotSolve("I couldn't read a question on this page, so I solved it from a screenshot.");
    }
    return finish(error);
  }
  const reply = addReply('Help me solve', renderSolution(result, ''));
  const {solution} = result;
  if (solution.supported && solution.actions?.length && result.planId) {
    const row = el('div', 'reply-actions');
    const fill = el('button', 'primary', 'Fill it in');
    fill.type = 'button';
    const note = el('p', 'reply-note', 'Fills every answer, then presses the red Check answer button.');
    fill.onclick = async () => {
      fill.disabled = true;
      fill.textContent = 'Filling…';
      try {
        const applied = await send({type: 'apply', planId: result.planId, confirmIncorrect: true});
        note.textContent = applyMessage(applied);
        fill.textContent = 'Done';
      } catch (error) {
        note.textContent = error.message;
        fill.textContent = 'Fill it in';
        fill.disabled = /question changed|page changed/i.test(error.message || '');
      }
    };
    row.append(fill);
    reply.append(row, note);
  } else if (solution.limitation) {
    reply.append(el('p', 'reply-note', 'Fill this one yourself using the steps above.'));
  }
  const answer = answerLines(solution, result.question).join('\n');
  chat.push({role: 'user', content: 'Help me solve this question: ' + String(result.question?.question || '').slice(0, 1500)},
    {role: 'assistant', content: `Answer: ${answer}\n${solution.explanation || ''}`});
  saveHistory({kind: 'Help me solve', title: firstLine(answer) || 'Answer', result: {solution, question: result.question}});
  finish();
}

/* ---------- AutoPilot ---------- */
function pauseUI() {
  $('pause').setAttribute('aria-label', paused ? 'Resume AutoPilot' : 'Pause AutoPilot');
  $('pause').title = paused ? 'Resume AutoPilot' : 'Pause AutoPilot';
  $('pause').innerHTML = paused ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6Z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12"/></svg>';
}
$('pause').onclick = () => {
  paused = !paused; pauseUI(); pilotState(paused ? 'Paused' : 'Running');
  $('pace-status').textContent = paused ? 'Paused. An action already sent may finish first.' : 'Resuming…';
};
function breakdown() {
  if (!runLog.length) return;
  const box = el('div');
  const correct = runLog.filter(item => item.outcome === 'Correct').length, submitted = runLog.filter(item => item.submitted).length;
  box.append(el('p', 'run-head', 'Run breakdown'),
    el('p', 'run-summary', submitted ? `${correct} of ${submitted} checked parts confirmed correct.` : 'No answers were checked.'));
  for (const item of runLog) {
    const details = el('details', 'run-item');
    details.append(el('summary', '', `Question ${item.number} · ${item.outcome}`), renderSolution(item.result, ''));
    box.append(details);
  }
  $('pilot-log').replaceChildren(box);
  $('pilot-log-group').hidden = false;
  saveHistory({kind: 'AutoPilot', title: `${runLog.length} question${runLog.length === 1 ? '' : 's'} · ${correct} correct`, text: runLog.map(item => `- Question ${item.number}: ${item.outcome}`).join('\n')});
}
async function startPilot() {
  const live = begin();
  runLog = []; paused = false; pauseUI();
  const checkpoint = async () => { live(); while (paused) { await sleep(100); live(); } };
  const delay = async ms => { let left = ms; while (left > 0) { await checkpoint(); const step = Math.min(100, left); await sleep(step); live(); if (!paused) left -= step; } await checkpoint(); };
  $('pilot-progress').hidden = false; $('start-pilot').hidden = true; $('pilot-error').hidden = true;
  $('pace-status').textContent = ''; $('progress').value = 0;
  const progress = text => { $('progress-label').textContent = text; };
  pilotState('Running');
  const limit = Number($('question-limit').value), budget = Number($('solve-budget').value);
  try {
    progress('Checking this page…');
    pilotTabId = null;
    const settings = await send({type: 'settingsStatus'}); live();
    if (!settings.configured) throw new Error('AuraSolve Cloud is offline. Try again in a minute.');
    const info = await send({type: 'inspect'}); live();
    pilotTabId = info.tabId;
    await runFillAssignment({
      request: async message => { const response = await send(message); live(); return response; },
      checkpoint, delay, limit, budget,
      pace: async () => {
        const min = Number($('time-min').value), max = Number($('time-max').value);
        const seconds = $('speed-run').checked ? 0 : min + ($('random-timing').checked ? 10 * Math.floor(Math.random() * ((max - min) / 10 + 1)) : 0);
        let left = seconds * 1000;
        while (left > 0) { $('pace-status').textContent = `Next question in ${Math.ceil(left / 1000)}s`; const step = Math.min(250, left); await delay(step); left -= step; }
      },
      onEvent: async event => {
        live();
        if (event.kind === 'solve') {
          progress(`Solving question ${runLog.length + 1}…`);
          $('pace-status').textContent = `${event.spent} of ${budget} AI solves used`;
          $('progress').max = limit || Math.max($('progress').max || 1, runLog.length + 1);
        }
        if (event.kind === 'answer') runLog.push({number: String(runLog.length + 1), result: event.result, outcome: 'Filling', submitted: false});
        if (event.kind === 'retry') {
          if (runLog.length) runLog.at(-1).outcome = 'Incorrect · trying again';
          progress('Marked incorrect. Trying again with the feedback…');
        }
        if (event.kind === 'filled' && runLog.length) {
          const pressed = event.applied?.checked === 'final' ? 'Final Check' : 'Check answer';
          runLog.at(-1).outcome = event.verdict === 'correct' ? 'Correct' : event.verdict === 'incorrect' ? 'Incorrect' : event.applied?.advanced === 'check' ? `Filled and pressed ${pressed}` : event.applied?.advanced === 'next' ? 'Filled and pressed Next' : 'Filled the last question';
          runLog.at(-1).submitted = event.applied?.advanced === 'check';
          $('progress').value = event.completed;
          $('progress').max = limit || event.completed;
          progress(`${event.completed} done`);
        }
        if (event.kind === 'next') progress('Moving to the next question…');
        if (event.kind === 'done') {
          progress(`Finished ${event.completed} question${event.completed === 1 ? '' : 's'}`);
          $('pace-status').textContent = `${event.spent} of ${budget} AI solves used`;
        }
      },
    });
    breakdown();
    pilotState('Done');
  } catch (error) {
    breakdown();
    const stopped = error.message === 'Stopped.';
    pilotState(stopped ? 'Stopped' : 'Error');
    if (!stopped) { $('pilot-error').textContent = error.message; $('pilot-error').hidden = false; }
  } finally {
    setBusy(false);
    $('start-pilot').hidden = false;
  }
}

/* ---------- Ask anything ---------- */
function setAttachment(image) {
  attachedImage = image;
  $('attached').hidden = !image;
  $('attach').setAttribute('aria-pressed', String(Boolean(image)));
  if (image) $('attached-img').src = image;
}
$('attach').onclick = async () => {
  if (attachedImage) return setAttachment(null);
  $('attach').disabled = true;
  try { setAttachment(await capture()); }
  catch (error) { addReply('', error.message, {error: true}); }
  finally { $('attach').disabled = false; }
};
$('attached-remove').onclick = () => setAttachment(null);

function growPrompt() {
  const box = $('prompt');
  box.style.height = 'auto';
  box.style.height = Math.min(box.scrollHeight, 140) + 'px';
  $('send').disabled = busy || !box.value.trim();
}
$('prompt').addEventListener('input', growPrompt);
$('prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); }
});

async function askQuestion(text, wantScreen) {
  if (busy || !text.trim()) return;
  show('home');
  const live = begin();
  try {
    let image = attachedImage;
    if (!image && (wantScreen || $('attach-default').checked)) {
      working('Taking a screenshot…');
      image = await capture().catch(() => null); live();
    }
    setAttachment(null);
    $('prompt').value = ''; growPrompt();
    addUser(text, image);
    working('Thinking…');
    const message = {role: 'user', content: text};
    const reply = (await send({type: 'ask', messages: [...chat.slice(-10), message], image})).reply; live();
    chat.push({role: 'user', content: image ? text + ' (screenshot attached)' : text}, {role: 'assistant', content: reply});
    addReply('', renderRich(reply));
    saveHistory({kind: 'Chat', title: text.slice(0, 80), text: `**You:** ${text}\n${reply}`});
    finish();
  } catch (error) { finish(error); }
  growPrompt();
}
$('composer').addEventListener('submit', event => { event.preventDefault(); askQuestion($('prompt').value, false); });
document.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => askQuestion(chip.dataset.prompt, chip.hasAttribute('data-attach'))));

/* ---------- Top actions ---------- */
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
  if (busy) return;
  if (button.dataset.action !== 'autopilot') show('home');
  if (button.dataset.action === 'screenshot') screenshotSolve();
  if (button.dataset.action === 'solve') helpSolve();
  if (button.dataset.action === 'autopilot') show('autopilot');
}));
$('start-pilot').onclick = () => { if (!busy) startPilot(); };
$('stop-pilot').onclick = async () => {
  token++;
  try { await send({type: 'stop'}); } catch {}
  $('pace-status').textContent = 'Stopped. Starting again resumes from the current page.';
};
$('stop').onclick = async () => {
  token++;
  setBusy(false);
  idle();
  try { await send({type: 'stop'}); } catch {}
  addReply('', 'Stopped. AutoPilot progress is saved, so starting again resumes from this page.');
};
$('new-chat').onclick = () => {
  if (busy) return;
  chat = []; runLog = [];
  $('results').replaceChildren();
  $('empty').hidden = false;
  setActive(null);
  setAttachment(null);
  show('home');
};

/* ---------- Troubleshoot ---------- */
let inspectionReport = null;
$('inspect-page').onclick = async () => {
  $('inspect-page').disabled = true;
  try {
    inspectionReport = await send({type: 'inspectPage'});
    $('inspection-summary').textContent = inspectionReport.frames.map(frame => `Frame ${frame.frameId}: ${frame.fields.length} answer boxes, ${frame.controls.length} buttons; diagram ${frame.visual ? 'found' : 'not found'}.`).join('\n');
    $('inspection-summary').hidden = false; $('save-inspection').hidden = false;
  } catch (error) {
    $('inspection-summary').textContent = error.message; $('inspection-summary').hidden = false;
  } finally { $('inspect-page').disabled = false; }
};
$('save-inspection').onclick = () => {
  if (!inspectionReport) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(inspectionReport, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'aurasolve-page-inspection.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/* ---------- Close and cloud status ---------- */
$('close').onclick = async () => {
  if (busy) { token++; await send({type: 'stop'}).catch(() => {}); }
  const win = await chrome.windows.getCurrent();
  await chrome.sidePanel.close({windowId: win.id});
};
growPrompt();
try {
  const health = await send({type: 'settingsStatus'});
  $('cloud').textContent = health.configured ? 'Online' : 'Offline';
  $('cloud').className = health.configured ? 'online' : 'offline';
} catch {
  $('cloud').textContent = 'Offline';
  $('cloud').className = 'offline';
}
