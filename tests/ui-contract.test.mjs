import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('market UI exposes accessible filters, favorites and detail charts without unsafe HTML insertion', () => {
  for (const id of ['search', 'filter-disclosure', 'minimum-price', 'maximum-price', 'minimum-listings', 'favorites-only', 'filter-error', 'ranking-period', 'history-dialog', 'history-chart', 'listing-chart', 'history-favorite']) {
    assert.ok(html.includes(`id="${id}"`), `Missing UI control ${id}`);
  }
  assert.match(html, /role="dialog"|<dialog[^>]+aria-labelledby/);
  assert.match(main, /aria-pressed/);
  assert.match(main, /prepareMarketPriceView\(snapshot\.items, snapshot\.currency, snapshot\.priceSource, currentFxRate\?\.rateDate\)/);
  assert.match(main, /parsePriceFilterInput\(minimumPriceInput\.value, currencySelect\.value/);
  assert.match(main, /const useUsdHistoryFallback = currencySelect\.value === 'JPY' && currentFxRate === null/);
  assert.ok(main.indexOf("makeChart(listingChart, listingPoints") < main.indexOf("if (!converted)"), 'FX failure must not hide the listings graph');
  assert.doesNotMatch(main, /\.innerHTML\s*=/);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(html, /<details id="filter-disclosure" class="filter-disclosure" open>/);
  assert.match(main, /window\.matchMedia\('\(max-width: 620px\)'\)\.matches\) filterDisclosure\.open = false/);
});
