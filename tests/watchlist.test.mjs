import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { evaluateWatchTarget, mergeFavoriteKeys, parseWatchTargetPrice, parseWatchTargets,
  serializeWatchTargets, setWatchTarget } from '../src/watchlist.ts';

const usdBuy = { currency: 'USD', direction: 'buy-at-or-below', priceMinor: 29 };

test('watch targets round-trip by market hash name and keep the target currency', () => {
  const targets = setWatchTarget(new Map(), 'Rusty Boots 5%', usdBuy);
  const restored = parseWatchTargets(serializeWatchTargets(targets));
  assert.deepEqual(restored.get('Rusty Boots 5%'), usdBuy);
  assert.equal(setWatchTarget(restored, 'Rusty Boots 5%', null).size, 0);
});

test('watch target parser rejects malformed, fractional JPY and unsafe values', () => {
  assert.deepEqual(parseWatchTargetPrice('0.29', 'USD'), { priceMinor: 29, error: null });
  assert.deepEqual(parseWatchTargetPrice('157', 'JPY'), { priceMinor: 15700, error: null });
  assert.match(parseWatchTargetPrice('157.1', 'JPY').error, /整数/);
  assert.equal(parseWatchTargets('{bad').size, 0);
  assert.equal(parseWatchTargets(JSON.stringify({ schemaVersion: 1, targets: {
    badCurrency: { currency: 'EUR', direction: 'buy-at-or-below', priceMinor: 5 },
    badYen: { currency: 'JPY', direction: 'buy-at-or-below', priceMinor: 15701 },
  } })).size, 0);
});

test('target comparisons use same-currency values and convert only with a valid FX rate', () => {
  const now = Date.parse('2026-10-25T12:00:00.000Z');
  const freshUsd = { currency: 'USD', priceMinor: 29, observedAt: new Date(now).toISOString() };
  assert.equal(evaluateWatchTarget(usdBuy, freshUsd, null, now), 'reached');
  assert.equal(evaluateWatchTarget({ ...usdBuy, priceMinor: 28 }, freshUsd, null, now), 'not-reached');
  const yenBuy = { currency: 'JPY', direction: 'buy-at-or-below', priceMinor: 4600 };
  assert.equal(evaluateWatchTarget(yenBuy, freshUsd, 157.12, now), 'reached');
  assert.equal(evaluateWatchTarget(yenBuy, freshUsd, null, now), 'fx-unavailable');
  const yenSell = { currency: 'JPY', direction: 'sell-at-or-above', priceMinor: 4500 };
  assert.equal(evaluateWatchTarget(yenSell, freshUsd, 157.12, now), 'reached');
});

test('target state never reports reached for missing, expired or future observations', () => {
  const now = Date.parse('2026-10-25T12:00:00.000Z');
  assert.equal(evaluateWatchTarget(usdBuy, null, null, now), 'missing');
  assert.equal(evaluateWatchTarget(usdBuy, { currency: 'USD', priceMinor: 3,
    observedAt: '2026-10-23T00:00:00.000Z' }, null, now), 'stale');
  assert.equal(evaluateWatchTarget(usdBuy, { currency: 'USD', priceMinor: 3,
    observedAt: '2026-10-25T13:00:00.000Z' }, null, now), 'missing');
});

test('legacy favorites merge without deleting current entries', () => {
  assert.deepEqual([...mergeFavoriteKeys(new Set(['current']), ['["old", "current"]', '{bad'])].sort(), ['current', 'old']);
});

test('public watchlist preview is noindex and uses isolated, explicitly fictional data', async () => {
  const html = await readFile(resolve('watchlist-preview.html'), 'utf8');
  const fixture = JSON.parse(await readFile(resolve('public/watchlist-preview-market.json'), 'utf8'));
  assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(html, /data-preview="watchlist"/);
  assert.match(html, /架空です/);
  assert.equal(fixture.appid, 5084200);
  assert.equal(fixture.items.length, 3);
  assert.ok(fixture.items.every(item => item.name.startsWith('DEMO · ')));
  assert.equal(fixture.items.some(item => !item.marketHashName.startsWith('DEMO - ')), false);
});
