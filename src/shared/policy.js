// Honor code: the student, not page heuristics, decides whether an activity is graded.
export const HONOR_STATEMENT = "This is not a graded homework assignment";
const normalize = text => String(text || "").toLowerCase().replace(/[.!\s]+$/, "").replace(/\s+/g, " ").trim();
export const statementMatches = text => normalize(text) === normalize(HONOR_STATEMENT);
export function validateConsent(grant, url, now = Date.now()) {
  if (!grant || grant.url !== url || grant.expires < now || !statementMatches(grant.statement) || !grant.signature?.trim())
    throw new Error(`Type "${HONOR_STATEMENT}" and sign your name for this page first.`);
}
export function fingerprint(value) {
  let h = 2166136261;
  for (const ch of String(value)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
}
