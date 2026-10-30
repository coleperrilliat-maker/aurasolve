// A Pearson player layout is mostly empty. Keep the diagram, prompt, and blanks.
export function preferContentRect(full, tight) {
  if (!tight || !(tight.width > 40) || !(tight.height > 40)) return full || null;
  if (!full || !(full.width > 0) || !(full.height > 0)) return tight;
  if (tight.width * tight.height < full.width * full.height * 0.6) return tight;
  return full;
}
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
