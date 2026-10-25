import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('market UI exposes accessible filters, favorites and detail charts without unsafe HTML insertion', () => {
  for (const id of ['search', 'minimum-price', 'maximum-price', 'minimum-listings', 'favorites-only', 'ranking-period', 'history-dialog', 'history-chart', 'listing-chart', 'history-favorite']) {
    assert.ok(html.includes(`id="${id}"`), `Missing UI control ${id}`);
  }
  assert.match(html, /role="dialog"|<dialog[^>]+aria-labelledby/);
  assert.match(main, /aria-pressed/);
  assert.match(main, /prepareMarketPriceView\(snapshot\.items, snapshot\.currency, snapshot\.priceSource, currentFxRate\?\.rateDate\)/);
  assert.doesNotMatch(main, /\.innerHTML\s*=/);
  assert.match(css, /@media\(max-width:620px\)/);
});
