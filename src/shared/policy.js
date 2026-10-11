// The confirmation is additional consent, never evidence that a page is practice.
export function classify(context = "") {
  const text = String(context).toLowerCase().replace(/[_/\-]+/g, " ");
  const normalized = text.replace(/\b(?:ungraded|not graded|non graded)\b/g, " practice ");
  if (/\b(exam|quiz|test|assessment|graded|gradebook|proctored|homework|due date|points possible|time remaining)\b/.test(normalized))
    return { state: "blocked", reason: "An assignment, test, or grading indicator was detected. Explain mode remains available." };
  if (/\b(practice|study plan|self study)\b/.test(normalized))
    return { state: "practice", reason: "Practice indicator found. Confirm that this activity is ungraded before filling or submitting." };
  return { state: "unknown", reason: "This page is not clearly marked as ungraded practice. Explain mode is available; filling and AutoPilot are disabled." };
}
export function requirePractice(contexts) {
  const states = contexts.map(classify);
  const blocked = states.find(s => s.state === "blocked");
  if (blocked) throw new Error(blocked.reason);
  if (!states.some(s => s.state === "practice")) throw new Error(classify("").reason);
}
export function validateConsent(grant, url, now = Date.now()) {
  if (!grant || grant.url !== url || grant.expires < now || !grant.signature?.trim())
    throw new Error("Confirm and sign the practice-only notice for this page first.");
}
export function fingerprint(value) {
  let h = 2166136261;
  for (const ch of String(value)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
}
