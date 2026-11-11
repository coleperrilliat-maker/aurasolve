import {BUILD_VERSION} from '../shared/version.js';
import {sendExtension} from '../shared/messaging.js';
import {answerLines} from '../shared/render.js';
import {readOverlay, writeOverlay} from '../shared/overlay.js';

const $ = id => document.getElementById(id);
$('version').textContent = BUILD_VERSION;
const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
const note = (text, error = false) => { $('note').textContent = text || ''; $('note').classList.toggle('error', error); };

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
  $('pilot-text').textContent = status?.text || 'Answers every unfinished question';
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

/* ---------- Anonymous: on-page buttons stay clickable but invisible ---------- */
let overlay = await readOverlay();
function drawGhost() {
  $('ghost').setAttribute('aria-pressed', String(overlay.invisible));
  $('ghost-state').textContent = overlay.invisible ? 'Hidden' : 'Buttons visible';
}
drawGhost();
$('ghost').onclick = async () => {
  overlay = await writeOverlay({...overlay, invisible: !overlay.invisible});
  drawGhost();
  note(overlay.invisible ? 'On-page buttons are invisible. Click where they were, or highlight a word to solve.' : 'On-page buttons are visible again.');
};

$('settings').onclick = () => {
  chrome.tabs.create({url: chrome.runtime.getURL('src/popup/popup.html#settings')});
  window.close();
};

/* ---------- Site access ---------- */
// "Ask on every visit" / "On click" only unlocks the top page, never MyLab's
// question frame on another Pearson host, so ask for the sites directly.
const SITE_ORIGINS = (chrome.runtime.getManifest().content_scripts?.[0]?.matches || []).filter(match => match.startsWith('https://')).concat('<all_urls>');
$('site-access').hidden = await chrome.permissions.contains({origins: SITE_ORIGINS}).catch(() => true);
$('allow-sites').onclick = async () => {
  if (await chrome.permissions.request({origins: SITE_ORIGINS}).catch(() => false)) $('site-access').hidden = true;
};
