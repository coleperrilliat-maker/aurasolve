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
    const {hostname, pathname, searchParams} = new URL(url);
    if (hostname !== 'docs.google.com' && hostname !== 'localhost' && hostname !== '127.0.0.1') return false;
    // Modern share link: /forms/d/.../viewform or /forms/d/e/.../viewform
    if (hostname === 'docs.google.com' && /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[^/]+\/(?:viewform|formResponse)/.test(pathname)) return true;
    // Older / LMS embed link: /forms/viewform?id=FORM_ID&embedded=true
    if (hostname === 'docs.google.com' && /^\/forms\/(?:u\/\d+\/)?viewform$/.test(pathname) && searchParams.get('id')) return true;
    // Local practice page used by the demo server and tests.
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && pathname === '/forms') return true;
    return false;
  } catch { return false; }
}

export function selectionLooksActive(selection) {
  return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
}

export function classifyFormControls({title, radios=[], boxes=[], listbox=[], text=false, area=false, radiogroups=0}) {
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const heading = clean(title).replace(/\s*\*$/, '');
  if (!heading) return null;
  if (radios.length && radiogroups > 1) return null;
  let kind = null, options = [];
  if (boxes.length && !radios.length) { kind = 'checkbox'; options = boxes; }
  else if (radios.length) { kind = 'radio'; options = radios; }
  else if (listbox.length) { kind = 'dropdown'; options = listbox; }
  else if (area) kind = 'paragraph';
  else if (text) kind = 'text';
  if (!kind) return null;
  options = [...new Set(options.map(clean).filter(value => value && !/^(choose|other:?)$/i.test(value)))];
  if (['radio', 'checkbox', 'dropdown'].includes(kind) && !options.length) return null;
  return {kind, title: heading, options};
}
