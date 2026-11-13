import {BUILD_VERSION} from '../shared/version.js';
import {sendExtension} from '../shared/messaging.js';
import {answerLines} from '../shared/render.js';
import {normalizeOverlay, readOverlay, writeOverlay} from '../shared/overlay.js';
import {account as loadAccount, plans as loadPlans, signOut, checkoutUrl, portalUrl} from '../background/api.js';

const $ = id => document.getElementById(id);
$('version').textContent = `v${BUILD_VERSION}`;
const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
const keys = mac ? '⌘⇧X' : 'Ctrl+Shift+X';

const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
const say = (id, text, error = false) => {
  const node = $(id);
  node.textContent = text || '';
  node.classList.toggle('error', error);
  node.hidden = id === 'profile-error' ? !text : false;
};

function show(view) {
  document.querySelectorAll('[data-page]').forEach(page => { page.hidden = page.dataset.page !== view; });
  if (view === 'profile') refreshAccount();
}
document.querySelectorAll('[data-go]').forEach(button => { button.onclick = () => show(button.dataset.go); });
document.querySelectorAll('[data-back]').forEach(button => { button.onclick = () => show('home'); });

/* ---------- AutoPilot ---------- */
function savedPilot() {
  try { return JSON.parse(localStorage.getItem('pilotSettings') || '{}'); } catch { return {}; }
}
function savePilot(patch) {
  localStorage.setItem('pilotSettings', JSON.stringify({...savedPilot(), ...patch}));
}
for (const id of ['time-min', 'time-max']) {
  for (let seconds = 10; seconds <= 120; seconds += 10) $(id).add(new Option(`${seconds}s`, String(seconds)));
}
const savedPace = savedPilot();
const switched = (id, on) => $(id).setAttribute('aria-checked', String(on));
switched('speed-run', Boolean(savedPace['speed-run']));
switched('random-timing', savedPace['random-timing'] ?? true);
$('time-min').value = String(savedPace['time-min'] ?? 20);
$('time-max').value = String(savedPace['time-max'] ?? 40);
$('question-limit').value = String(savedPace['question-limit'] ?? 0);
$('solve-budget').value = String(savedPace['solve-budget'] ?? 200);
function drawTiming() {
  const speed = $('speed-run').getAttribute('aria-checked') === 'true';
  const random = $('random-timing').getAttribute('aria-checked') === 'true';
  $('timing-settings').hidden = speed;
  $('max-label').hidden = !random;
  if (Number($('time-max').value) < Number($('time-min').value)) $('time-max').value = $('time-min').value;
}
drawTiming();
function pilotSettings() {
  const min = Number($('time-min').value), max = Number($('time-max').value);
  return {
    speed: $('speed-run').getAttribute('aria-checked') === 'true',
    random: $('random-timing').getAttribute('aria-checked') === 'true',
    min, max: Math.max(min, max),
    limit: Number($('question-limit').value),
    budget: Number($('solve-budget').value),
  };
}
function toggleSwitch(id, key) {
  const on = $(id).getAttribute('aria-checked') !== 'true';
  switched(id, on);
  savePilot({[key]: on});
  drawTiming();
}
$('speed-run').onclick = () => toggleSwitch('speed-run', 'speed-run');
$('random-timing').onclick = () => toggleSwitch('random-timing', 'random-timing');
for (const id of ['time-min', 'time-max', 'question-limit', 'solve-budget']) {
  $(id).onchange = () => { drawTiming(); savePilot({[id]: $(id).value}); };
}
let pilotRunning = false;
function drawPilot(status) {
  pilotRunning = Boolean(status?.running);
  $('pilot').classList.toggle('running', pilotRunning);
  $('pilot-title').textContent = pilotRunning ? 'Stop AutoPilot' : 'Start AutoPilot';
  $('pilot-text').textContent = status?.text || 'Ready on this tab';
  document.querySelector('[data-go="autopilot"]')?.classList.toggle('running', pilotRunning);
}
drawPilot((await chrome.storage.session.get('pilotStatus')).pilotStatus);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.pilotStatus) drawPilot(changes.pilotStatus.newValue);
});
$('pilot').onclick = async () => {
  try {
    if (pilotRunning) await sendExtension({type: 'pilotStop'});
    else await sendExtension({type: 'pilotStart', tabId: tab?.id, settings: pilotSettings()});
  } catch (error) { $('pilot-text').textContent = error.message; }
};

/* ---------- Solve / screenshot stay on the home page ---------- */
$('solve').onclick = async () => {
  $('solve').disabled = true;
  try {
    say('note', 'Reading the question…');
    await sendExtension({type: 'prepareField', pilotTabId: tab?.id}).catch(() => {});
    say('note', 'Solving…');
    const result = await sendExtension({type: 'solve', mode: 'field', pilotTabId: tab?.id});
    const answer = answerLines(result.solution, result.question).join('\n');
    if (!result.solution?.supported || !result.solution.actions?.length || !result.planId) {
      say('note', result.solution?.limitation || answer || 'Nothing to fill on this question.');
      return;
    }
    say('note', 'Filling…');
    await sendExtension({type: 'apply', planId: result.planId, fillOnly: true, confirmIncorrect: true, pilotTabId: tab?.id});
    say('note', answer ? `Filled: ${answer}` : 'Filled in.');
  } catch (error) { say('note', error.message, true); }
  finally { $('solve').disabled = false; }
};
$('shot').onclick = () => {
  say('note', 'Drag over the question on the page.');
  let failed = false;
  sendExtension({type: 'regionSolve'}).catch(error => { failed = true; say('note', error.message, true); });
  setTimeout(() => { if (!failed) window.close(); }, 700);
};

/* ---------- Chat ---------- */
const thread = $('thread');
const chat = [];
let attached = null;
function bubble(role, text, image) {
  $('chat-mark').hidden = true;
  thread.classList.add('live');
  const node = document.createElement('div');
  node.className = `bubble ${role}`;
  if (image) {
    const img = document.createElement('img');
    img.src = image;
    img.alt = '';
    node.append(img);
  }
  if (text) node.append(document.createTextNode(text));
  thread.append(node);
  thread.scrollTop = thread.scrollHeight;
}
function showPreview(image) {
  attached = image;
  $('preview').hidden = !image;
  if (image) $('preview-img').src = image;
}
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
$('upload-btn').onclick = () => $('upload').click();
$('upload').onchange = async () => {
  const file = $('upload').files?.[0];
  $('upload').value = '';
  if (!file) return;
  try { showPreview(await fileToImage(file)); }
  catch (error) { say('chat-note', error.message, true); }
};
$('preview-clear').onclick = () => showPreview(null);
$('composer').onsubmit = async event => {
  event.preventDefault();
  const text = $('prompt').value.trim();
  if (!text && !attached) return;
  const image = attached;
  showPreview(null);
  $('prompt').value = '';
  bubble('user', text, image);
  say('chat-note', 'Thinking…');
  try {
    const reply = (await sendExtension({type: 'ask', messages: [...chat.slice(-8), {role: 'user', content: text || 'What is in this image?'}], image})).reply;
    chat.push({role: 'user', content: image ? `${text || 'What is in this image?'} (image attached)` : text}, {role: 'assistant', content: reply});
    bubble('bot', reply);
    say('chat-note', '');
  } catch (error) { say('chat-note', error.message, true); }
};

/* ---------- Settings ---------- */
let overlay = await readOverlay();
function drawHighlight() {
  const label = highlightOn ? `On · ${keys}` : `Off · ${keys}`;
  for (const id of ['highlight-switch', 'home-highlight']) {
    $(id)?.setAttribute('aria-checked', String(highlightOn));
  }
  $('highlight-state').textContent = label;
  $('home-highlight-state').textContent = label;
}
function drawOverlay() {
  const buttons = overlay.showFill || overlay.showShot;
  $('buttons-switch').setAttribute('aria-checked', String(buttons));
  $('buttons-state').textContent = buttons ? 'On' : 'Off';
  $('ghost').setAttribute('aria-checked', String(overlay.invisible));
  $('ghost-state').textContent = overlay.invisible ? 'On · buttons stay clickable' : 'Off';
  drawHighlight();
}
let highlightOn = false;
drawOverlay();
if (tab?.id) highlightOn = Boolean((await sendExtension({type: 'highlightStatus', tabId: tab.id}).catch(() => ({on: false}))).on);
drawOverlay();
$('buttons-switch').onclick = async () => {
  const show = !(overlay.showFill || overlay.showShot);
  overlay = await writeOverlay({...overlay, showFill: show, showShot: show});
  drawOverlay();
};
$('ghost').onclick = async () => {
  overlay = await writeOverlay({...overlay, invisible: !overlay.invisible});
  drawOverlay();
};
async function toggleHighlight() {
  if (!tab?.id) return;
  highlightOn = Boolean((await sendExtension({type: 'setHighlight', tabId: tab.id, on: !highlightOn})).on);
  drawHighlight();
}
$('highlight-switch').onclick = toggleHighlight;
$('home-highlight').onclick = toggleHighlight;
// Popup focus can swallow the extension command, so mirror ⌘⇧X here too.
document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
  if (event.key.toLowerCase() !== 'x') return;
  event.preventDefault();
  toggleHighlight();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.overlaySettings) {
    overlay = normalizeOverlay(changes.overlaySettings.newValue);
    drawOverlay();
  }
  if (area === 'local' && changes.auraSession) refreshAccount();
  const key = tab?.id ? `highlight:${tab.id}` : '';
  if (area === 'session' && key && changes[key]) {
    highlightOn = Boolean(changes[key].newValue);
    drawHighlight();
  }
});

/* ---------- Profile ---------- */
let challenge = null, accountState = null, planList = null, chosenPlan = 'monthly';
function profileError(message) { say('profile-error', message || '', true); }
function drawPlans() {
  const box = $('plans');
  box.replaceChildren(...(planList || []).map(plan => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plan';
    button.setAttribute('aria-checked', String(plan.id === chosenPlan));
    button.innerHTML = `<span><strong></strong><small></small></span><small></small>`;
    button.querySelector('strong').textContent = plan.title || plan.id;
    button.querySelector('small').textContent = 'Unlimited solves';
    button.lastElementChild.textContent = plan.price || '';
    button.onclick = () => { chosenPlan = plan.id; drawPlans(); };
    return button;
  }));
}
function drawAccount() {
  const state = accountState || {};
  const signedIn = Boolean(state.signedIn);
  $('signed-out').hidden = signedIn;
  $('signed-in').hidden = !signedIn;
  if (!signedIn) return;
  $('who-title').textContent = state.email || 'Signed in';
  if (state.paywall === false) $('who-detail').textContent = 'Everything is unlocked.';
  else if (state.paid) $('who-detail').textContent = state.plan ? `${state.plan} plan` : 'Paid plan';
  else $('who-detail').textContent = `${state.freeLeft ?? 0} of ${state.freeTotal ?? 0} free solves left`;
  const needsPlan = Boolean(state.paywall && !state.paid);
  $('plans').hidden = !needsPlan;
  $('subscribe').hidden = !needsPlan;
  $('manage').hidden = !state.paid;
  if (needsPlan) drawPlans();
}
async function refreshAccount() {
  profileError('');
  try {
    [accountState, planList] = await Promise.all([loadAccount(), planList ? planList : loadPlans().then(data => data.plans)]);
  } catch (error) { profileError(error.message); }
  drawAccount();
}
$('log-in').onclick = async () => {
  profileError('');
  try { await sendExtension({type: 'startWebLogin'}); }
  catch (error) { profileError(error.message); }
};
$('sign-out').onclick = async () => { await signOut(); accountState = null; challenge = null; refreshAccount(); };
$('subscribe').onclick = async () => {
  profileError('');
  try { chrome.tabs.create({url: await checkoutUrl(chosenPlan)}); }
  catch (error) { profileError(error.message); }
};
$('manage').onclick = async () => {
  profileError('');
  try { chrome.tabs.create({url: await portalUrl()}); }
  catch (error) { profileError(error.message); }
};

/* ---------- Site access ---------- */
const SITE_ORIGINS = (chrome.runtime.getManifest().content_scripts?.[0]?.matches || []).filter(match => match.startsWith('https://'));
$('site-access').hidden = await chrome.permissions.contains({origins: SITE_ORIGINS}).catch(() => true);
$('allow-sites').onclick = async () => {
  if (await chrome.permissions.request({origins: SITE_ORIGINS}).catch(() => false)) $('site-access').hidden = true;
};
