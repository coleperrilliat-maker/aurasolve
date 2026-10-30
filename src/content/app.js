import {inspectControls} from './diagnostics.js';
import {snapshot,trackSelection,feedback,prepareField,revealQuestion} from "./detection.js";
import {execute,advance,nextProblem,clickControl,dismissFeedback,stayOnIncompleteQuestion,navigateQuestion,incorrectNotice,askRetry} from "./actions.js";
import {createUI} from "./ui.js";
import {captureFigures} from './figures.js';
export async function start() {
  trackSelection();
  const ui = createUI();
  globalThis.__aura = {inspectControls,snapshot,feedback,execute,advance,nextProblem,clickControl,dismissFeedback,stayOnIncompleteQuestion,navigateQuestion,prepareField,revealQuestion,incorrectNotice,askRetry,captureFigures,open:()=>ui?.open()};
  globalThis.__auraVeil = hidden => ui?.veil(hidden);
  return true;
}

