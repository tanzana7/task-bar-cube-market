import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFeedCycle, runMarketInputCycle, validateFeedUrl } from '../scripts/market-feed.mjs';
import { parseMarketObservations, latestObservedItems } from '../src/market-observations.ts';

test('feed production gate rejects absent rights before transport; Steam and credential URLs are excluded', async () => {
  for (const url of ['https://steamcommunity.com/market/actions', 'https://a.steampowered.com/feed',
    'https://feed.example/data?key=private', 'https://name:password@feed.example/feed', 'http://127.0.0.1/feed']) {
    assert.throws(() => validateFeedUrl(url));
  }
  assert.equal(validateFeedUrl('https://feed.example/market.json').hostname, 'feed.example');
  await assert.rejects(runFeedCycle({ sourceUrl: 'https://feed.example/market.json' }), /rights review/);
});

test('factual publication mode never attests a rights reference', async () => {
  let loaded = false;
  await assert.rejects(runMarketInputCycle({ enabled: true, factualObservationPublication: true,
    rightsReference: 'unverified', provenance: 'test', loadText: async () => { loaded = true; return '{}'; } }),
  /cannot claim a rights review/);
  assert.equal(loaded, false);
});

test('isolated feed handles null price/images, adds products, preserves timestamps and refuses corrupt stores', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbcm-feed-test-'));
  const inputPath = join(root, 'input.json');
  const output = join(root, 'public', 'market-observations.json');
  const payload = { format: 'steam-market-dom', appid: 5084200, currency: 'USD',
    observedAt: '2026-10-25T09:00:00.000Z', start: 0, totalCount: 73, complete: false,
    products: [{ name: 'Synthetic test only', marketHashName: 'Synthetic test only', currency: 'USD',
      priceText: null, listings: null, imageUrl: null,
      steamUrl: 'https://steamcommunity.com/market/listings/5084200/Synthetic%20test%20only' }] };
  try {
    await writeFile(inputPath, JSON.stringify(payload));
    await runFeedCycle({ inputPath, isolationRoot: root });
    const parsed = parseMarketObservations(JSON.parse(await readFile(output, 'utf8')));
    assert.ok(parsed);
    assert.equal(latestObservedItems(parsed)[0].importedPriceText, '価格情報なし');
    assert.equal(parsed.products[0].observations[0].listings, null);
    const next = structuredClone(payload);
    next.observedAt = '2026-10-25T09:01:00.000Z';
    next.products[0].marketHashName = next.products[0].name = 'Second synthetic test only';
    next.products[0].steamUrl = 'https://steamcommunity.com/market/listings/5084200/Second%20synthetic%20test%20only';
    await writeFile(inputPath, JSON.stringify(next));
    assert.equal((await runFeedCycle({ inputPath, isolationRoot: root })).products, 2);
    const merged = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(merged.products.find(row => row.name === 'Synthetic test only').observations[0].observedAt, payload.observedAt);
    await writeFile(output, '{broken cache');
    await assert.rejects(runFeedCycle({ inputPath, isolationRoot: root }), /refusing to overwrite/);
    assert.equal(await readFile(output, 'utf8'), '{broken cache');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('feed rejects redirects without following them and a concurrent cycle cannot fetch twice', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbcm-feed-transport-'));
  let requests = 0;
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const server = createServer(async (request, response) => {
    requests += 1;
    entered();
    await blocked;
    response.writeHead(302, { Location: 'https://steamcommunity.com/market/actions' });
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const options = { sourceUrl: `http://127.0.0.1:${server.address().port}/feed`, isolationRoot: root };
  try {
    const first = assert.rejects(runFeedCycle(options), /fetch failed/);
    await started;
    await assert.rejects(runFeedCycle(options), /Another feed cycle/);
    release();
    await first;
    assert.equal(requests, 1);
  } finally {
    release();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
