import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_OVERLAY, normalizeOverlay, OVERLAY_ZONES} from '../src/shared/overlay.js';

test('overlay settings keep known values and repair bad ones', () => {
  assert.deepEqual(normalizeOverlay(null), DEFAULT_OVERLAY);
  assert.equal(normalizeOverlay({color: '#be123c', zone: 'fixed-bl', invisible: true, label: 'Go', x: 10, y: 20}).color, '#be123c');
  assert.equal(normalizeOverlay({zone: 'nowhere'}).zone, DEFAULT_OVERLAY.zone);
  assert.equal(normalizeOverlay({color: 'neon'}).color, DEFAULT_OVERLAY.color);
  assert.equal(normalizeOverlay({x: 200, y: -4}).x, 95);
  assert.equal(normalizeOverlay({x: 200, y: -4}).y, 0);
  assert.equal(normalizeOverlay({label: '  a'.repeat(40)}).label.length, 28);
  assert.ok(OVERLAY_ZONES.some(zone => zone.id === 'custom'));
});

test('invisible mode is a boolean and custom zone stays available', () => {
  const settings = normalizeOverlay({invisible: 1, zone: 'custom', x: 50, y: 40});
  assert.equal(settings.invisible, true);
  assert.equal(settings.zone, 'custom');
  assert.equal(settings.x, 50);
  assert.equal(settings.y, 40);
  assert.equal(settings.showShot, true);
  assert.equal(normalizeOverlay({showShot: false}).showShot, false);
  assert.equal(settings.showFill, true);
  assert.equal(normalizeOverlay({showFill: false}).showFill, false);
  assert.equal(normalizeOverlay({}).highlight, false);
  assert.equal(normalizeOverlay({highlight: true, showFill: false, showShot: false}).highlight, true);
});
