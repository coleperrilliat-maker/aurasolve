import {snapshot,elementFor,visible,findButton,feedback} from "./detection.js";
import {validateSolution} from "../shared/solution.js";
import {sendExtension} from '../shared/messaging.js';
function guard() {
  if (document.hidden) throw new Error("The practice page is hidden. AutoPilot stopped.");
}
function setValue(el,value) {
  el.focus?.();
  if (el.isContentEditable) {
    const selection = window.getSelection(), range = document.createRange();
    range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range);
    if (!document.execCommand('insertText',false,value) || el.textContent !== value) throw new Error('The editable field did not retain the answer. Review it manually.');
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.blur?.();
    if (el.textContent !== value) throw new Error('The page changed the answer after filling. Review it manually.');
    return;
  }
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto,"value")?.set;
  if (!setter) throw new Error("This field cannot be filled safely.");
  setter.call(el,value);
  el.dispatchEvent(new Event("input",{bubbles:true}));
  el.dispatchEvent(new Event("change",{bubbles:true}));
  el.blur?.();
  if (el.value !== value) throw new Error("The page did not retain the requested value.");
}
export async function execute(plan) {
  guard();
  const current = snapshot();
  if (current.hash !== plan.hash || current.url !== plan.url) throw new Error("The question changed. Generate a new answer first.");
  validateSolution(plan.solution,current,plan.mode);
  if (!plan.solution.supported || plan.solution.confidence < 0.85 || !plan.solution.actions.length) throw new Error("This answer needs manual review; automatic filling is unavailable.");
  if (plan.submit && current.limitations.some(l=>!plan.visualRead || !/Canvas\/SVG|image has no description/.test(l))) throw new Error("This question contains unsupported controls. AutoPilot stopped.");
  if (plan.submit) {
    const targets = new Set(plan.solution.actions.map(a=>a.target));
    for (const f of current.fields) {
      const covered = f.kind === "radio" ? current.fields.some(other=>other.kind === "radio" && other.group === f.group && targets.has(other.id)) : targets.has(f.id);
      if (!covered) throw new Error("The solution does not cover all answer fields. Nothing was submitted.");
    }
  }
  // Validate every target and submit control before making any changes.
  for (const a of plan.solution.actions) {
    const el = elementFor(a.target);
    if (!visible(el) || el.disabled || el.readOnly) throw new Error("An answer field is no longer available.");
  }
  if (plan.submit && !plan.deferSubmit) findButton("submit");
  for (const a of plan.solution.actions) {
    guard();
    const el = elementFor(a.target);
    const field = current.fields.find(f=>f.id === a.target);
    if (field.editorKey) {
      await sendExtension({type:'writeEditor',planId:plan.id,target:a.target});
    }
    else if (a.kind === "text" || a.kind === "select") setValue(el,a.value);
    else if (a.kind === "radio") { el.click(); if (!el.checked) throw new Error("The radio answer was not accepted by the page."); }
    else if (a.kind === "checkbox") { if (el.checked !== (a.value === "true")) el.click(); if (el.checked !== (a.value === "true")) throw new Error("Checkbox state was not retained."); }
    else if (a.kind === "point") {
      const f = current.fields.find(f=>f.id === a.target), r = el.getBoundingClientRect(), b = f.bounds;
      const x = r.left + (a.x-b.xMin)/(b.xMax-b.xMin)*r.width;
      const y = r.bottom - (a.y-b.yMin)/(b.yMax-b.yMin)*r.height;
      for (const type of ["pointerdown","pointerup"]) el.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:x,clientY:y,pointerId:1,pointerType:"mouse",buttons:type==="pointerdown"?1:0}));
      el.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:x,clientY:y}));
      if (Number(el.dataset.auraPointX) !== a.x || Number(el.dataset.auraPointY) !== a.y) throw new Error("The graph did not confirm the point. Complete it manually.");
    } else if (a.kind === "drag") {
      const dest = elementFor(a.destination);
      if (!visible(dest)) throw new Error("The drop target disappeared.");
      const dataTransfer = new DataTransfer();
      el.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer}));
      dest.dispatchEvent(new DragEvent("dragenter",{bubbles:true,cancelable:true,dataTransfer}));
      dest.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer}));
      dest.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer}));
      el.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer}));
      if (!dest.contains(el)) throw new Error("The page did not confirm the drop. Complete it manually.");
    }
  }
  guard();
  if (plan.submit && !plan.deferSubmit) findButton("submit").click();
  return {filled:plan.solution.actions.length,submitted:plan.submit && !plan.deferSubmit};
}
export function clickControl(kind) {
  guard();
  if (!['submit','next'].includes(kind)) throw new Error('Unknown control.');
  findButton(kind).click();
  return {clicked:true};
}
export function nextProblem() {
  guard();
  let button;
  try { button = findButton("next"); } catch { return {clicked:false}; }
  button.click();
  return {clicked:true};
}
export function advance() {
  guard();
  if (feedback().state !== "correct") throw new Error("No correct-answer feedback was detected. Continue manually.");
  findButton("next").click();
  return {advanced:true};
}

