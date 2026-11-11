import {BUILD_VERSION} from '../shared/version.js';
import {sendExtension} from '../shared/messaging.js';
import {answerLines} from '../shared/render.js';
import {readOverlay, writeOverlay} from '../shared/overlay.js';
import {account as loadAccount, plans as loadPlans, startSignIn, finishSignIn, signOut, checkoutUrl, portalUrl} from '../background/api.js';

const $ = id => document.getElementById(id);
$('version').textContent = BUILD_VERSION;
const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
const keys = mac ? '⌘⇧X' : 'Ctrl+Shift+X';
$('hint').textContent = `Page buttons · ${keys}`;
$('shortcut').textContent = `Press ${keys} to turn highlight-to-solve on or off. It does not change the page buttons.`;

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
function pilotSettings() {
  const saved = savedPilot();
  const min = Number(saved['time-min'] ?? 20), max = Number(saved['time-max'] ?? 40);
  return {
    speed: $('speed-run').checked,
    random: saved['random-timing'] ?? true,
    min, max: Math.max(min, max),
    limit: Number(saved['question-limit'] ?? 0),
    budget: Number(saved['solve-budget'] ?? 200),
  };
}
$('speed-run').checked = Boolean(savedPilot()['speed-run']);
$('speed-run').onchange = () => {
  localStorage.setItem('pilotSettings', JSON.stringify({...savedPilot(), 'speed-run': $('speed-run').checked}));
};
let pilotRunning = false;
function drawPilot(status) {
  pilotRunning = Boolean(status?.running);
  $('pilot').classList.toggle('running', pilotRunning);
  $('pilot-title').textContent = pilotRunning ? 'Stop AutoPilot' : 'Start AutoPilot';
  $('pilot-text').textContent = status?.text || 'Ready on this tab';
  $('home-pilot').textContent = pilotRunning ? 'Running' : 'Work through questions';
  $('home-pilot').classList.toggle('on', pilotRunning);
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
function bubble(role, text) {
  thread.querySelector('.empty')?.remove();
  const node = document.createElement('div');
  node.className = `bubble ${role}`;
  node.textContent = text;
  thread.append(node);
  thread.scrollTop = thread.scrollHeight;
}
$('attach').onclick = async () => {
  if (attached) { attached = null; $('attach').setAttribute('aria-pressed', 'false'); $('attach').textContent = 'Screen'; return; }
  $('attach').disabled = true;
  try {
    attached = (await sendExtension({type: 'captureScreen'})).image;
    $('attach').setAttribute('aria-pressed', 'true');
    $('attach').textContent = 'Screen on';
  } catch (error) { say('chat-note', error.message, true); }
  finally { $('attach').disabled = false; }
};
$('composer').onsubmit = async event => {
  event.preventDefault();
  const text = $('prompt').value.trim();
  if (!text) return;
  const image = attached;
  attached = null;
  $('attach').setAttribute('aria-pressed', 'false');
  $('attach').textContent = 'Screen';
  $('prompt').value = '';
  bubble('user', text);
  say('chat-note', 'Thinking…');
  try {
    const reply = (await sendExtension({type: 'ask', messages: [...chat.slice(-8), {role: 'user', content: text}], image})).reply;
    chat.push({role: 'user', content: image ? `${text} (screenshot attached)` : text}, {role: 'assistant', content: reply});
    bubble('bot', reply);
    say('chat-note', '');
  } catch (error) { say('chat-note', error.message, true); }
};

/* ---------- Settings ---------- */
let overlay = await readOverlay();
function drawOverlay() {
  const removed = !overlay.showFill && !overlay.showShot;
  $('ghost').setAttribute('aria-checked', String(overlay.invisible && !removed));
  $('ghost').disabled = removed;
  $('ghost-state').textContent = removed ? 'Turn the page buttons back on first' : overlay.invisible ? 'Invisible. Click zones still work.' : 'Page buttons stay clickable, but invisible';
  $('remove-state').textContent = removed ? 'Removed from the question' : 'Shown on the question';
  $('remove').querySelector('strong').classList.toggle('on', removed);
  $('remove').querySelector('strong').textContent = removed ? 'Show page buttons' : 'Remove page buttons';
}
drawOverlay();
$('ghost').onclick = async () => {
  if (!overlay.showFill && !overlay.showShot) return;
  overlay = await writeOverlay({...overlay, invisible: !overlay.invisible});
  drawOverlay();
  say('settings-note', overlay.invisible ? 'Page buttons are invisible.' : 'Page buttons are visible.');
};
$('remove').onclick = async () => {
  const removed = !overlay.showFill && !overlay.showShot;
  overlay = await writeOverlay({...overlay, showFill: removed, showShot: removed, invisible: removed ? overlay.invisible : false});
  drawOverlay();
  say('settings-note', removed ? 'Page buttons are back.' : 'Page buttons removed.');
};

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
  $('signin-email').hidden = signedIn || Boolean(challenge);
  $('signin-code').hidden = signedIn || !challenge;
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
  $('home-profile').textContent = state.email || 'Account & plan';
}
async function refreshAccount() {
  profileError('');
  try {
    [accountState, planList] = await Promise.all([loadAccount(), planList ? planList : loadPlans().then(data => data.plans)]);
  } catch (error) { profileError(error.message); }
  drawAccount();
}
$('signin-email').onsubmit = async event => {
  event.preventDefault();
  profileError('');
  try {
    challenge = (await startSignIn($('email').value)).challenge;
    $('code-note').textContent = `Code sent to ${$('email').value.trim()}.`;
    $('code').value = '';
    drawAccount();
    $('code').focus();
  } catch (error) { profileError(error.message); }
};
$('signin-code').onsubmit = async event => {
  event.preventDefault();
  profileError('');
  try {
    accountState = await finishSignIn(challenge, $('code').value);
    challenge = null;
    await refreshAccount();
  } catch (error) { profileError(error.message); }
};
$('code-back').onclick = () => { challenge = null; profileError(''); drawAccount(); };
$('sign-out').onclick = async () => { await signOut(); accountState = null; challenge = null; $('home-profile').textContent = 'Account & plan'; refreshAccount(); };
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
const SITE_ORIGINS = (chrome.runtime.getManifest().content_scripts?.[0]?.matches || []).filter(match => match.startsWith('https://')).concat('<all_urls>');
$('site-access').hidden = await chrome.permissions.contains({origins: SITE_ORIGINS}).catch(() => true);
$('allow-sites').onclick = async () => {
  if (await chrome.permissions.request({origins: SITE_ORIGINS}).catch(() => false)) $('site-access').hidden = true;
};
