// Crop a visible-tab bitmap down to the question, including its picture choices.
export function cropBox(bitmap, rect, dpr = 1) {
  if (!bitmap || !rect || !(rect.width > 40) || !(rect.height > 40)) return null;
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const pad = Math.round(16 * scale);
  const sx = Math.max(0, Math.round(rect.x * scale) - pad);
  const sy = Math.max(0, Math.round(rect.y * scale) - pad);
  const sw = Math.min(bitmap.width - sx, Math.round(rect.width * scale) + pad * 2);
  const sh = Math.min(bitmap.height - sy, Math.round(rect.height * scale) + pad * 2);
  if (sw < 40 || sh < 40) return null;
  return {sx, sy, sw, sh};
}
