import {runFillAssignment} from '../shared/pilot-engine.js';
import {sendExtension} from '../shared/messaging.js';

// Offscreen page that runs AutoPilot, so it keeps going after the popup closes.
// Offscreen pages only get chrome.runtime; status goes back through the worker.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = status => sendExtension({type: 'pilotStatus', status}).catch(() => {});
let token = 0;

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'pilot') return false;
  if (message.action === 'start') run(message.tabId, message.settings || {});
  if (message.action === 'stop') token++;
  reply({ok: true});
  return false;
});

async function run(tabId, settings) {
  const mine = ++token;
  const live = () => { if (mine !== token) throw new Error('Stopped.'); };
  const request = async message => { const response = await sendExtension({...message, pilotTabId: message.pilotTabId ?? tabId}); live(); return response; };
  const delay = async ms => { let left = ms; while (left > 0) { const step = Math.min(100, left); await sleep(step); live(); left -= step; } };
  let since = Date.now(), current = null, completed = 0;
  report({running: true, text: 'Starting…'});
  try {
    const health = await request({type: 'settingsStatus'});
    if (!health.configured) throw new Error('AuraSolve Cloud is offline. Try again in a minute.');
    await request({type: 'inspect'});
    await runFillAssignment({
      request, delay,
      checkpoint: async () => live(),
      limit: Number(settings.limit) || 0,
      budget: Number(settings.budget) || 200,
      pace: async () => {
        const min = Number(settings.min) || 20, max = Number(settings.max) || min;
        const seconds = settings.speed ? 0 : min + (settings.random ? 10 * Math.floor(Math.random() * ((max - min) / 10 + 1)) : 0);
        // Pace is the total time per question, so time already spent solving counts.
        await delay(Math.max(0, seconds - (Date.now() - since) / 1000) * 1000);
      },
      onEvent: async event => {
        live();
        if (event.kind === 'solve') {
          if (event.number !== current) { current = event.number; since = Date.now(); }
          report({running: true, text: `${event.retry ? 'Retrying' : 'Solving'} question ${event.number}${event.part > 1 ? `, part ${event.part}` : ''}`});
        }
        if (event.kind === 'similar') report({running: true, text: `Redoing question ${event.number}`});
        if (event.kind === 'next') report({running: true, text: `Moving past question ${event.number}`});
        if (event.kind === 'done') completed = event.completed;
      },
    });
    report({running: false, text: `Finished ${completed} question${completed === 1 ? '' : 's'}`});
  } catch (error) {
    if (error.message === 'Stopped.') return;
    report({running: false, text: error.message, error: true});
  }
}
