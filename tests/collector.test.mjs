import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APPID, DEFAULT_REQUEST_POLICY, FX_RATE_URL, collect, collectPair, convertUsdToJpy, createSteamRequestController, fetchFxRate, normalizeResult, parsePage, parsePriceMinor, refreshUsdSnapshot, saveSnapshot, saveSnapshotPair, searchUrl, validateSnapshot, validateSnapshotPair } from '../scripts/steam-market.mjs';

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
  assert.throws(() => normalizeResult(page.results[0], 'JPY', 3678970), /Steam returned USD/);
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
  const testPolicy = { ...DEFAULT_REQUEST_POLICY, minIntervalMs: 0 };
  const jpy = await collect('JPY', mockPages(fixture.JPY), immediate, { policy: testPolicy });
  const usd = await collect('USD', mockPages(fixture.USD), immediate, { policy: testPolicy });
  assert.equal(jpy.items.length, 3);
  assert.equal(usd.items.length, 3);
  assert.equal(jpy.items[0].priceText, '¥100');
  assert.equal(usd.items[0].priceText, '$1.00');
  validateSnapshot(jpy, 'JPY');
  validateSnapshot(usd, 'USD');
});

test('request budget serializes requests, counts attempts and stops at the per-run cap', async () => {
  let calls = 0;
  const waits = [];
  const controller = createSteamRequestController({
    fetchImpl: async () => { calls += 1; return response({ ok: true }); },
    pause: async milliseconds => { waits.push(milliseconds); },
    policy: { ...DEFAULT_REQUEST_POLICY, maxRequestsPerRun: 1 },
    now: () => new Date('2026-10-25T00:00:00.000Z'),
  });
  await controller.request('https://steamcommunity.com/market/search/render/?count=100');
  await assert.rejects(controller.request('https://steamcommunity.com/market/search/render/?count=100'), /per-run request limit/);
  assert.equal(calls, 1);
  assert.equal(controller.requestsMade, 1);
  assert.deepEqual(waits, []);
});

test('persistent request budget stops future runs after 429 without retrying', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbcm-request-stop-'));
  const statePath = pathToFileURL(join(dir, 'state.json'));
  let calls = 0;
  const policy = { ...DEFAULT_REQUEST_POLICY, minIntervalMs: 0 };
  try {
    const controller = createSteamRequestController({
      fetchImpl: async () => { calls += 1; return { ok: false, status: 429, headers: { get: name => name === 'Retry-After' ? '120' : null } }; },
      pause: immediate, policy, statePath, now: () => new Date('2026-10-25T00:00:00.000Z'),
    });
    await assert.rejects((async () => {
      const { response: blocked } = await controller.request('https://steamcommunity.com/market/search/render/');
      if (blocked.status === 429) throw new Error('Steam access stopped: HTTP 429');
    })(), /HTTP 429/);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.requestsToday, 1);
    assert.equal(state.stop.status, 429);
    assert.equal(state.stop.retryAfter, '120');
    const secondRun = createSteamRequestController({ fetchImpl: async () => { calls += 1; return response({}); },
      pause: immediate, policy, statePath, now: () => new Date('2026-10-25T00:01:00.000Z') });
    await assert.rejects(secondRun.request('https://steamcommunity.com/market/search/render/'), /remains stopped/);
    assert.equal(calls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a small actual page size is used for request estimation and stops before a crawl', async () => {
  let calls = 0;
  await assert.rejects(collect('USD', async () => {
    calls += 1;
    return response({ ...fixture.USD[0], total_count: 1094 });
  }, immediate, { policy: { ...DEFAULT_REQUEST_POLICY, minIntervalMs: 0, maxRequestsPerRun: 6 } }), /about 547 requests/);
  assert.equal(calls, 1);
  assert.throws(() => parsePage({ success: true, total_count: 1094, pagesize: 10, results: fixture.USD[0].results }, 0), /shape changed/);
});

test('USD-only refresh writes verified market, history and rankings without FX or JPY requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbcm-usd-only-'));
  const root = pathToFileURL(`${dir}/`);
  const cachePath = new URL('market-usd.json', root);
  const historyDirectory = new URL('history/', root);
  const indexPath = new URL('index.json', historyDirectory);
  const rankingsPath = new URL('rankings.json', root);
  await writeFile(cachePath, JSON.stringify({ schemaVersion: 2, appid: APPID, currency: 'USD', status: 'unavailable', fetchedAt: null, items: [] }));
  const requests = [];
  try {
    const refreshed = await refreshUsdSnapshot(async url => {
      const parsed = new URL(url);
      requests.push(parsed.hostname + parsed.pathname + '?' + parsed.searchParams.toString());
      assert.equal(parsed.hostname, 'steamcommunity.com');
      assert.equal(parsed.searchParams.get('currency'), '1');
      return mockPages(fixture.USD)(url);
    }, immediate, { cachePath, historyOptions: { directory: historyDirectory, indexPath, rankingsPath } });
    assert.equal(refreshed.snapshot.items.length, 3);
    assert.equal(requests.length, 2);
    assert.match(requests[1], /start=2/);
    assert.equal(JSON.parse(await readFile(cachePath, 'utf8')).currency, 'USD');
    assert.equal(JSON.parse(await readFile(indexPath, 'utf8')).products.length, 3);
    assert.equal(JSON.parse(await readFile(rankingsPath, 'utf8')).appid, APPID);

    const previousMarket = await readFile(cachePath, 'utf8');
    const previousHistory = await readFile(indexPath, 'utf8');
    await assert.rejects(refreshUsdSnapshot(async () => ({ ok: false, status: 429 }), immediate,
      { cachePath, historyOptions: { directory: historyDirectory, indexPath, rankingsPath } }), /access stopped/);
    assert.equal(await readFile(cachePath, 'utf8'), previousMarket);
    assert.equal(await readFile(indexPath, 'utf8'), previousHistory);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects incomplete, mismatched and blocked pages', async () => {
  assert.throws(() => parsePage({ success: false, total_count: 0, results: [] }, 0));
  assert.throws(() => parsePage({ success: true, total_count: 1, results: [] }, 0));
  await assert.rejects(collect('JPY', mockPages({ 0: fixture.JPY[0], 2: { ...fixture.JPY[2], results: [] } }), immediate), /incomplete|shape changed/);
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
  await assert.rejects(collect('JPY', mockPages(fixture.USD), immediate), /Steam returned USD/);
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

test('only a JPY currency mismatch uses a dated FX reference from verified USD prices', async () => {
  const requests = [];
  const fetchImpl = async url => {
    const params = new URL(url).searchParams;
    requests.push(`${params.get('currency')}:${params.get('start')}`);
    return mockPages(fixture.USD)(url);
  };
  const rateFetch = async url => {
    assert.equal(url, FX_RATE_URL);
    return response({ date: '2026-10-25', base: 'USD', quote: 'JPY', rate: 157.12 });
  };
  const pair = await collectPair(fetchImpl, immediate, rateFetch, () => new Date('2026-10-25T09:00:00Z'));
  assert.deepEqual(requests, ['1:0', '1:2', '8:0']);
  assert.equal(pair.JPY.priceSource, 'fx');
  assert.equal(pair.USD.priceSource, 'steam');
  assert.equal(pair.JPY.fxRate.rateDate, '2026-10-25');
  assert.equal(pair.JPY.items[0].priceText, '¥157');
  assert.equal(pair.JPY.items[0].priceMinor, 15700);
  assert.equal(pair.USD.items[0].priceText, '$1.00');
  const missing = { ...pair.USD, items: [{ ...pair.USD.items[0], priceMinor: null, priceText: null }] };
  const convertedMissing = convertUsdToJpy(missing, pair.JPY.fxRate);
  assert.equal(convertedMissing.items[0].priceMinor, null);
  assert.equal(convertedMissing.items[0].priceText, null);
  validateSnapshotPair(pair);
  assert.throws(() => validateSnapshotPair({ ...pair, JPY: { ...pair.JPY,
    items: [{ ...pair.JPY.items[0], priceMinor: 99900 }, ...pair.JPY.items.slice(1)] } }), /Invalid market item|do not match/);
});

test('direct JPY takes priority and rate failures cannot produce a fallback', async () => {
  const direct = await collectPair(async url => {
    const params = new URL(url).searchParams;
    return mockPages(params.get('currency') === '8' ? fixture.JPY : fixture.USD)(url);
  }, immediate, async () => { throw new Error('rate must not be requested'); });
  assert.equal(direct.JPY.priceSource, 'steam');
  const mismatched = async url => mockPages(fixture.USD)(url);
  await assert.rejects(collectPair(mismatched, immediate, async () => ({ ok: false, status: 503 })), /FX HTTP 503/);
  await assert.rejects(fetchFxRate(async () => response({ date: '2026-10-01', base: 'USD', quote: 'JPY', rate: 157 }),
    () => new Date('2026-10-25T09:00:00Z')), /stale/);
  await assert.rejects(collectPair(async url => new URL(url).searchParams.get('currency') === '8'
    ? { ok: false, status: 429 } : mockPages(fixture.USD)(url), immediate,
  async () => { throw new Error('rate must not be requested'); }), /access stopped/);
  await assert.rejects(collectPair(async url => {
    const params = new URL(url).searchParams;
    if (params.get('currency') === '1') return mockPages(fixture.USD)(url);
    return response({ ...fixture.JPY[0], results: [{ ...fixture.JPY[0].results[0], sell_price_text: 'broken price' }] });
  }, immediate, async () => { throw new Error('rate must not be requested'); }), /Currency could not be verified/);
});

test('an FX provider failure leaves both existing cache files untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbcm-fx-'));
  const paths = {
    JPY: pathToFileURL(join(dir, 'market-jpy.json')),
    USD: pathToFileURL(join(dir, 'market-usd.json')),
  };
  const previous = '{"old":"verified snapshot"}';
  try {
    await writeFile(paths.JPY, previous);
    await writeFile(paths.USD, previous);
    await assert.rejects(collectPair(mockPages(fixture.USD), immediate,
      async () => ({ ok: false, status: 503 })), /FX HTTP 503/);
    assert.equal(await readFile(paths.JPY, 'utf8'), previous);
    assert.equal(await readFile(paths.USD, 'utf8'), previous);
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
