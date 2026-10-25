import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildQueryActionUrl,
  collectLiveQueryActionPages,
  collectQueryActionPages,
  parseQueryActionPage,
  queryActionHeaders,
  requestQueryActionPage,
} from '../scripts/query-action-market.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/tbh-query-action-real-start30-usd.json', import.meta.url), 'utf8'));

test('real Steam DevTools fixture parses 30 distinct grouped USD products without legacy price fields', () => {
  const page = parseQueryActionPage(fixture, { expectedStart: 30, expectedAppId: 3678970 });
  assert.deepEqual({ start: page.start, totalCount: page.totalCount, grouping: page.grouping, pageSize: page.pageSize },
    { start: 30, totalCount: 1092, grouping: 1, pageSize: 30 });
  assert.equal(new Set(page.items.map(item => item.strHash)).size, 30);
  assert.equal(new Set(page.items.map(item => item.marketHashName)).size, 30);
  assert.ok(page.items.every(item => item.appid === 3678970 && item.currency === 'USD'));
  assert.ok(page.items.every(item => item.minSellSubtotalMinor === 3 && item.minSellSubtotalText === '$0.03'));
  assert.ok(page.items.every(item => item.priceBasis === 'min-sell-subtotal-unverified-fees'));
  assert.ok(page.items.every(item => !Object.hasOwn(item, 'priceMinor')));
  assert.ok(page.items.every(item => Number.isSafeInteger(item.listings) && item.listings >= 0));
  assert.ok(page.items.every(item => item.imageUrl?.startsWith('https://community.cloudflare.steamstatic.com/economy/image/')));
  assert.ok(page.items.every(item => item.steamUrl.startsWith('https://steamcommunity.com/market/listings/3678970/')));
});

test('queryAction URL keeps the observed request currency separate from response USD validation', () => {
  const url = new URL(buildQueryActionUrl({ appid: 3678970, start: 30 }));
  assert.equal(url.origin + url.pathname, 'https://steamcommunity.com/market/actions');
  assert.equal(url.searchParams.get('q'), 'Search');
  assert.deepEqual(JSON.parse(url.searchParams.get('qp')), [{
    appid: 3678970, filters: {}, price: { eCurrency: 8 }, accessoryFilters: {}, sort: 3, direction: 1, start: 30,
  }]);
  assert.deepEqual(queryActionHeaders(), { Accept: 'application/json', 'x-valve-request-type': 'queryAction' });
  assert.throws(() => buildQueryActionUrl({ appid: 5084200, start: -1 }), /Invalid/);
});

test('queryAction parser rejects a mismatched currency, AppID, start, total and malformed fields', () => {
  const row = fixture.data.results[0];
  assert.throws(() => parseQueryActionPage(fixture, { expectedStart: 0 }), /page position/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, total_count: 20 } }, { expectedStart: 30 }), /page position/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, start: 60 } }, { expectedStart: 30 }), /page position/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [{ ...row, eCurrency: 8 }] } }, { expectedStart: 30 }), /currency is not USD/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [{ ...row,
    asset_description: { ...row.asset_description, appid: 5084200 } }] } }, { expectedStart: 30 }), /AppID is invalid/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [{ ...row, strMinSellSubtotal: '¥3' }] } }, { expectedStart: 30 }), /subtotal format/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [{ ...row, cSellOrders: '7' }] } }, { expectedStart: 30 }), /sell-order count/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [{ ...row,
    asset_description: { ...row.asset_description, icon_url: '../unsafe' } }] } }, { expectedStart: 30 }), /image identifier/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [{ ...row }, { ...row }] } }, { expectedStart: 30 }), /duplicate/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [null] } }, { expectedStart: 30 }), /identifier or AppID/);
  assert.throws(() => parseQueryActionPage(null, { expectedStart: 30 }), /envelope/);
});

test('partial paging uses each observed page length and never claims a complete atomic snapshot', async () => {
  const nextRows = fixture.data.results.map((row, index) => ({
    ...row,
    strHash: `Second page product ${index}`,
    asset_description: { ...row.asset_description, market_hash_name: `Second page product ${index}` },
  }));
  const pageAt60 = { data: { ...fixture.data, start: 60, results: nextRows } };
  const offsets = [];
  const result = await collectQueryActionPages({ start: 30, maxPages: 2, fetchPage: async start => {
    offsets.push(start);
    return start === 30 ? fixture : pageAt60;
  } });
  assert.deepEqual(offsets, [30, 60]);
  assert.equal(result.items.length, 60);
  assert.equal(result.nextStart, 90);
  assert.equal(result.reportedCountMatched, false);
  assert.equal(result.snapshotConsistency, 'not-atomic');
});

test('partial paging rejects overlap and changing totals', async () => {
  await assert.rejects(collectQueryActionPages({ start: 30, maxPages: 2, fetchPage: async start =>
    ({ data: { ...fixture.data, start } }) }), /duplicate across pages/);
  const next = { data: { ...fixture.data, start: 60, total_count: 1091,
    results: fixture.data.results.map((row, i) => ({ ...row, strHash: `p${i}`,
      asset_description: { ...row.asset_description, market_hash_name: `p${i}` } })) } };
  await assert.rejects(collectQueryActionPages({ start: 30, maxPages: 2, fetchPage: async start => start === 30 ? fixture : next }), /total_count changed/);
});

test('request adapter is GET-only and validates JSON without network access in tests', async () => {
  let calls = 0;
  const page = await requestQueryActionPage({ appid: 3678970, start: 30, requestCurrencyId: 1, fetchImpl: async (url, init) => {
    calls += 1;
    assert.equal(init.method, 'GET');
    assert.equal(init.headers['x-valve-request-type'], 'queryAction');
    assert.equal(Object.hasOwn(init.headers, 'Cookie'), false);
    assert.equal(new URL(url).searchParams.get('q'), 'Search');
    assert.equal(JSON.parse(new URL(url).searchParams.get('qp'))[0].price.eCurrency, 1);
    return { ok: true, status: 200, headers: { get: name => name === 'Content-Type' ? 'application/json; charset=utf-8' : null }, json: async () => fixture };
  } });
  assert.equal(calls, 1);
  assert.equal(page.pageSize, 30);
});

test('live collection wrapper shares one controlled request controller and remains mockable', async () => {
  let calls = 0;
  const result = await collectLiveQueryActionPages({ appid: 3678970, start: 30, maxPages: 1, requestCurrencyId: 1,
    pause: async () => {}, statePath: null, fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200,
        headers: { get: name => name === 'Content-Type' ? 'application/json; charset=utf-8' : null },
        json: async () => fixture };
    } });
  assert.equal(calls, 1);
  assert.equal(result.items.length, 30);
  assert.equal(result.reportedCountMatched, false);
});

test('request adapter stops on HTML, null JSON and malformed grouped data without retrying', async () => {
  for (const response of [
    { ok: true, status: 200, headers: { get: name => name === 'Content-Type' ? 'text/html' : null }, json: async () => { throw new Error('must not parse HTML'); } },
    { ok: true, status: 200, headers: { get: name => name === 'Content-Type' ? 'application/json' : null }, json: async () => null },
    { ok: true, status: 200, headers: { get: name => name === 'Content-Type' ? 'application/json' : null }, json: async () => ({ data: { ...fixture.data, grouping: 0 } }) },
  ]) {
    let calls = 0;
    await assert.rejects(requestQueryActionPage({ appid: 3678970, start: 30, fetchImpl: async () => {
      calls += 1;
      return response;
    } }), /stopped/);
    assert.equal(calls, 1);
  }
});
