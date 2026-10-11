import {snapshot,trackSelection,feedback} from "./detection.js";
import {execute,advance} from "./actions.js";
import {createUI} from "./ui.js";
export async function start() {
  trackSelection();
  const ui = window === window.top ? createUI() : null;
  globalThis.__aura = {snapshot,feedback,execute,advance,open:()=>ui?.open()};
  return true;
}
