import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APPID, collect, normalizeResult, parsePage, saveSnapshot, searchUrl, validateSnapshot } from '../scripts/steam-market.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/steam-pages.json', import.meta.url), 'utf8'));
const response = body => ({ ok: true, status: 200, json: async () => body });
const mockPages = pages => async url => {
  const start = Number(new URL(url).searchParams.get('start'));
  assert.ok(pages[start], `Unexpected page ${start}`);
  return response(pages[start]);
};
const immediate = async () => {};

test('Steam URLs are scoped to the requested app and currency', () => {
  for (const [currency, code, country] of [['JPY', '8', 'JP'], ['USD', '1', 'US']]) {
    const url = new URL(searchUrl(10, currency));
    assert.equal(url.searchParams.get('appid'), String(APPID));
    assert.equal(url.searchParams.get('currency'), code);
    assert.equal(url.searchParams.get('country'), country);
    assert.equal(url.searchParams.get('start'), '10');
  }
});

test('normalizes verified price, listing count and encoded Steam link', () => {
  const item = normalizeResult({ name: 'Cube A', sell_price: 123, sell_price_text: '$1.23', sell_listings: 7,
    asset_description: { appid: APPID, market_hash_name: 'Cube A #' } }, 'USD');
  assert.equal(item.priceMinor, 123);
  assert.equal(item.listings, 7);
  assert.equal(item.steamUrl, 'https://steamcommunity.com/market/listings/5084200/Cube%20A%20%23');
  assert.throws(() => normalizeResult({ name: 'Wrong', asset_description: { appid: 3678970, market_hash_name: 'Wrong' } }, 'USD'));
  assert.throws(() => normalizeResult({ name: 'Missing' }, 'USD'));
});

test('handles missing start and pagesize while checking every page', async () => {
  const jpy = await collect('JPY', mockPages(fixture.JPY), immediate);
  const usd = await collect('USD', mockPages(fixture.USD), immediate);
  assert.equal(jpy.items.length, 3);
  assert.equal(usd.items.length, 3);
  assert.equal(jpy.items[0].priceText, '¥100');
  assert.equal(usd.items[0].priceText, '$1.00');
  validateSnapshot(jpy, 'JPY');
  validateSnapshot(usd, 'USD');
});

test('rejects incomplete, mismatched and blocked pages', async () => {
  assert.throws(() => parsePage({ success: false, total_count: 0, results: [] }, 0));
  assert.throws(() => parsePage({ success: true, total_count: 1, results: [] }, 0));
  await assert.rejects(collect('JPY', mockPages({ 0: fixture.JPY[0], 2: { ...fixture.JPY[2], results: [] } }), immediate), /incomplete/);
  await assert.rejects(collect('JPY', mockPages({ 0: fixture.JPY[0], 2: { ...fixture.JPY[2], total_count: 4 } }), immediate), /shape changed/);
  await assert.rejects(collect('JPY', async () => ({ ok: false, status: 429 }), immediate), /access stopped/);
  await assert.rejects(collect('JPY', async () => { throw new Error('offline'); }, immediate), /network request failed/);
});

test('rejects currency mismatch and missing identifiers', async () => {
  await assert.rejects(collect('JPY', mockPages(fixture.USD), immediate), /Currency could not be verified/);
  await assert.rejects(collect('USD', mockPages({ 0: { success: true, total_count: 1, results: [{ name: 'No hash' }] } }), immediate), /identifier missing/);
});

test('deduplicates repeated rows using higher listing count', async () => {
  const base = fixture.JPY[0].results[0];
  const pages = { 0: { success: true, total_count: 2, results: [base, { ...base, sell_listings: 9 }] } };
  const result = await collect('JPY', mockPages(pages), immediate);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].listings, 9);
});

test('zero results remain unverified and cannot erase a populated cache', async () => {
  const empty = await collect('JPY', mockPages({ 0: { success: true, total_count: 0, results: [] } }), immediate);
  assert.equal(empty.status, 'unavailable');
  const dir = await mkdtemp(join(tmpdir(), 'tbcm-test-'));
  const path = pathToFileURL(join(dir, 'market-jpy.json'));
  try {
    const populated = await collect('JPY', mockPages(fixture.JPY), immediate);
    await writeFile(path, JSON.stringify(populated));
    await assert.rejects(saveSnapshot(empty, 'JPY', path), /Refusing to replace/);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).items.length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
