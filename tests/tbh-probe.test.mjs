import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSteamRequestController } from '../scripts/steam-market.mjs';
import { inspectStructuredSearch, inspectTbhMarket, inspectTbhStructuredMarket, tbhSearchUrl, tbhStructuredSearchBody, tbhStructuredSearchHeaders, tbhStructuredSearchUrl } from '../scripts/verify-tbh.mjs';

const tbhFixture = JSON.parse(await readFile(new URL('./fixtures/tbh-search-page.json', import.meta.url), 'utf8'));
const structuredContract = JSON.parse(await readFile(new URL('./fixtures/tbh-structured-search-contract.json', import.meta.url), 'utf8'));

test('TBH probe defaults to one-page fixture analysis without network or cache writes', async () => {
  let calls = 0;
  const result = await inspectTbhMarket({ fetchImpl: async () => { calls += 1; throw new Error('fixture probe must not fetch'); } });
  assert.equal(calls, 0);
  assert.equal(result.source, 'fixture');
  assert.equal(result.appid, 3678970);
  assert.equal(result.totalCount, 1);
  assert.equal(result.responsePageSize, 1);
  assert.equal(result.returned, 1);
  assert.equal(result.usdPriceVerified, 1);
  assert.equal(result.usdPriceValidationRate, 1);
  assert.equal(result.imagesAvailable, 1);
  assert.equal(result.listingsAvailable, 1);
  assert.equal(result.estimatedFullCollectionRequests, 1);
  assert.equal(result.requestsMade, 0);
});

test('TBH live probe makes exactly one USD request and reports aggregate diagnostics only', async () => {
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  const result = await inspectTbhMarket({ live: true, statePath: null, pause: async () => {},
    now: () => new Date('2026-10-25T00:00:00.000Z'),
    fetchImpl: async url => {
      calls += 1; active += 1; maximumActive = Math.max(maximumActive, active);
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('appid'), '3678970');
      assert.equal(parsed.searchParams.get('currency'), '1');
      assert.equal(parsed.searchParams.get('count'), '100');
      active -= 1;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => tbhFixture };
    } });
  assert.equal(calls, 1);
  assert.equal(maximumActive, 1);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.requestsMade, 1);
  assert.equal(result.responseMs, 0);
  assert.equal(result.returned, 1);
  assert.equal(result.estimatedFullCollectionRequests, 1);
  assert.equal(tbhSearchUrl().includes('appid=3678970'), true);
  assert.equal(Object.hasOwn(result, 'marketHashName'), false);
});

test('TBH probe persists 429 stop state, reports Retry-After, and does not retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbcm-tbh-probe-'));
  const statePath = pathToFileURL(join(dir, 'state.json'));
  let calls = 0;
  try {
    await assert.rejects(inspectTbhMarket({ live: true, statePath, pause: async () => {},
      now: () => new Date('2026-10-25T00:00:00.000Z'),
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 429, headers: { get: name => name === 'Retry-After' ? '600' : null } };
      } }), /HTTP 429.*Retry-After: 600/);
    assert.equal(calls, 1);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.stop.status, 429);
    assert.equal(state.stop.retryAfter, '600');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('structured-search contract fixture validates USD groups without treating listings as products', async () => {
  const result = await inspectTbhStructuredMarket();
  assert.equal(result.source, 'fixture');
  assert.equal(result.mode, 'grouped-products');
  assert.equal(result.grouping, 1);
  assert.equal(result.returnedProductKinds, 1);
  assert.equal(result.usdPricesVerified, 1);
  assert.equal(result.samplePrices[0].minor, 123);
  assert.equal(result.sellOrderCountsAvailable, 1);
  assert.equal(result.imagesAvailable, 1);
  assert.equal(result.requestsMade, 0);

  const direct = inspectStructuredSearch({ start: 0, total_count: 2, more: false, facets: [], listings: [
    { listingid: 'listing-a', eCurrency: 1, unPrice: 123, unFee: 12, description: { appid: 3678970, market_hash_name: 'Fixture Item' } },
    { listingid: 'listing-b', eCurrency: 1, unPrice: 124, unFee: 12, description: { appid: 3678970, market_hash_name: 'Fixture Item' } },
  ] });
  assert.equal(direct.mode, 'individual-listings');
  assert.equal(direct.returnedRows, 2);
  assert.equal(direct.returnedProductKinds, null);
  assert.equal(direct.estimatedProductRequests, null);
  assert.equal(direct.estimatedRowRequests, 1);
});

test('structured-search 10, 30 and 100 row scale fixtures use generated contract rows only', () => {
  for (const count of [10, 30, 100]) {
    const results = Array.from({ length: count }, (_, index) => {
      const name = `Synthetic Fixture Item ${index + 1}`;
      return { ...structuredContract.results[0], strHash: name, asset_description: { ...structuredContract.results[0].asset_description, market_hash_name: name } };
    });
    const result = inspectStructuredSearch({ ...structuredContract, total_count: count, results });
    assert.equal(result.returnedProductKinds, count);
    assert.equal(result.usdPricesVerified, count);
    assert.equal(result.marketHashNamesAvailable, count);
    assert.equal(result.estimatedProductRequests, 1);
  }
});

test('structured-search rejects null, incomplete, mismatched currency, AppID and duplicate groups', () => {
  assert.throws(() => inspectStructuredSearch(null), /null or a non-object/);
  assert.throws(() => inspectStructuredSearch({ start: 0, total_count: 1, grouping: 1, facets: [], results: null }), /exactly one/);
  assert.throws(() => inspectStructuredSearch({ ...structuredContract, grouping: 0 }), /not identified as grouped/);
  assert.equal(inspectStructuredSearch({ ...structuredContract, results: [{ ...structuredContract.results[0], eCurrency: 2 }] }).usdPricesVerified, 0);
  assert.throws(() => inspectStructuredSearch({ ...structuredContract, results: [{ ...structuredContract.results[0], asset_description: { ...structuredContract.results[0].asset_description, appid: 5084200 } }] }), /different AppID/);
  const duplicated = { ...structuredContract, total_count: 2, results: [structuredContract.results[0], structuredContract.results[0]] };
  assert.equal(inspectStructuredSearch(duplicated).identifiersUnique, false);
  assert.equal(inspectStructuredSearch(duplicated).duplicateIds, 1);
});

test('new structured live probe makes one unauthenticated USD POST through shared request controls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbcm-new-market-probe-'));
  const statePath = pathToFileURL(join(dir, 'state.json'));
  let calls = 0;
  try {
    const result = await inspectTbhStructuredMarket({ live: true, statePath, pause: async () => {},
      now: () => new Date('2026-10-25T00:00:00.000Z'),
      fetchImpl: async (url, init) => {
        calls += 1;
        assert.equal(url, tbhStructuredSearchUrl());
        assert.equal(init.method, 'POST');
        assert.deepEqual(init.headers, tbhStructuredSearchHeaders());
        assert.equal(init.headers['x-valve-request-type'], 'routeAction');
        assert.equal(init.headers['x-valve-action-type'], 'ZFJAHYDA:SearchMarketListings');
        assert.equal(new URL(url).searchParams.get('sort'), '1');
        assert.equal(new URL(url).searchParams.get('dir'), '1');
        assert.equal(Object.hasOwn(init.headers, 'Cookie'), false);
        assert.deepEqual(JSON.parse(init.body), tbhStructuredSearchBody());
        assert.deepEqual(JSON.parse(init.body)[0], {
          appid: 3678970, filters: {}, price: { eCurrency: 1 }, accessoryFilters: {}, sort: 1, direction: 1, start: 0,
        });
        return { ok: true, status: 200, headers: { get: name => name === 'Content-Type' ? 'application/json; charset=utf-8' : null }, json: async () => structuredContract };
      } });
    assert.equal(calls, 1);
    assert.equal(result.requestsMade, 1);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.contentType, 'application/json; charset=utf-8');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.requestsToday, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('new structured probe records route failures without globally stopping the legacy collector', async () => {
  for (const response of [
    { ok: false, status: 403, headers: { get: () => null } },
    { ok: false, status: 429, headers: { get: name => name === 'Retry-After' ? '600' : null } },
    { ok: false, status: 404, headers: { get: name => name === 'Content-Type' ? 'application/json' : null } },
    { ok: true, status: 200, headers: { get: name => name === 'Content-Type' ? 'text/html' : null }, text: async () => '<html>challenge</html>' },
    { ok: true, status: 200, headers: { get: name => name === 'Content-Type' ? 'application/json' : null }, json: async () => { throw new SyntaxError('fixture invalid JSON'); } },
    { ok: true, status: 200, headers: { get: name => name === 'Content-Type' ? 'application/json' : null }, json: async () => null },
  ]) {
    const dir = await mkdtemp(join(tmpdir(), 'tbcm-new-market-stop-'));
    const statePath = pathToFileURL(join(dir, 'state.json'));
    let calls = 0;
    try {
      let error;
      try {
        await inspectTbhStructuredMarket({ live: true, statePath, pause: async () => {},
          now: () => new Date('2026-10-25T00:00:00.000Z'), fetchImpl: async () => { calls += 1; return response; } });
      } catch (caught) { error = caught; }
      assert.equal(calls, 1);
      assert.ok(error instanceof Error);
      if (response.status === 404) {
        assert.match(error.message, /"httpStatus":404/);
        assert.match(error.message, /"contentType":"application\/json"/);
        assert.match(error.message, /"requestsMade":1/);
      }
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      if (response.status === 403 || response.status === 429) assert.equal(state.stop.status, response.status);
      else {
        assert.equal(state.stop, null);
        assert.equal(state.diagnostic.scope, 'tbh-route-probe');
        assert.match(state.diagnostic.endpoint, /^POST \/market\/search\?appid=3678970/);
        if (response.status === 404) {
          assert.equal(state.diagnostic.httpStatus, 404);
          assert.equal(state.diagnostic.status, 'http-error');
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('a scoped route 404 preserves the daily budget and allows the established collector route', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbcm-scoped-route-stop-'));
  const statePath = pathToFileURL(join(dir, 'state.json'));
  const now = () => new Date('2026-10-25T00:00:00.000Z');
  try {
    await assert.rejects(inspectTbhStructuredMarket({ live: true, statePath, pause: async () => {}, now,
      fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => null } }) }), /"httpStatus":404/);
    const controller = createSteamRequestController({ statePath, now, pause: async () => {},
      policy: { minIntervalMs: 15000, maxRequestsPerRun: 1, maxRequestsPerDay: 24 },
      fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null } }) });
    const { response } = await controller.request('https://steamcommunity.com/market/search/render/?appid=5084200');
    assert.equal(response.status, 200);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.requestsToday, 2);
    assert.equal(state.stop, null);
    assert.equal(state.diagnostic.httpStatus, 404);
    assert.equal(state.diagnostic.scope, 'tbh-route-probe');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
