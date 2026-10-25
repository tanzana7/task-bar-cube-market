import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runQueryActionSourceCycle } from '../scripts/market-source.mjs';
import { collectAndPersistQueryActionBatch } from '../scripts/query-action-market.mjs';
import { parseMarketObservations, latestObservedItems } from '../src/market-observations.ts';

const fixture = JSON.parse(await readFile(new URL('./fixtures/tbh-query-action-real-start30-usd.json', import.meta.url), 'utf8'));
function testPage(start, changed = false) {
  const page = structuredClone(fixture);
  page.data.start = start;
  page.data.total_count = 31;
  page.data.results.forEach(row => { row.asset_description.appid = 5084200; });
  if (start === 30) {
    page.data.results = [page.data.results[0]];
    page.data.results[0].strHash = page.data.results[0].asset_description.market_hash_name = 'Isolated additional product';
  } else if (changed) {
    page.data.results[0].strMinSellSubtotal = '$1.29';
    page.data.results[0].cSellOrders += 7;
  }
  return page;
}

test('source collection flows through common import, resumes pages and updates actual observation fields without canonical prices', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbcm-source-test-'));
  const output = join(root, 'public', 'market-observations.json');
  const previousGate = process.env.STEAM_MARKET_COLLECTION_ALLOWED;
  process.env.STEAM_MARKET_COLLECTION_ALLOWED = 'true';
  let cycle = 0;
  const offsets = [];
  const collectImpl = options => {
    assert.equal(options.sort, 1);
    assert.equal(options.direction, 1);
    assert.equal(options.restartOnMovement, true);
    return collectAndPersistQueryActionBatch({ ...options,
      now: () => new Date(Date.parse('2026-10-25T09:00:00.000Z') + cycle++ * 1000),
      fetchPage: async start => { offsets.push(start); return testPage(start, offsets.length > 2); } });
  };
  try {
    const first = await runQueryActionSourceCycle({ live: true, isolationRoot: root, collectImpl });
    assert.equal(first.products, 30);
    assert.equal(first.collection.nextStart, 30);
    const savedStorePath = join(root, 'source', 'query-action-observations.json');
    const unchanged = await readFile(output, 'utf8');
    assert.equal((await runQueryActionSourceCycle({ savedStorePath, isolationRoot: root })).changed, false);
    assert.equal(await readFile(output, 'utf8'), unchanged);
    assert.equal((await runQueryActionSourceCycle({ live: true, isolationRoot: root, collectImpl })).products, 31);
    await runQueryActionSourceCycle({ live: true, isolationRoot: root, collectImpl });
    assert.deepEqual(offsets, [0, 30, 0]);
    const snapshot = parseMarketObservations(JSON.parse(await readFile(output, 'utf8')));
    assert.ok(snapshot);
    const name = fixture.data.results[0].asset_description.market_hash_name;
    const product = snapshot.products.find(row => row.marketHashName === name);
    assert.equal(product.observations.length, 2);
    assert.equal(product.observations.at(-1).referencePriceText, '$1.29');
    assert.equal(product.observations.at(-1).listings, fixture.data.results[0].cSellOrders + 7);
    assert.equal(product.observations.at(-1).priceMinor, null);
    assert.equal(latestObservedItems(snapshot).find(row => row.marketHashName === name).comparisonPriceMinor, 129);
    assert.ok(snapshot.imports.every(row => row.complete === false && row.rightsConfirmed === false));
    const good = await readFile(output, 'utf8');
    for (const message of ['Steam access stopped after HTTP 429', 'Steam network request failed']) {
      await assert.rejects(runQueryActionSourceCycle({ live: true, isolationRoot: root,
        collectImpl: async () => { throw new Error(message); } }), new RegExp(message));
      assert.equal(await readFile(output, 'utf8'), good);
    }
  } finally {
    if (previousGate === undefined) delete process.env.STEAM_MARKET_COLLECTION_ALLOWED;
    else process.env.STEAM_MARKET_COLLECTION_ALLOWED = previousGate;
    await rm(root, { recursive: true, force: true });
  }
});

test('source rejects publication gates before collection and rejects another app or future store before output', async () => {
  let calls = 0;
  const collectImpl = async () => { calls += 1; throw new Error('must not collect'); };
  await assert.rejects(runQueryActionSourceCycle({ live: true, collectImpl }), /enablement/);
  await assert.rejects(runQueryActionSourceCycle({ live: true, enabled: true, collectImpl }), /rights review/);
  assert.equal(calls, 0);
  const root = await mkdtemp(join(tmpdir(), 'tbcm-source-invalid-'));
  const storePath = join(root, 'store.json');
  try {
    const store = await collectAndPersistQueryActionBatch({ appid: 5084200, requestCurrencyId: 1,
      maxPages: 1, storePath, now: () => new Date('2026-10-25T09:00:00.000Z'), fetchPage: async () => testPage(0) });
    store.appid = 3678970;
    store.products.forEach(row => { row.appid = 3678970; row.steamUrl = row.steamUrl.replace('/5084200/', '/3678970/'); });
    await writeFile(storePath, JSON.stringify(store));
    await assert.rejects(runQueryActionSourceCycle({ savedStorePath: storePath, isolationRoot: root }), /Only TBC/);
    store.appid = 5084200;
    store.products.forEach(row => { row.appid = 5084200; row.steamUrl = row.steamUrl.replace('/3678970/', '/5084200/');
      row.observations[0].observedAt = row.lastObservedAt = '2099-01-01T00:00:00.000Z'; });
    await writeFile(storePath, JSON.stringify(store));
    await assert.rejects(runQueryActionSourceCycle({ savedStorePath: storePath, isolationRoot: root }), /future/);
    await assert.rejects(readFile(join(root, 'public', 'market-observations.json')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
