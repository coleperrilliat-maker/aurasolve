import {inspectControls} from './diagnostics.js';
import {snapshot,trackSelection,feedback,prepareField,revealQuestion} from "./detection.js";
import {execute,advance,nextProblem,clickControl,dismissFeedback,stayOnIncompleteQuestion,navigateQuestion,incorrectNotice,askRetry} from "./actions.js";
import {createUI} from "./ui.js";
import {captureFigures} from './figures.js';
import {startForms} from './gforms.js';
import {isGoogleForm} from '../shared/form-answer.js';
export async function start() {
  trackSelection();
  const forms = isGoogleForm(location.href) || /\/forms\/?$/.test(location.pathname);
  if (forms) await startForms();
  const ui = forms ? null : createUI();
  globalThis.__aura = {inspectControls,snapshot,feedback,execute,advance,nextProblem,clickControl,dismissFeedback,stayOnIncompleteQuestion,navigateQuestion,prepareField,revealQuestion,incorrectNotice,askRetry,captureFigures,open:()=>ui?.open()};
  globalThis.__auraVeil = hidden => ui?.veil(hidden);
  return true;
}

