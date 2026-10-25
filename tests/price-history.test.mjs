import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { prepareHistoryUpdate, historyId, validateProductHistory } from '../scripts/price-history.mjs';
import { saveFilesAtomically, saveSnapshotPair } from '../scripts/steam-market.mjs';
import { filterHistoryPoints, makeChartPoints, parseProductHistory } from '../src/history.ts';

const item = (marketHashName, priceMinor = 123, listings = 4) => ({ name: marketHashName,
  marketHashName, imageUrl: null, priceMinor, priceText: priceMinor === null ? null : `$${(priceMinor / 100).toFixed(2)}`,
  listings, steamUrl: `https://steamcommunity.com/market/listings/5084200/${encodeURIComponent(marketHashName)}` });
const snapshot = (fetchedAt, items = [item('Cube A')]) => ({ schemaVersion: 2, appid: 5084200,
  currency: 'USD', status: items.length ? 'ok' : 'unavailable', priceSource: 'steam', fetchedAt, items });

async function withHistory(action) {
  const dir = await mkdtemp(join(tmpdir(), 'tbcm-history-'));
  const directory = pathToFileURL(`${join(dir, 'history')}${sep}`);
  const indexPath = new URL('index.json', directory);
  const rankingsPath = new URL('rankings.json', pathToFileURL(`${dir}${sep}`));
  await mkdir(directory, { recursive: true });
  try { await action({ directory, indexPath, rankingsPath }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('history IDs are stable SHA-256 values for special and Unicode market names', () => {
  const name = '限定版 / Cube: “Blue” #1';
  assert.equal(historyId(name), historyId(name));
  assert.match(historyId(name), /^[a-f0-9]{64}$/);
  assert.notEqual(historyId(name), historyId(`${name} `));
});

test('USD observations append atomically with market data and skip exact duplicate timestamps', async () => {
  await withHistory(async paths => {
    const first = snapshot('2026-10-20T10:00:00.000Z');
    const plan = await prepareHistoryUpdate(first, paths);
    assert.equal(plan.products, 1);
    assert.equal(plan.observations, 1);
    const target = new URL(`${historyId('Cube A')}.json`, paths.directory);
    await saveFilesAtomically(plan.files);
    const saved = JSON.parse(await readFile(target, 'utf8'));
    assert.deepEqual(saved.points, [{ observedAt: first.fetchedAt, priceCents: 123, listings: 4 }]);
    const duplicate = await prepareHistoryUpdate(first, paths);
    assert.equal(duplicate.files.length, 0);
    assert.equal(duplicate.products, 1);
  });
});

test('verified JPY/USD snapshots and USD history share one atomic update', async () => {
  await withHistory(async ({ directory, indexPath }) => {
    const marketDir = new URL('../', directory);
    const paths = { JPY: new URL('market-jpy.json', marketDir), USD: new URL('market-usd.json', marketDir) };
    const unavailable = currency => ({ schemaVersion: 2, appid: 5084200, currency, status: 'unavailable', fetchedAt: null, items: [] });
    await writeFile(paths.JPY, JSON.stringify(unavailable('JPY')));
    await writeFile(paths.USD, JSON.stringify(unavailable('USD')));
    const usd = snapshot('2026-10-20T10:00:00.000Z');
    const jpy = { ...usd, currency: 'JPY', items: usd.items.map(item => ({ ...item, priceMinor: 10000, priceText: '¥100' })) };
    const history = await prepareHistoryUpdate(usd, { indexPath, directory });
    await saveSnapshotPair({ JPY: jpy, USD: usd }, paths, history.files);
    assert.equal(JSON.parse(await readFile(paths.USD, 'utf8')).items[0].priceText, '$1.23');
    assert.equal(JSON.parse(await readFile(paths.JPY, 'utf8')).items[0].priceText, '¥100');
    assert.equal(JSON.parse(await readFile(indexPath, 'utf8')).products.length, 1);
    assert.equal(JSON.parse(await readFile(new URL(`${historyId('Cube A')}.json`, directory), 'utf8')).points.length, 1);
  });
});

test('same-price observations remain distinct and price changes are stored as cents', async () => {
  await withHistory(async paths => {
    const first = snapshot('2026-10-20T10:00:00.000Z');
    await saveFilesAtomically((await prepareHistoryUpdate(first, paths)).files);
    const samePrice = snapshot('2026-10-21T10:00:00.000Z', [item('Cube A', 123, 5)]);
    await saveFilesAtomically((await prepareHistoryUpdate(samePrice, paths)).files);
    const changed = snapshot('2026-10-22T10:00:00.000Z', [item('Cube A', 257, 3)]);
    await saveFilesAtomically((await prepareHistoryUpdate(changed, paths)).files);
    const file = JSON.parse(await readFile(new URL(`${historyId('Cube A')}.json`, paths.directory), 'utf8'));
    assert.deepEqual(file.points.map(point => [point.observedAt, point.priceCents, point.listings]), [
      ['2026-10-20T10:00:00.000Z', 123, 4],
      ['2026-10-21T10:00:00.000Z', 123, 5],
      ['2026-10-22T10:00:00.000Z', 257, 3],
    ]);
  });
});

test('unpriced items create no zero-price observation', async () => {
  await withHistory(async paths => {
    const plan = await prepareHistoryUpdate(snapshot('2026-10-20T10:00:00.000Z', [item('No price', null, 0)]), paths);
    assert.equal(plan.products, 0);
    assert.equal(plan.observations, 0);
  });
});

test('conflicting same-time observations and corrupt prior files are rejected before writes', async () => {
  await withHistory(async paths => {
    const first = snapshot('2026-10-20T10:00:00.000Z');
    await saveFilesAtomically((await prepareHistoryUpdate(first, paths)).files);
    await assert.rejects(prepareHistoryUpdate(snapshot(first.fetchedAt, [item('Cube A', 999, 4)]), paths), /Conflicting/);
    const id = historyId('Cube A');
    await writeFile(new URL(`${id}.json`, paths.directory), '{bad json');
    await assert.rejects(prepareHistoryUpdate(snapshot('2026-10-21T10:00:00.000Z'), paths), /Could not validate existing history/);
  });
});

test('atomic file updates restore earlier market/cache files if a later rename fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbcm-atomic-'));
  const existing = pathToFileURL(join(dir, 'market.json'));
  const blocked = pathToFileURL(join(dir, 'blocked'));
  await writeFile(existing, 'previous market');
  await mkdir(blocked);
  try {
    await assert.rejects(saveFilesAtomically([
      { path: existing, content: 'new market' },
      { path: blocked, content: 'new history' },
    ]));
    assert.equal(await readFile(existing, 'utf8'), 'previous market');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('history periods use timestamps, one point remains visible, and JPY uses one current FX rate', () => {
  const now = Date.parse('2026-10-25T12:00:00.000Z');
  const points = [
    { observedAt: '2026-09-20T12:00:00.000Z', priceCents: 3, listings: 1 },
    { observedAt: '2026-10-15T12:00:00.000Z', priceCents: 4, listings: 2 },
    { observedAt: '2026-10-24T12:00:00.000Z', priceCents: 5, listings: 3 },
  ];
  assert.deepEqual(filterHistoryPoints(points, '7d', now).map(point => point.priceCents), [5]);
  assert.deepEqual(filterHistoryPoints(points, '30d', now).map(point => point.priceCents), [4, 5]);
  assert.deepEqual(filterHistoryPoints(points, 'all', now), points);
  const rate = { schemaVersion: 1, source: 'Frankfurter', apiUrl: 'https://api.frankfurter.dev/v2/rate/USD/JPY',
    base: 'USD', quote: 'JPY', rate: 157.12, rateDate: '2026-10-25', fetchedAt: '2026-10-25T10:00:00.000Z' };
  const jpy = makeChartPoints(points, 'JPY', rate, now);
  assert.deepEqual(jpy.map(point => point.value), [5, 6, 8]);
  assert.equal(makeChartPoints(points, 'USD', null, now)[0].value, 0.03);
  assert.equal(makeChartPoints(points, 'JPY', { ...rate, rateDate: '2026-10-20' }, now), null);
  assert.equal(parseProductHistory({ schemaVersion: 1, appid: 5084200, currency: 'USD', marketHashName: 'Cube A', points }, 'Cube A') !== null, true);
  assert.throws(() => validateProductHistory({ schemaVersion: 1, appid: 5084200, currency: 'USD', marketHashName: 'Cube A',
    points: [{ observedAt: '2026-02-31T00:00:00.000Z', priceCents: 1, listings: 1 }] }, 'Cube A'));
});
