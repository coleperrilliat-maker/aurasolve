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
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && pathname === '/forms') return true;
    if (hostname !== 'docs.google.com') return false;
    if (!pathname.startsWith('/forms/')) return false;
    // Never activate on the form editor.
    if (/\/(edit|create)$/.test(pathname) || pathname.includes('/edit')) return false;
    // Older LMS embed: /forms/viewform?id=FORM_ID
    if (/^\/forms\/(?:u\/\d+\/)?viewform$/.test(pathname)) return Boolean(searchParams.get('id'));
    // Modern share / published response pages.
    if (/viewform|formResponse|alreadyresponded|closedform/i.test(pathname)) return true;
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
