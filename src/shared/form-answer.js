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

export function isCanvasHost(hostname) {
  return /(^|\.)instructure\.com$/i.test(hostname) || /^canvas\./i.test(hostname);
}

export function isCanvasQuiz(url) {
  try {
    const {hostname, pathname} = new URL(url);
    if (!isCanvasHost(hostname)) return false;
    return /\/quizzes\/\d+\/take(?:\/|$)/.test(pathname);
  } catch { return false; }
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

export const IMAGE_ONLY_TITLE = 'The question is shown in the attached image.';

export function classifyFormControls({title, radios=[], boxes=[], listbox=[], text=false, area=false, radiogroups=0, grid=null, date=false, time=false, images=0}) {
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const unique = list => [...new Set(list.map(clean).filter(value => value && !/^(choose|other:?)$/i.test(value)))];
  const heading = clean(title).replace(/\s*\*$/, '') || (images ? IMAGE_ONLY_TITLE : '');
  if (!heading) return null;
  if (grid?.rows?.length) {
    const rows = unique(grid.rows), options = unique(grid.columns || []);
    if (!rows.length || !options.length) return null;
    return {kind: grid.multi ? 'checkgrid' : 'grid', title: heading, options, rows};
  }
  if (radios.length && radiogroups > 1) return null;
  if (date) return {kind: 'date', title: heading, options: [], rows: []};
  if (time) return {kind: 'time', title: heading, options: [], rows: []};
  let kind = null, options = [];
  if (boxes.length && !radios.length) { kind = 'checkbox'; options = boxes; }
  else if (radios.length) { kind = 'radio'; options = radios; }
  else if (listbox.length) { kind = 'dropdown'; options = listbox; }
  else if (area) kind = 'paragraph';
  else if (text) kind = 'text';
  if (!kind) return null;
  options = unique(options);
  if (['radio', 'checkbox', 'dropdown'].includes(kind) && !options.length) return null;
  return {kind, title: heading, options, rows: []};
}

export function parseFormDate(text) {
  const match = String(text ?? '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {year, month, day, iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`};
}

export function parseFormTime(text) {
  const match = String(text ?? '').match(/(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.[0]?.toLowerCase();
  if (meridiem === 'p' && hour < 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return {hour, minute, hour12: hour % 12 || 12, pm: hour >= 12};
}
