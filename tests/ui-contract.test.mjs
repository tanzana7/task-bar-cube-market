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

test('market cards use a responsive image grid and type-specific artwork fallback', () => {
  assert.match(css, /\.items\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:900px\)\{\.items\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:620px\)\{\.items\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.items>\.item\{display:flex;flex-direction:column/);
  assert.match(css, /\.items>\.item>\.item-main>\.image-box\{[^}]*aspect-ratio:1/);
  assert.match(css, /\.items>\.item>\.item-main>\.image-box img\{display:block;width:100%;height:100%;max-width:none;max-height:none;object-fit:contain\}/);
  assert.match(main, /function createItemArtwork\(name: string, imageUrl: string \| null, className: string\)/);
  assert.match(main, /image\.loading = 'lazy'/);
  assert.match(main, /image\.decoding = 'async'/);
  assert.match(main, /image\.onerror = \(\) => \{ image\.onerror = null; appendTypeGlyph\(box, type\); \}/);
  assert.match(main, /className = 'favorite-button'/);
  assert.match(main, /className = 'item-steam'/);
  assert.match(html, /id="history-image" class="history-item-art"/);
});

test('classification filters, explainable recommendations, and same-type comparison are wired into the market page', () => {
  for (const id of ['grade-options', 'minimum-grade', 'type-options', 'minimum-quality', 'maximum-quality', 'active-filters', 'recommend-open', 'recommend-dialog', 'recommend-type', 'recommend-grade', 'recommend-quality', 'recommend-budget', 'recommend-currency', 'recommend-priority', 'compare-open', 'compare-dialog']) {
    assert.ok(html.includes(`id="${id}"`), `Missing market feature ${id}`);
  }
  assert.match(main, /recommendEquipment\(currentMarketItems, options\)/);
  assert.match(main, /同じTypeの商品を選んでください/);
  assert.match(main, /最終観測/);
  assert.match(css, /\.comparison-grid/);
});
