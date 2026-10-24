import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSort } from '../src/market.ts';

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

test('different currency symbols are not compared numerically', () => {
  assert.deepEqual(filterAndSort([item('Z', 1, '¥1'), item('A', 1000, '$10')], '', 'price-asc').map(x => x.name), ['A', 'Z']);
});
