// Matching a model's answer back to a Google Forms choice.
const fold = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const bare = value => fold(value).replace(/^[a-z0-9][.)]\s+/, '').replace(/[^\p{L}\p{N}]+/gu, '');

export function matchOption(options, wanted) {
  const list = options.map(String);
  const exact = list.find(option => option === wanted);
  if (exact != null) return exact;
  const folded = list.find(option => fold(option) === fold(wanted));
  if (folded != null) return folded;
  const stripped = list.filter(option => bare(option) && bare(option) === bare(wanted));
  return stripped.length === 1 ? stripped[0] : null;
}

export function isGoogleForm(url) {
  try {
    const {hostname, pathname} = new URL(url);
    return hostname === 'docs.google.com' && /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[^/]+\/(?:viewform|formResponse)/.test(pathname);
  } catch { return false; }
}
