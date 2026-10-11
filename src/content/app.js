import {snapshot,trackSelection,feedback} from "./detection.js";
import {execute,advance,nextProblem} from "./actions.js";
import {createUI} from "./ui.js";
export async function start() {
  trackSelection();
  const ui = window === window.top ? createUI() : null;
  globalThis.__aura = {snapshot,feedback,execute,advance,nextProblem,open:()=>ui?.open()};
  globalThis.__auraVeil = hidden => ui?.veil(hidden);
  return true;
}
