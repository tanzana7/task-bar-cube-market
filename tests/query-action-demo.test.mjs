import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const demo = JSON.parse(await readFile(new URL('../public/query-action-demo.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('../public/query-action-demo.html', import.meta.url), 'utf8');
const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
const sitemap = await readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8');

test('public queryAction demo is explicitly isolated, unindexed, and contains only the TBH fixture sample', () => {
  assert.equal(demo.demo, true);
  assert.equal(demo.appid, 3678970);
  assert.equal(demo.gameName, 'Task Bar Hero');
  assert.equal(demo.requestCurrencyId, null);
  assert.equal(demo.fixtureResponseCurrencyId, 1);
  assert.equal(demo.capturedAt, null);
  assert.equal(demo.completeCatalog, false);
  assert.equal(demo.products.length, 30);
  assert.equal(new Set(demo.products.map(product => product.marketHashName)).size, 30);
  assert.ok(demo.products.every(product => product.displayedSubtotal === '$0.03'
    && product.steamUrl.startsWith('https://steamcommunity.com/market/listings/3678970/')));
  assert.match(html, /noindex, nofollow, noarchive/);
  assert.match(html, /テスト表示・価格基準検証中/);
  assert.match(html, /取得日時と対応するリクエスト通貨は記録されておらず/);
  assert.match(headers, /X-Robots-Tag: noindex, nofollow, noarchive/);
  assert.doesNotMatch(sitemap, /query-action-demo/);
});

test('public demo renderer validates data, filters/sorts locally, and creates Steam links via DOM APIs', async () => {
  const script = await readFile(new URL('../public/query-action-demo.js', import.meta.url), 'utf8');
  assert.match(script, /value\.demo === true/);
  assert.match(script, /candidate\.products\.length !== candidate\.returnedProductTypes/);
  assert.match(script, /search\.addEventListener\('input'/);
  assert.match(script, /sort\.addEventListener\('change'/);
  assert.match(script, /document\.createElement\('a'\)/);
  assert.doesNotMatch(script, /innerHTML\s*=/);
});
