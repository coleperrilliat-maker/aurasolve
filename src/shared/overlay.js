// On-page Fill answers button. Stored in chrome.storage.local so the side
// panel can edit it and every MyLab frame picks up the same look.
export const OVERLAY_KEY = 'overlaySettings';
export const OVERLAY_ZONES = [
  {id: 'prompt-right', label: 'Next to the question (right)'},
  {id: 'prompt-left', label: 'Next to the question (left)'},
  {id: 'fixed-tr', label: 'Top right of the page'},
  {id: 'fixed-tl', label: 'Top left of the page'},
  {id: 'fixed-br', label: 'Bottom right of the page'},
  {id: 'fixed-bl', label: 'Bottom left of the page'},
  {id: 'custom', label: 'Custom (drag on the page)'},
];
export const OVERLAY_COLORS = [
  {id: '#0666f5', label: 'Blue'},
  {id: '#0f766e', label: 'Teal'},
  {id: '#7c3aed', label: 'Purple'},
  {id: '#c2410c', label: 'Orange'},
  {id: '#be123c', label: 'Red'},
  {id: '#111827', label: 'Black'},
];

export const DEFAULT_OVERLAY = {
  color: '#0666f5',
  zone: 'prompt-right',
  invisible: false,
  // custom position as percent of the viewport; used when zone is "custom"
  x: 78,
  y: 12,
  label: 'Fill answers',
};

export function normalizeOverlay(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const color = OVERLAY_COLORS.some(item => item.id === value.color) ? value.color : DEFAULT_OVERLAY.color;
  const zone = OVERLAY_ZONES.some(item => item.id === value.zone) ? value.zone : DEFAULT_OVERLAY.zone;
  const x = Number.isFinite(Number(value.x)) ? Math.min(95, Math.max(0, Number(value.x))) : DEFAULT_OVERLAY.x;
  const y = Number.isFinite(Number(value.y)) ? Math.min(95, Math.max(0, Number(value.y))) : DEFAULT_OVERLAY.y;
  const label = String(value.label || DEFAULT_OVERLAY.label).trim().slice(0, 28) || DEFAULT_OVERLAY.label;
  return {color, zone, invisible: Boolean(value.invisible), x, y, label};
}

export async function readOverlay() {
  try {
    const stored = await chrome.storage.local.get(OVERLAY_KEY);
    return normalizeOverlay(stored[OVERLAY_KEY]);
  } catch {
    return {...DEFAULT_OVERLAY};
  }
}

export async function writeOverlay(next) {
  const settings = normalizeOverlay(next);
  await chrome.storage.local.set({[OVERLAY_KEY]: settings});
  return settings;
}
