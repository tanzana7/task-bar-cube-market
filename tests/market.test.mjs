import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSort, isFxRateExpired, prepareMarketPriceView } from '../src/market.ts';

const item = (name, priceMinor, priceText = null) => ({
  name, priceMinor, priceText, listings: null, imageUrl: null, marketHashName: name, steamUrl: '',
});

test('search ignores case and trims input', () => {
  assert.deepEqual(filterAndSort([item('Blue Cube', 100), item('Red Cube', 200)], '  bLuE ', 'name').map(x => x.name), ['Blue Cube']);
});

test('price sorts both directions with stable name ties and missing last', () => {
  const items = [item('Z', 100, '$1.00'), item('B', null), item('A', 100, '$1.00'), item('C', 50, '$0.50')];
  assert.deepEqual(filterAndSort(items, '', 'price-asc').map(x => x.name), ['C', 'A', 'Z', 'B']);
  assert.deepEqual(filterAndSort(items, '', 'price-desc').map(x => x.name), ['A', 'Z', 'C', 'B']);
});

test('price ordering is applied within each currency snapshot', () => {
  const jpy = [item('Z', 100, '¥1'), item('A', 200, '¥2')];
  const usd = [item('A', 100, '$1.00'), item('Z', 200, '$2.00')];
  assert.deepEqual(filterAndSort(jpy, '', 'price-asc').map(x => x.name), ['Z', 'A']);
  assert.deepEqual(filterAndSort(usd, '', 'price-asc').map(x => x.name), ['A', 'Z']);
});

test('fresh FX prices remain visible and sortable', () => {
  const now = Date.parse('2026-10-25T09:00:00Z');
  const items = [item('Cube B', 600, '¥6'), item('Cube A', 500, '¥5')];
  assert.equal(isFxRateExpired('2026-10-25', now), false);
  const view = prepareMarketPriceView(items, 'JPY', 'fx', '2026-10-25', now);
  assert.equal(view.expiredFx, false);
  assert.deepEqual(filterAndSort(view.items, '', 'price-asc').map(x => x.name), ['Cube A', 'Cube B']);
  assert.equal(view.items[0].priceText, '¥6');
});

test('expired FX hides only prices while preserving searchable, sortable item data', () => {
  const now = Date.parse('2026-10-25T09:00:00Z');
  const items = [
    { ...item('Cube B', 600, '¥6'), listings: 4, imageUrl: 'https://community.cloudflare.steamstatic.com/image.png', steamUrl: 'https://steamcommunity.com/market/listings/5084200/Cube%20B' },
    { ...item('Cube A', 500, '¥5'), listings: 2, imageUrl: null, steamUrl: 'https://steamcommunity.com/market/listings/5084200/Cube%20A' },
  ];
  assert.equal(isFxRateExpired('2026-10-20', now), true);
  assert.equal(isFxRateExpired('invalid', now), true);
  assert.equal(isFxRateExpired('2026-02-31', now), true);
  const view = prepareMarketPriceView(items, 'JPY', 'fx', '2026-10-20', now);
  assert.equal(view.expiredFx, true);
  assert.deepEqual(filterAndSort(view.items, 'cube', 'price-asc').map(x => x.name), ['Cube A', 'Cube B']);
  assert.deepEqual(view.items.map(({ priceMinor, priceText }) => [priceMinor, priceText]), [[null, null], [null, null]]);
  assert.equal(view.items[0].listings, 4);
  assert.equal(view.items[0].imageUrl, items[0].imageUrl);
  assert.equal(view.items[0].steamUrl, items[0].steamUrl);
  const usdView = prepareMarketPriceView([item('Cube A', 100, '$1.00')], 'USD', 'steam', '2026-10-20', now);
  assert.equal(usdView.expiredFx, false);
  assert.equal(usdView.items[0].priceText, '$1.00');
});
