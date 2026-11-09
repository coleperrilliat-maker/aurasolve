import {runFillAssignment} from '../shared/pilot-engine.js';
import {renderSolution, renderRich, answerLines} from "../shared/render.js";
import {BUILD_VERSION} from '../shared/version.js';
import {sendExtension} from '../shared/messaging.js';
import {account as loadAccount, plans as loadPlans, startSignIn, finishSignIn, signOut, checkoutUrl, portalUrl} from '../background/api.js';
import {DEFAULT_OVERLAY, OVERLAY_COLORS, OVERLAY_ZONES, normalizeOverlay, readOverlay, writeOverlay} from '../shared/overlay.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
$('version').textContent = `AuraSolve ${BUILD_VERSION}`;

let pilotTabId = null, token = 0, busy = false, runLog = [];
let chat = [], attachedImage = null;

async function send(message) {
  return sendExtension(pilotTabId === null ? message : {...message, pilotTabId: message.pilotTabId ?? pilotTabId});
}

/* ---------- Views and rail ---------- */
function show(view) {
  document.querySelectorAll('.view').forEach(section => { section.hidden = section.dataset.view !== view; });
  document.querySelectorAll('.rail-btn[data-goto]').forEach(button => button.classList.toggle('active', button.dataset.goto === view));
  if (view === 'history') renderHistory();
  if (view === 'account') refreshAccount();
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
  if (!busy) { $('progress-label').textContent = `AutoPilot: Ready to answer ${limit}, ${pace}. Press play to start.`; $('progress-time').textContent = ''; }
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
  if (error && PAYWALL.test(error.message || '')) show('account');
}
function firstLine(text) {
  const line = String(text || '').split('\n').map(part => part.replace(/\*\*|\\\(|\\\)/g, '').replace(/^answer:\s*/i, '').trim()).find(Boolean) || '';
  return line.length > 80 ? line.slice(0, 77) + '…' : line;
}
function pilotState(text) { $('pilot-progress').dataset.state = text.toLowerCase(); }
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

async function regionSolve() {
  setActive('screenshot');
  const live = begin();
  try {
    working('Drag on the page to select an area…', true);
    const result = await send({type: 'regionSolve'}); live();
    if (result?.cancelled) {
      idle();
      setBusy(false);
      return;
    }
    addUser('Solve this area', result.image);
    const body = renderRich(result.reply);
    addReply('Selection', body);
    chat.push({role: 'user', content: SCREENSHOT_PROMPT + ' (selected area)'}, {role: 'assistant', content: result.reply});
    saveHistory({kind: 'Selection', title: firstLine(result.reply), text: result.reply});
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
// The pill reads "AutoPilot: <status> (12.3s)…" with a live per-question timer.
const pilotClock = {text: 'Starting', verb: '', since: 0, timer: 0, done: false};
function drawPilot() {
  $('progress-label').textContent = `AutoPilot: ${pilotClock.verb ? pilotClock.verb + ' ' : ''}${pilotClock.text}`;
  const seconds = pilotClock.since ? ((Date.now() - pilotClock.since) / 1000).toFixed(1) : '0.0';
  $('progress-time').textContent = pilotClock.done ? '' : `(${seconds}s)…`;
}
function pilotStatus(text, {restart = false, done = false, verb = ''} = {}) {
  pilotClock.text = text;
  pilotClock.verb = verb;
  pilotClock.done = done;
  if (restart || !pilotClock.since) pilotClock.since = Date.now();
  clearInterval(pilotClock.timer);
  if (!done) pilotClock.timer = setInterval(drawPilot, 100);
  drawPilot();
}
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
  runLog = [];
  const checkpoint = async () => { live(); };
  const delay = async ms => { let left = ms; while (left > 0) { const step = Math.min(100, left); await sleep(step); live(); left -= step; } };
  $('start-pilot').hidden = true; $('stop-pilot').hidden = false; $('pilot-error').hidden = true;
  pilotClock.since = 0;
  pilotStatus('Starting', {restart: true});
  pilotState('Running');
  const limit = Number($('question-limit').value), budget = Number($('solve-budget').value);
  let current = null;
  const onQuestion = number => {
    if (number !== current) { current = number; pilotStatus(`Question ${number}`, {restart: true, verb: 'Solving'}); }
  };
  try {
    pilotTabId = null;
    const settings = await send({type: 'settingsStatus'}); live();
    if (!settings.configured) throw new Error('AuraSolve Cloud is offline. Try again in a minute.');
    const info = await send({type: 'inspect'}); live();
    pilotTabId = info.tabId;
    await runFillAssignment({
      request: async message => { const response = await send(message); live(); return response; },
      checkpoint, delay, limit, budget,
      pace: async (result, {number} = {}) => {
        const min = Number($('time-min').value), max = Number($('time-max').value);
        const seconds = $('speed-run').checked ? 0 : min + ($('random-timing').checked ? 10 * Math.floor(Math.random() * ((max - min) / 10 + 1)) : 0);
        const elapsed = pilotClock.since ? (Date.now() - pilotClock.since) / 1000 : 0;
        // Pace is the total time per question, so time already spent solving counts.
        let left = Math.max(0, seconds - elapsed) * 1000;
        while (left > 0) { const step = Math.min(250, left); await delay(step); left -= step; }
      },
      onEvent: async event => {
        live();
        if (event.kind === 'solve') {
          onQuestion(event.number);
          const part = event.part > 1 ? `, part ${event.part}` : '';
          pilotStatus(event.retry ? `Retrying Question ${event.number}${part}` : `Question ${event.number}${part}`, {verb: event.retry ? '' : 'Solving'});
        }
        if (event.kind === 'answer') {
          const last = runLog.at(-1);
          if (!last || last.number !== String(event.number)) runLog.push({number: String(event.number), result: event.result, outcome: 'Filling', submitted: false});
          else last.result = event.result;
        }
        if (event.kind === 'retry') {
          if (runLog.length) runLog.at(-1).outcome = 'Incorrect · trying again';
          pilotStatus(`Retrying Question ${event.number}`);
        }
        if (event.kind === 'part') pilotStatus(`Question ${event.number}, part ${event.part}`, {verb: 'Solving'});
        if (event.kind === 'similar') {
          if (runLog.length) runLog.at(-1).outcome = 'Missed a part · redoing with Similar question';
          pilotStatus(`Redoing Question ${event.number} (Similar question)`, {restart: true});
        }
        if (event.kind === 'filled' && runLog.length) {
          const pressed = event.applied?.checked === 'final' ? 'Final Check' : 'Check answer';
          runLog.at(-1).outcome = event.verdict === 'correct' ? 'Correct' : event.verdict === 'incorrect' ? 'Incorrect' : event.applied?.advanced === 'check' ? `Filled and pressed ${pressed}` : event.applied?.advanced === 'next' ? 'Filled and pressed Next' : 'Filled the last question';
          runLog.at(-1).submitted = event.applied?.advanced === 'check';
        }
        if (event.kind === 'next') pilotStatus(`Moving past Question ${event.number}`);
        if (event.kind === 'done') pilotStatus(`Finished ${event.completed} question${event.completed === 1 ? '' : 's'}. Press play to run again.`, {done: true});
      },
    });
    breakdown();
    pilotState('Done');
  } catch (error) {
    breakdown();
    const stopped = error.message === 'Stopped.';
    pilotState(stopped ? 'Stopped' : 'Error');
    pilotStatus(stopped ? 'Stopped. Press play to continue from this question.' : 'Stopped on an error (details below). Press play to try again.', {done: true});
    if (!stopped) { $('pilot-error').textContent = error.message; $('pilot-error').hidden = false; }
    if (PAYWALL.test(error.message || '')) show('account');
  } finally {
    clearInterval(pilotClock.timer);
    setBusy(false);
    $('start-pilot').hidden = false; $('stop-pilot').hidden = true;
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
  if (button.dataset.action === 'screenshot') regionSolve();
  if (button.dataset.action === 'solve') helpSolve();
  if (button.dataset.action === 'autopilot') show('autopilot');
}));
$('start-pilot').onclick = () => { if (!busy) startPilot(); };
$('stop-pilot').onclick = async () => {
  token++;
  try { await send({type: 'stop'}); } catch {}
  pilotStatus('Stopping', {done: true});
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


/* ---------- On-page Fill button ---------- */
const overlayZone=$('overlay-zone'), overlayLabel=$('overlay-label'), overlayColors=$('overlay-colors');
const overlayInvisible=$('overlay-invisible'), overlayFill=$('overlay-fill'), overlayShot=$('overlay-shot'), overlayForms=$('overlay-forms'), overlayCustom=$('overlay-custom');
const overlayX=$('overlay-x'), overlayY=$('overlay-y'), overlayPreview=$('overlay-preview'), overlayPreviewShot=$('overlay-preview-shot'), overlayNote=$('overlay-preview-note');
for (const zone of OVERLAY_ZONES) overlayZone.add(new Option(zone.label, zone.id));
for (const color of OVERLAY_COLORS) {
  const swatch=document.createElement('button');
  swatch.type='button'; swatch.className='swatch'; swatch.style.background=color.id;
  swatch.dataset.color=color.id; swatch.title=color.label; swatch.setAttribute('role','radio');
  swatch.setAttribute('aria-label', color.label); swatch.setAttribute('aria-checked','false');
  overlayColors.append(swatch);
}
const zoneCopy={
  'prompt-right':'Shown on the right side of the question text.',
  'prompt-left':'Shown on the left side of the question text.',
  'fixed-tr':'Pinned to the top right of the MyLab page.',
  'fixed-tl':'Pinned to the top left of the MyLab page.',
  'fixed-br':'Pinned to the bottom right of the MyLab page.',
  'fixed-bl':'Pinned to the bottom left of the MyLab page.',
  'custom':'Drag the bar above the button on MyLab, or set Left % and Top % here.',
};
function paintOverlay(settings) {
  const next=normalizeOverlay(settings);
  overlayInvisible.checked=next.invisible;
  overlayFill.checked=next.showFill;
  overlayShot.checked=next.showShot;
  overlayForms.checked=next.formsHighlight;
  overlayZone.value=next.zone;
  overlayLabel.value=next.label;
  overlayX.value=String(Math.round(next.x));
  overlayY.value=String(Math.round(next.y));
  overlayCustom.hidden=next.zone!=='custom';
  for (const swatch of overlayColors.children) swatch.setAttribute('aria-checked', String(swatch.dataset.color===next.color));
  overlayPreview.textContent=next.invisible ? '' : next.label;
  overlayPreview.style.color=next.color;
  overlayPreview.classList.toggle('ghost', next.invisible);
  overlayPreview.hidden=!next.showFill;
  overlayPreviewShot.hidden=!next.showShot;
  overlayPreviewShot.style.color=next.color;
  overlayPreviewShot.classList.toggle('ghost', next.invisible);
  const shown=next.showFill && next.showShot ? 'Fill answers plus the square screenshot button. ' : next.showFill ? 'Only Fill answers is shown. ' : next.showShot ? 'Only the screenshot button is shown. ' : '';
  overlayNote.textContent=!next.showFill && !next.showShot
    ? 'Both buttons are off, so nothing is shown on MyLab.'
    : next.invisible
      ? 'Invisible on MyLab. The empty zones still work when clicked.'
      : shown + (zoneCopy[next.zone] || 'Shown on the MyLab page.');
  return next;
}
async function saveOverlay(patch={}) {
  const current=await readOverlay();
  const next=await writeOverlay({
    ...current,
    ...patch,
    color: patch.color || [...overlayColors.children].find(node=>node.getAttribute('aria-checked')==='true')?.dataset.color || current.color,
    zone: overlayZone.value,
    label: overlayLabel.value,
    invisible: overlayInvisible.checked,
    showFill: overlayFill.checked,
    showShot: overlayShot.checked,
    formsHighlight: overlayForms.checked,
    x: Number(overlayX.value),
    y: Number(overlayY.value),
  });
  paintOverlay(next);
}
readOverlay().then(paintOverlay);
overlayInvisible.onchange=()=>saveOverlay({invisible: overlayInvisible.checked});
overlayFill.onchange=()=>saveOverlay({showFill: overlayFill.checked});
overlayShot.onchange=()=>saveOverlay({showShot: overlayShot.checked});
overlayForms.onchange=()=>saveOverlay({formsHighlight: overlayForms.checked});
overlayZone.onchange=()=>saveOverlay({zone: overlayZone.value});
overlayLabel.onchange=()=>saveOverlay({label: overlayLabel.value});
overlayLabel.onkeydown=event=>{ if(event.key==='Enter'){ event.preventDefault(); overlayLabel.blur(); } };
overlayX.onchange=()=>saveOverlay({zone:'custom', x:Number(overlayX.value)});
overlayY.onchange=()=>saveOverlay({zone:'custom', y:Number(overlayY.value)});
overlayColors.onclick=event=>{
  const swatch=event.target.closest('.swatch');
  if(!swatch)return;
  saveOverlay({color: swatch.dataset.color});
};

/* ---------- Troubleshoot ---------- */
let inspectionReport = null;
$('inspect-page').onclick = async () => {
  $('inspect-page').disabled = true;
  try {
    inspectionReport = await send({type: 'inspectPage'});
    $('inspection-summary').textContent = inspectionReport.frames.map(frame => `Frame ${frame.frameId}: ${frame.fields.length} answer boxes, ${frame.controls.length} buttons; diagram ${frame.visual ? 'found' : 'not found'}${frame.graph?.surfaces?.length ? `; ${frame.graph.surfaces.length} graph surface${frame.graph.surfaces.length === 1 ? '' : 's'}, ${frame.graph.labels.length} labels` : ''}.`).join('\n');
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

/* ---------- Account and plans ---------- */
const PAYWALL = /pick a plan|Sign in to AuraSolve to keep solving/i;
const PLAN_NOTES = {
  weekly: {tag: '', intro: '$0.99 today for your first week, then $8.99 every week until you cancel.', full: '$8.99 today, then $8.99 every week until you cancel.', fullPrice: '$8.99/week', fullThen: 'billed weekly'},
  monthly: {tag: 'Most popular', intro: '$4.99 today for your first month, then $9.99 every month until you cancel.', full: '$9.99 today, then $9.99 every month until you cancel.', fullPrice: '$9.99/month', fullThen: 'billed monthly'},
  yearly: {tag: 'Best value', intro: '$40.00 today, then $40.00 every year until you cancel.', full: '$40.00 today, then $40.00 every year until you cancel.'},
};
let challenge = null, chosenPlan = 'monthly', planList = null, accountState = null;
const accountError = message => { $('account-error').textContent = message || ''; $('account-error').hidden = !message; };
function drawPlans() {
  const intro = accountState?.introEligible !== false;
  $('plan-list').replaceChildren(...(planList || []).map(plan => {
    const note = PLAN_NOTES[plan.id] || {};
    const button = el('button', 'plan');
    button.type = 'button'; button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', String(plan.id === chosenPlan));
    if (note.tag) button.append(el('span', 'plan-tag', note.tag));
    const name = el('span', 'plan-name'); name.append(el('strong', '', plan.title), el('small', '', 'Unlimited solves'));
    const price = el('span', 'plan-price'); price.append(el('strong', '', intro || !note.fullPrice ? plan.price : note.fullPrice), el('small', '', intro || !note.fullThen ? plan.then : note.fullThen));
    button.append(name, price);
    button.onclick = () => { chosenPlan = plan.id; drawPlans(); };
    return button;
  }));
  const note = PLAN_NOTES[chosenPlan] || {};
  $('plan-terms').textContent = intro ? note.intro || '' : note.full || '';
}
function drawAccount() {
  const state = accountState || {};
  const signedIn = Boolean(state.signedIn);
  $('signin-email').hidden = signedIn || Boolean(challenge);
  $('signin-code').hidden = signedIn || !challenge;
  $('sign-out').hidden = !signedIn;
  $('account-open-note').hidden = state.paywall !== false;
  $('plan-status').hidden = !signedIn;
  $('plans').hidden = !signedIn || !state.paywall || Boolean(state.paid);
  $('manage-plan').hidden = !state.paid;
  if (!signedIn) return;
  const date = state.renews ? new Date(state.renews).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : '';
  if (!state.paywall) { $('plan-title').textContent = state.email; $('plan-detail').textContent = 'Everything is unlocked right now.'; return; }
  if (state.paid) {
    $('plan-title').textContent = `AuraSolve ${state.plan ? state.plan[0].toUpperCase() + state.plan.slice(1) : 'Pro'}`;
    $('plan-detail').textContent = `${state.email} · ${state.cancelAtPeriodEnd ? `Ends ${date}` : state.status === 'past_due' ? 'Payment failed: update your card in Manage subscription' : `Renews ${date}`}`;
  } else {
    $('plan-title').textContent = 'Free';
    $('plan-detail').textContent = `${state.email} · ${state.freeLeft} of ${state.freeTotal} free solves left`;
    drawPlans();
  }
}
async function refreshAccount() {
  accountError('');
  try {
    [accountState, planList] = await Promise.all([loadAccount(), planList ? planList : loadPlans().then(data => data.plans)]);
  } catch (error) { accountError(error.message); }
  drawAccount();
}
$('signin-email').onsubmit = async event => {
  event.preventDefault();
  accountError(''); $('email-send').disabled = true;
  try {
    challenge = (await startSignIn($('email').value)).challenge;
    $('code-note').textContent = `We sent a 6-digit code to ${$('email').value.trim()}. It expires in 10 minutes.`;
    $('code').value = '';
    drawAccount(); $('code').focus();
  } catch (error) { accountError(error.message); }
  finally { $('email-send').disabled = false; }
};
$('signin-code').onsubmit = async event => {
  event.preventDefault();
  accountError(''); $('code-check').disabled = true;
  try {
    accountState = await finishSignIn(challenge, $('code').value);
    challenge = null;
    await refreshAccount();
  } catch (error) { accountError(error.message); }
  finally { $('code-check').disabled = false; }
};
$('code-back').onclick = () => { challenge = null; accountError(''); drawAccount(); };
$('sign-out').onclick = async () => { await signOut(); accountState = null; challenge = null; refreshAccount(); };
$('subscribe').onclick = async () => {
  accountError(''); $('subscribe').disabled = true;
  try { chrome.tabs.create({url: await checkoutUrl(chosenPlan)}); }
  catch (error) { accountError(error.message); }
  finally { $('subscribe').disabled = false; }
};
$('manage-plan').onclick = async () => {
  accountError('');
  try { chrome.tabs.create({url: await portalUrl()}); }
  catch (error) { accountError(error.message); }
};
// Coming back from Stripe checkout: show the new plan without a reload.
window.addEventListener('focus', () => { if (!document.querySelector('[data-view="account"]').hidden) refreshAccount(); });

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
