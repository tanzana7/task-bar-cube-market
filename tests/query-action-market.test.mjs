import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectAndPersistQueryActionBatch,
  buildQueryActionUrl,
  collectLiveQueryActionPages,
  collectQueryActionPages,
  parseQueryActionPage,
  queryActionHeaders,
  requestQueryActionPage,
  loadQueryActionObservationStore,
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
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [{ ...row, eCurrency: 8 }] } }, { expectedStart: 30 }), /currency mismatch/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [{ ...row,
    asset_description: { ...row.asset_description, appid: 5084200 } }] } }, { expectedStart: 30 }), /AppID is invalid/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [{ ...row, strMinSellSubtotal: '¥3' }] } }, { expectedStart: 30 }), /subtotal format/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [{ ...row, cSellOrders: '7' }] } }, { expectedStart: 30 }), /sell-order count/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [{ ...row,
    asset_description: { ...row.asset_description, icon_url: '../unsafe' } }] } }, { expectedStart: 30 }), /image identifier/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [{ ...row }, { ...row }] } }, { expectedStart: 30 }), /duplicate/);
  assert.throws(() => parseQueryActionPage({ data: { ...fixture.data, results: [null] } }, { expectedStart: 30 }), /currency mismatch|identifier or AppID/);
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
  }, statePath: null, testOnlyTransport: true });
  assert.equal(calls, 1);
  assert.equal(page.pageSize, 30);
});

test('a live request without explicit --live and the operational gate is rejected before transport', async () => {
  let calls = 0;
  await assert.rejects(requestQueryActionPage({ appid: 3678970, requestCurrencyId: 1,
    fetchImpl: async () => { calls += 1; }, statePath: null }), /requires --live/);
  assert.equal(calls, 0);
});

test('request adapter stops on HTML, null JSON and malformed grouped data without retrying', async () => {
  for (const response of [
    { ok: true, status: 200, headers: { get: name => name === 'Content-Type' ? 'text/html' : null }, json: async () => { throw new Error('must not parse HTML'); } },
    { ok: true, status: 200, headers: { get: name => name === 'Content-Type' ? 'application/json' : null }, json: async () => null },
    { ok: true, status: 200, headers: { get: name => name === 'Content-Type' ? 'application/json' : null }, json: async () => ({ data: { ...fixture.data, grouping: 0 } }) },
  ]) {
    let calls = 0;
    await assert.rejects(requestQueryActionPage({ appid: 3678970, start: 30, requestCurrencyId: 1, statePath: null,
      testOnlyTransport: true, fetchImpl: async () => {
      calls += 1;
      return response;
    } }), /stopped/);
    assert.equal(calls, 1);
  }
});

function clonePage(start, totalCount, rows = fixture.data.results) {
  return { data: { ...fixture.data, start, total_count: totalCount, results: rows } };
}

function uniqueRows(prefix) {
  return fixture.data.results.map((row, i) => ({ ...row, strHash: `${prefix}-${i}`,
    asset_description: { ...row.asset_description, market_hash_name: `${prefix} product ${i}` } }));
}

async function withTempPaths(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'tbcm-query-action-'));
  try { await callback({ directory, storePath: join(directory, 'observations.json'), statePath: join(directory, 'state.json') }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('queryAction observations persist per product and resume at the recorded offset without claiming a full catalog', async () => {
  await withTempPaths(async ({ storePath }) => {
    let tick = 0;
    const now = () => new Date(Date.parse('2026-10-25T00:00:00.000Z') + tick++ * 60_000);
    const first = await collectAndPersistQueryActionBatch({ appid: 3678970, requestCurrencyId: 1, maxPages: 1,
      storePath, now, fetchPage: async start => clonePage(start, 60, uniqueRows('page-a')) });
    assert.equal(first.progress.status, 'partial');
    assert.equal(first.progress.nextStart, 30);
    assert.equal(first.products.length, 30);
    assert.equal(first.progress.catalogComplete, false);
    const second = await collectAndPersistQueryActionBatch({ appid: 3678970, requestCurrencyId: 1, maxPages: 1,
      storePath, now, fetchPage: async start => { assert.equal(start, 30); return clonePage(start, 60, uniqueRows('page-b')); } });
    assert.equal(second.progress.status, 'count-reached-unverified');
    assert.equal(second.progress.nextStart, 60);
    assert.equal(second.products.length, 60);
    assert.ok(second.products.every(product => product.observations.length === 1));
    assert.ok(second.products.every(product => product.lastObservedAt === product.observations[0].observedAt));
    assert.equal(second.progress.catalogComplete, false);
  });
});

test('an explicitly empty market is recorded as an unverified empty observation, not treated as malformed or filled with zeroes', async () => {
  await withTempPaths(async ({ storePath }) => {
    const empty = await collectAndPersistQueryActionBatch({ appid: 3678970, requestCurrencyId: 1, storePath,
      fetchPage: async start => ({ data: { start, total_count: 0, grouping: 1, results: [] } }) });
    assert.equal(empty.progress.status, 'count-reached-unverified');
    assert.equal(empty.progress.reportedTotalCount, 0);
    assert.equal(empty.progress.catalogComplete, false);
    assert.equal(empty.products.length, 0);
  });
});

test('an observation store from a different AppID is refused and left untouched', async () => {
  await withTempPaths(async ({ storePath }) => {
    const otherApp = JSON.stringify({ schemaVersion: 1, appid: 5084200, source: 'Steam Community Market queryAction',
      currency: 'USD', priceBasis: 'min-sell-subtotal-unverified-fees', products: [], completedRuns: [], progress: {
        status: 'idle', runId: null, startedAt: null, requestCurrencyId: null, reportedTotalCount: null,
        nextStart: 0, pagesFetched: 0, seenMarketHashNames: [], orderingRisk: true, catalogComplete: false,
      } });
    await writeFile(storePath, otherApp);
    await assert.rejects(loadQueryActionObservationStore(storePath, 3678970), /refusing to overwrite/);
    assert.equal(await readFile(storePath, 'utf8'), otherApp);
  });
});

test('changing totals and page overlap persist valid observations but require a restart', async () => {
  await withTempPaths(async ({ storePath }) => {
    await collectAndPersistQueryActionBatch({ appid: 3678970, requestCurrencyId: 1, maxPages: 1, storePath,
      now: () => new Date('2026-10-25T00:00:00.000Z'), fetchPage: async start => clonePage(start, 60) });
    const moved = await collectAndPersistQueryActionBatch({ appid: 3678970, requestCurrencyId: 1, maxPages: 1, storePath,
      now: () => new Date('2026-10-25T00:01:00.000Z'), fetchPage: async start => clonePage(start, 61) });
    assert.equal(moved.progress.status, 'restart-required');
    assert.equal(moved.progress.restartReason, 'total-count-changed');
    assert.equal(moved.products.length, 30);
    assert.equal(moved.progress.catalogComplete, false);
  });
  await withTempPaths(async ({ storePath }) => {
    await collectAndPersistQueryActionBatch({ appid: 3678970, requestCurrencyId: 1, maxPages: 1, storePath,
      now: () => new Date('2026-10-25T00:00:00.000Z'), fetchPage: async start => clonePage(start, 60) });
    const overlap = await collectAndPersistQueryActionBatch({ appid: 3678970, requestCurrencyId: 1, maxPages: 1, storePath,
      now: () => new Date('2026-10-25T00:01:00.000Z'), fetchPage: async start => clonePage(start, 60) });
    assert.equal(overlap.progress.status, 'restart-required');
    assert.equal(overlap.progress.restartReason, 'overlapping-page-order');
    assert.equal(overlap.products.length, 30);
    assert.equal(overlap.products[0].observations.length, 2);
  });
});

test('communication failure leaves the last saved page resumable and does not add an observation', async () => {
  await withTempPaths(async ({ storePath }) => {
    const first = await collectAndPersistQueryActionBatch({ appid: 3678970, requestCurrencyId: 1, maxPages: 1, storePath,
      now: () => new Date('2026-10-25T00:00:00.000Z'), fetchPage: async start => clonePage(start, 90, uniqueRows('saved')) });
    await assert.rejects(collectAndPersistQueryActionBatch({ appid: 3678970, requestCurrencyId: 1, maxPages: 2, storePath,
      now: () => new Date('2026-10-25T00:01:00.000Z'), fetchPage: async () => { throw new Error('fixture network failure'); } }), /fixture network failure/);
    const preserved = await loadQueryActionObservationStore(storePath, 3678970);
    assert.equal(preserved.progress.nextStart, 30);
    assert.equal(preserved.products.length, 30);
    assert.deepEqual(preserved.products.map(product => product.observations.length), Array(30).fill(1));
    assert.equal(first.progress.runId, preserved.progress.runId);
  });
});

test('request and response currencies are stored independently and mismatch stops production collection', async () => {
  await withTempPaths(async ({ statePath }) => {
    const wrongCurrency = { data: { ...fixture.data, results: fixture.data.results.map(row => ({ ...row, eCurrency: 1,
      asset_description: { ...row.asset_description, appid: 5084200 } })) } };
    await assert.rejects(requestQueryActionPage({ appid: 5084200, start: 30, requestCurrencyId: 8,
      fetchImpl: async () => ({ ok: true, status: 200,
        headers: { get: name => name === 'Content-Type' ? 'application/json' : null }, json: async () => wrongCurrency }),
      statePath, testOnlyTransport: true }), /currencies do not match/);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.stop.status, 'invalid-response');
    assert.equal(state.diagnostic.requestCurrencyId, 8);
    assert.deepEqual(state.diagnostic.responseCurrencyIds, [1]);
    assert.equal(state.diagnostic.scope, 'production');
  });
});

test('HTTP 429 persists the global stop and is never retried', async () => {
  await withTempPaths(async ({ statePath, storePath }) => {
    let calls = 0;
    await assert.rejects(collectLiveQueryActionPages({ appid: 3678970, maxPages: 2, requestCurrencyId: 1,
      statePath, storePath, testOnlyTransport: true, pause: async () => {}, fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 429, headers: { get: () => '30' } };
      } }), /429/);
    assert.equal(calls, 1);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.stop.status, 429);
  });
});

test('TBH experimental HTTP 400/404 is diagnosed without setting a production stop', async () => {
  await withTempPaths(async ({ directory }) => {
    const finalStatePath = join(directory, 'state-404.json');
    for (const status of [400, 404]) {
      const statePath = join(directory, `state-${status}.json`);
      if (status === 404) assert.equal(statePath, finalStatePath);
      await assert.rejects(requestQueryActionPage({ appid: 3678970, requestCurrencyId: 1, statePath,
        testOnlyTransport: true, fetchImpl: async () => ({ ok: false, status,
          headers: { get: () => 'application/json' } }) }), new RegExp(String(status)));
    }
    const state = JSON.parse(await readFile(finalStatePath, 'utf8'));
    assert.equal(state.stop, null);
    assert.equal(state.diagnostics.at(-1).scope, 'tbh-query-action-probe');
    assert.equal(state.diagnostics.at(-1).httpStatus, 404);
  });
});

test('large markets are stored in bounded 6-page batches and the next batch resumes', async () => {
  await withTempPaths(async ({ storePath }) => {
    const makeLargePage = start => {
      const count = Math.min(30, 1000 - start);
      const rows = uniqueRows(`large-${start}`).slice(0, count).map((row, index) => ({ ...row,
        strHash: `large-${start + index}`,
        asset_description: { ...row.asset_description, market_hash_name: `Large item ${start + index}` } }));
      return clonePage(start, 1000, rows);
    };
    let batch = await collectAndPersistQueryActionBatch({ appid: 3678970, requestCurrencyId: 1,
      maxPages: 6, storePath, fetchPage: async start => makeLargePage(start) });
    assert.equal(batch.products.length, 180);
    assert.equal(batch.progress.nextStart, 180);
    assert.equal(batch.progress.status, 'partial');
    batch = await collectAndPersistQueryActionBatch({ appid: 3678970, requestCurrencyId: 1,
      maxPages: 6, storePath, fetchPage: async start => makeLargePage(start) });
    assert.equal(batch.products.length, 360);
    assert.equal(batch.progress.nextStart, 360);
    assert.equal(batch.progress.pagesFetched, 12);
    assert.equal(batch.progress.catalogComplete, false);
  });
});

test('corrupt observation JSON is not overwritten', async () => {
  await withTempPaths(async ({ storePath }) => {
    await writeFile(storePath, '{corrupt');
    await assert.rejects(collectAndPersistQueryActionBatch({ appid: 3678970, requestCurrencyId: 1, storePath,
      fetchPage: async () => fixture }), /refusing to overwrite/);
    assert.equal(await readFile(storePath, 'utf8'), '{corrupt');
  });
});
