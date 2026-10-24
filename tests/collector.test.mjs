import test from 'node:test';
import assert from 'node:assert/strict';
import { APPID, collect, normalizeResult, parsePage, searchUrl } from '../scripts/steam-market.mjs';

test('Steam URL stays scoped to Task Bar Cube', () => {
  const url = new URL(searchUrl(10));
  assert.equal(url.searchParams.get('appid'), String(APPID));
  assert.equal(url.searchParams.get('start'), '10');
});

test('normalizes identifiers, prices and listing links without guessing fields', () => {
  const item = normalizeResult({ name: 'Cube A', sell_price: 123, sell_price_text: '$1.23', sell_listings: 7,
    asset_description: { appid: 5084200, market_hash_name: 'Cube A #' } });
  assert.equal(item.priceMinor, 123);
  assert.equal(item.listings, 7);
  assert.equal(item.steamUrl, 'https://steamcommunity.com/market/listings/5084200/Cube%20A%20%23');
  assert.equal(normalizeResult({ name: 'Wrong', asset_description: { appid: 3678970 } }), null);
});

test('rejects incomplete or malformed Steam pages', () => {
  assert.throws(() => parsePage({ success: false, start: 0, total_count: 0, results: [] }, 0));
  assert.throws(() => parsePage({ success: true, start: 0, total_count: 1, results: [] }, 0));
});

test('empty result is distinct from failed fetch', async () => {
  const empty = await collect(async () => ({ ok: true, status: 200, json: async () => ({ success: true, start: 0, total_count: 0, pagesize: 10, results: [] }) }));
  assert.equal(empty.status, 'empty');
  await assert.rejects(collect(async () => ({ ok: false, status: 429 })), /access stopped/);
});
