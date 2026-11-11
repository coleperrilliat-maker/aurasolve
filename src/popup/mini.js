import {BUILD_VERSION} from '../shared/version.js';
import {sendExtension} from '../shared/messaging.js';
import {answerLines} from '../shared/render.js';
import {readOverlay, writeOverlay} from '../shared/overlay.js';

const $ = id => document.getElementById(id);
$('version').textContent = BUILD_VERSION;
const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
document.querySelector('.hint').innerHTML = mac
  ? 'Page buttons · <kbd>⌘</kbd><kbd>⇧</kbd><kbd>X</kbd>'
  : 'Page buttons · <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>X</kbd>';

const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
const note = (text, error = false) => { $('note').textContent = text || ''; $('note').classList.toggle('error', error); };
const openPage = hash => {
  chrome.tabs.create({url: chrome.runtime.getURL(`src/popup/popup.html${hash || ''}`)});
  window.close();
};

/* ---------- AutoPilot (runs in the offscreen page, so it survives this popup closing) ---------- */
function pilotSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('pilotSettings') || '{}'); } catch {}
  const min = Number(saved['time-min'] ?? 20), max = Number(saved['time-max'] ?? 40);
  return {
    speed: Boolean(saved['speed-run']),
    random: saved['random-timing'] ?? true,
    min, max: Math.max(min, max),
    limit: Number(saved['question-limit'] ?? 0),
    budget: Number(saved['solve-budget'] ?? 200),
  };
}
let pilotRunning = false;
function drawPilot(status) {
  pilotRunning = Boolean(status?.running);
  $('pilot').classList.toggle('running', pilotRunning);
  $('pilot-title').textContent = pilotRunning ? 'Stop AutoPilot' : 'Start AutoPilot';
  $('pilot-text').textContent = status?.text || 'Works through unfinished questions';
}
drawPilot((await chrome.storage.session.get('pilotStatus')).pilotStatus);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.pilotStatus) drawPilot(changes.pilotStatus.newValue);
});
$('pilot').onclick = async () => {
  note('');
  try {
    if (pilotRunning) await sendExtension({type: 'pilotStop'});
    else await sendExtension({type: 'pilotStart', tabId: tab?.id, settings: pilotSettings()});
  } catch (error) { note(error.message, true); }
};

/* ---------- Solve the current question and fill it ---------- */
$('solve').onclick = async () => {
  $('solve').disabled = true;
  try {
    note('Reading the question…');
    await sendExtension({type: 'prepareField', pilotTabId: tab?.id}).catch(() => {});
    note('Solving…');
    const result = await sendExtension({type: 'solve', mode: 'field', pilotTabId: tab?.id});
    const answer = answerLines(result.solution, result.question).join('\n');
    if (!result.solution?.supported || !result.solution.actions?.length || !result.planId) {
      note(result.solution?.limitation || answer || 'Nothing to fill on this question.');
      return;
    }
    note('Filling…');
    await sendExtension({type: 'apply', planId: result.planId, confirmIncorrect: true, pilotTabId: tab?.id});
    note(answer ? `Filled: ${answer}` : 'Filled in.');
  } catch (error) { note(error.message, true); }
  finally { $('solve').disabled = false; }
};

/* ---------- Screenshot: drag over the page; the answer shows on the page ---------- */
$('shot').onclick = () => {
  note('Drag over the question on the page.');
  let failed = false;
  sendExtension({type: 'regionSolve'}).catch(error => { failed = true; note(error.message, true); });
  setTimeout(() => { if (!failed) window.close(); }, 700);
};

$('chat').onclick = () => openPage('#home');
$('profile').onclick = () => openPage('#account');

/* ---------- Anonymous switch + remove page buttons ---------- */
let overlay = await readOverlay();
function drawOverlay() {
  const removed = !overlay.showFill && !overlay.showShot;
  $('ghost').setAttribute('aria-checked', String(overlay.invisible));
  $('ghost-state').textContent = overlay.invisible
    ? 'Invisible · click zones still work'
    : 'Buttons stay clickable, but invisible';
  $('remove').classList.toggle('on', removed);
  $('remove').textContent = removed ? 'Show page buttons' : 'Remove page buttons';
  $('ghost').disabled = removed;
}
drawOverlay();

$('ghost').onclick = async () => {
  if (!overlay.showFill && !overlay.showShot) return;
  overlay = await writeOverlay({...overlay, invisible: !overlay.invisible});
  drawOverlay();
  note(overlay.invisible ? 'Page buttons are invisible.' : 'Page buttons are visible again.');
};

$('remove').onclick = async () => {
  const removed = !overlay.showFill && !overlay.showShot;
  overlay = await writeOverlay({
    ...overlay,
    showFill: removed,
    showShot: removed,
    invisible: removed ? overlay.invisible : false,
  });
  drawOverlay();
  note(removed ? 'Page buttons are back.' : 'Page buttons removed from the question.');
};

/* ---------- Site access ---------- */
// "Ask on every visit" / "On click" only unlocks the top page, never MyLab's
// question frame on another Pearson host, so ask for the sites directly.
const SITE_ORIGINS = (chrome.runtime.getManifest().content_scripts?.[0]?.matches || []).filter(match => match.startsWith('https://')).concat('<all_urls>');
$('site-access').hidden = await chrome.permissions.contains({origins: SITE_ORIGINS}).catch(() => true);
$('allow-sites').onclick = async () => {
  if (await chrome.permissions.request({origins: SITE_ORIGINS}).catch(() => false)) $('site-access').hidden = true;
};
