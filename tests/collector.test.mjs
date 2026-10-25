import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APPID, collect, collectPair, normalizeResult, parsePage, parsePriceMinor, saveSnapshot, saveSnapshotPair, searchUrl, validateSnapshot } from '../scripts/steam-market.mjs';

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

test('observed TBH fields normalize without entering the Cube cache', async () => {
  const page = JSON.parse(await readFile(new URL('./fixtures/tbh-search-page.json', import.meta.url), 'utf8'));
  parsePage(page, 0);
  const item = normalizeResult(page.results[0], 'USD', 3678970);
  assert.equal(item.priceMinor, 517);
  assert.equal(item.priceText, '$5.17');
  assert.equal(item.listings, 26);
  assert.equal(item.steamUrl, 'https://steamcommunity.com/market/listings/3678970/Contaminated%20Reliquary%20(Beyond)');
  assert.ok(item.imageUrl.startsWith('https://community.cloudflare.steamstatic.com/economy/image/'));
  assert.throws(() => normalizeResult(page.results[0], 'USD'), /Unexpected Steam appid/);
  assert.throws(() => normalizeResult(page.results[0], 'JPY', 3678970), /Currency could not be verified/);
});

test('accepts documented currency symbols and spacing, with matching hundredths', () => {
  assert.equal(parsePriceMinor('¥ 1,000', 'JPY'), 100000);
  assert.equal(parsePriceMinor('￥　1,000', 'JPY'), 100000);
  assert.equal(parsePriceMinor('¥\u00a01,000', 'JPY'), 100000);
  assert.equal(parsePriceMinor('US$ 1,234.56', 'USD'), 123456);
  assert.equal(parsePriceMinor('$\u00a01.23 USD', 'USD'), 123);
  assert.equal(parsePriceMinor('¥100', 'USD'), null);
  assert.equal(parsePriceMinor('$1.00', 'JPY'), null);
  assert.equal(parsePriceMinor('CNY¥100', 'JPY'), null);
  assert.equal(parsePriceMinor('CAD$1.00', 'USD'), null);
  assert.equal(parsePriceMinor('$1,00.00', 'USD'), null);
  assert.equal(parsePriceMinor('¥1.50', 'JPY'), null);
  assert.equal(parsePriceMinor('¥ 1 000', 'JPY'), null);
  assert.throws(() => normalizeResult({ name: 'Cube', sell_price: 100, sell_price_text: '¥100', asset_description: { market_hash_name: 'Cube' } }, 'JPY'), /disagree/);
  const missing = normalizeResult({ name: 'Cube', sell_price: 100, asset_description: { market_hash_name: 'Cube' } }, 'JPY');
  assert.equal(missing.priceMinor, null);
  assert.equal(missing.priceText, null);
  const missingAmount = normalizeResult({ name: 'Cube', sell_price_text: '$1.00', asset_description: { market_hash_name: 'Cube' } }, 'USD');
  assert.equal(missingAmount.priceMinor, null);
  assert.equal(missingAmount.priceText, null);
  assert.throws(() => validateSnapshot({ schemaVersion: 2, appid: APPID, currency: 'USD', status: 'ok', items: [{ name: 'Cube', marketHashName: 'Cube', priceText: '$1.00', priceMinor: null }] }, 'USD'), /Invalid market item/);
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
  const partial = async url => Number(new URL(url).searchParams.get('start')) === 0
    ? response(fixture.JPY[0]) : Promise.reject(new Error('connection lost'));
  await assert.rejects(collect('JPY', partial, immediate), /network request failed/);
  await assert.rejects(collect('JPY', mockPages({
    0: fixture.JPY[0],
    2: { ...fixture.JPY[2], start: 1 },
  }), immediate), /shape changed/);
});

test('rejects currency mismatch and missing identifiers', async () => {
  await assert.rejects(collect('JPY', mockPages(fixture.USD), immediate), /Currency could not be verified/);
  await assert.rejects(collect('USD', mockPages({ 0: { success: true, total_count: 1, results: [{ name: 'No hash' }] } }), immediate), /identifier missing/);
});

test('rejects repeated rows because they can mask skipped listings', async () => {
  const base = fixture.JPY[0].results[0];
  const pages = { 0: { success: true, total_count: 2, results: [base, { ...base, sell_listings: 9 }] } };
  await assert.rejects(collect('JPY', mockPages(pages), immediate), /duplicate/);
  const acrossPages = {
    0: fixture.JPY[0],
    2: { ...fixture.JPY[2], results: [fixture.JPY[0].results[0]] },
  };
  await assert.rejects(collect('JPY', mockPages(acrossPages), immediate), /duplicate/);
});

test('a failure in USD prevents either currency from being written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbcm-pair-'));
  const jpyPath = pathToFileURL(join(dir, 'market-jpy.json'));
  const usdPath = pathToFileURL(join(dir, 'market-usd.json'));
  const prior = '{"status":"ok","items":[{"name":"old"}]}';
  try {
    await writeFile(jpyPath, prior);
    await writeFile(usdPath, prior);
    const fetchImpl = async url => {
      const params = new URL(url).searchParams;
      if (params.get('currency') === '1') return { ok: false, status: 403 };
      return mockPages(fixture.JPY)(url);
    };
    await assert.rejects(collectPair(fetchImpl, immediate), /access stopped/);
    assert.equal(await readFile(jpyPath, 'utf8'), prior);
    assert.equal(await readFile(usdPath, 'utf8'), prior);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pair writes only after both snapshots validate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbcm-save-'));
  const paths = {
    JPY: pathToFileURL(join(dir, 'market-jpy.json')),
    USD: pathToFileURL(join(dir, 'market-usd.json')),
  };
  try {
    const initial = '{"schemaVersion":2,"appid":5084200,"status":"unavailable","items":[]}';
    await writeFile(paths.JPY, initial);
    await writeFile(paths.USD, initial);
    const pair = {
      JPY: await collect('JPY', mockPages(fixture.JPY), immediate),
      USD: await collect('USD', mockPages(fixture.USD), immediate),
    };
    await assert.rejects(saveSnapshotPair({ ...pair, USD: { ...pair.USD, currency: 'JPY' } }, paths), /Invalid market snapshot/);
    assert.equal(await readFile(paths.JPY, 'utf8'), initial);
    assert.equal(await readFile(paths.USD, 'utf8'), initial);
    await saveSnapshotPair(pair, paths);
    assert.equal(JSON.parse(await readFile(paths.JPY, 'utf8')).items.length, 3);
    assert.equal(JSON.parse(await readFile(paths.USD, 'utf8')).items.length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
