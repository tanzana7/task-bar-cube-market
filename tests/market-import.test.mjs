import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { importMarketFile, mergeMarketObservations, parseMarketImport, parseMarketImportBatch, validateMarketObservations } from '../scripts/market-import.mjs';
import { latestObservedItems, parseMarketObservations, selectMarketDisplayItems } from '../src/market-observations.ts';

const observedAt = '2026-10-25T09:00:00.000Z';
const fixedNow = new Date('2026-10-25T10:00:00.000Z');
const parseImport = options => parseMarketImport({ ...options, now: fixedNow });
const tbh = JSON.parse(await readFile(new URL('./fixtures/tbh-query-action-real-start30-usd.json', import.meta.url), 'utf8'));
const renderRow = {
  name: 'Cube sample', sell_price: 29, sell_price_text: '$0.29', sell_listings: 3,
  asset_description: { appid: 5084200, market_hash_name: 'Cube sample', icon_url: '0123456789abcdef' },
};
const renderPayload = { success: true, start: 0, pagesize: 1, total_count: 4, results: [renderRow] };

test('TBC search/render import validates source, currency, price, image, Steam URL and partial coverage', () => {
  const result = parseImport({ payload: renderPayload, format: 'search-render', observedAt, provenance: 'operator-provided Steam response' });
  assert.equal(result.appid, 5084200);
  assert.equal(result.products[0].observations[0].priceMinor, 29);
  assert.equal(result.products[0].observations[0].listings, 3);
  assert.equal(result.products[0].steamUrl, 'https://steamcommunity.com/market/listings/5084200/Cube%20sample');
  assert.equal(result.imports[0].complete, false);
  assert.equal(validateMarketObservations(result), result);
});

test('queryAction subtotal remains a reference and never becomes a sortable or historical price', () => {
  const tbcCopy = structuredClone(tbh);
  for (const row of tbcCopy.data.results) row.asset_description.appid = 5084200;
  const result = parseImport({ payload: tbcCopy, format: 'query-action', observedAt, provenance: 'isolated parser fixture' });
  assert.equal(result.products.length, 30);
  assert.ok(result.products.every(product => product.observations[0].priceMinor === null
    && product.observations[0].priceText === null && product.observations[0].referencePriceText === '$0.03'));
  assert.ok(result.products.every(product => product.observations[0].requestCurrencyId === null
    && product.observations[0].responseCurrencyId === 1));
});

test('public UI parser renders imported prices with source time and keeps queryAction values non-numeric', () => {
  const tbcCopy = structuredClone(tbh);
  for (const row of tbcCopy.data.results) row.asset_description.appid = 5084200;
  const data = parseImport({ payload: tbcCopy, format: 'query-action', observedAt, provenance: 'captured Steam response' });
  const parsed = parseMarketObservations(data);
  assert.ok(parsed);
  const products = latestObservedItems(parsed);
  assert.equal(products.length, 30);
  assert.equal(products[0].priceMinor, null);
  assert.match(products[0].importedPriceText, /\$0\.03 USD/);
  assert.equal(products[0].observation?.observedAt, observedAt);
});

test('auto-detects and merges multiple pages while preserving per-page times and partial coverage', () => {
  const secondRow = { ...renderRow, name: 'Cube sample 2', sell_price: 199, sell_price_text: '$1.99',
    asset_description: { ...renderRow.asset_description, market_hash_name: 'Cube sample 2' } };
  const pages = [
    { payload: { ...renderPayload, start: 0, total_count: 2, pagesize: 1 }, observedAt, provenance: 'test source' },
    { payload: { ...renderPayload, start: 1, total_count: 2, pagesize: 1, results: [secondRow] },
      observedAt: '2026-10-25T09:01:00.000Z', provenance: 'test source' },
  ];
  const result = parseMarketImportBatch({ documents: pages, now: fixedNow });
  assert.equal(result.products.length, 2);
  assert.deepEqual(result.products.map(product => product.marketHashName), ['Cube sample', 'Cube sample 2']);
  assert.equal(result.products[1].observations[0].priceMinor, 199);
  assert.equal(result.imports.length, 2);
  assert.ok(result.imports.every(capture => capture.complete === false));
  assert.throws(() => parseMarketImportBatch({ documents: [{ payload: renderPayload }], now: fixedNow }), /observation time/);
});

test('file import reads a directory of timestamped response JSON without writing public data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tbcm-pages-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const page0 = { ...renderPayload, start: 0, total_count: 2, pagesize: 1 };
  const page1 = { ...renderPayload, start: 1, total_count: 2, pagesize: 1,
    results: [{ ...renderRow, name: 'Second cube', sell_price: 99, sell_price_text: '$0.99',
      asset_description: { ...renderRow.asset_description, market_hash_name: 'Second cube' } }] };
  await writeFile(join(directory, '01.json'), JSON.stringify({ response: page1, observedAt: '2026-10-25T09:01:00.000Z', provenance: 'operator capture' }));
  await writeFile(join(directory, '00.json'), JSON.stringify({ response: page0, observedAt, provenance: 'operator capture' }));
  const output = join(directory, 'public.json');
  const result = await importMarketFile({ inputPath: directory, outputPath: output, now: fixedNow });
  assert.equal(result.preview.products.length, 2);
  assert.equal(result.preview.imports[0].observedAt, observedAt);
  assert.equal(result.preview.imports[1].observedAt, '2026-10-25T09:01:00.000Z');
  await assert.rejects(readFile(output, 'utf8'), { code: 'ENOENT' });
});

test('newer imports replace stale duplicate display data without upgrading queryAction reference prices', () => {
  const tbcCopy = structuredClone(tbh);
  for (const row of tbcCopy.data.results) row.asset_description.appid = 5084200;
  const importedData = parseImport({ payload: tbcCopy, format: 'query-action', observedAt: '2026-10-25T09:30:00.000Z', provenance: 'captured response' });
  const imported = latestObservedItems(parseMarketObservations(importedData));
  const canonical = [{ ...imported[0], observation: undefined, importedPriceText: undefined, priceMinor: 29, priceText: '$0.29', listings: 2 }];
  const newer = selectMarketDisplayItems(canonical, '2026-10-25T09:00:00.000Z', imported, 'USD');
  assert.equal(newer.items[0].listings, imported[0].listings);
  assert.equal(newer.imported.get(imported[0].marketHashName)?.priceMinor, null);
  assert.equal(newer.imported.get(imported[0].marketHashName)?.importedPriceText, '$0.03 USD · 参考値');
  const older = selectMarketDisplayItems(canonical, '2026-10-25T10:00:00.000Z', imported, 'USD');
  assert.equal(older.items[0].priceMinor, 29);
  assert.equal(older.imported.has(imported[0].marketHashName), false);
  assert.equal(selectMarketDisplayItems(canonical, null, imported, 'USD').items[0].priceMinor, 29);
  const yen = selectMarketDisplayItems(canonical, '2026-10-25T09:00:00.000Z', imported, 'JPY');
  assert.equal(yen.items[0].priceMinor, null);
});

test('an updated observation appends once and malformed imports do not damage existing data', () => {
  const first = parseImport({ payload: renderPayload, observedAt, provenance: 'operator feed' });
  const changedPayload = { ...renderPayload, results: [{ ...renderRow, sell_price: 35, sell_price_text: '$0.35', sell_listings: 7 }] };
  const second = parseImport({ payload: changedPayload, observedAt: '2026-10-25T09:30:00.000Z', provenance: 'operator feed' });
  const merged = mergeMarketObservations(first, second);
  assert.equal(merged.snapshot.products[0].observations.length, 2);
  assert.equal(merged.snapshot.products[0].observations.at(-1).priceMinor, 35);
  assert.equal(merged.snapshot.products[0].observations.at(-1).listings, 7);
  assert.throws(() => mergeMarketObservations(merged.snapshot, { ...second, appid: 3678970 }), /Invalid public market observations/);
});

test('TBH real fixture is rejected for TBC publication and cannot create a public output file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tbcm-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'tbh.json');
  const output = join(directory, 'public-observations.json');
  await writeFile(input, JSON.stringify(tbh));
  await assert.rejects(importMarketFile({ inputPath: input, outputPath: output, format: 'query-action', observedAt,
    provenance: 'TBH test only', publish: true, rightsConfirmed: true, now: fixedNow }), /AppID is invalid/);
  await assert.rejects(readFile(output, 'utf8'), { code: 'ENOENT' });
});

test('invalid data never replaces a previous valid public cache; duplicate observations are idempotently rejected', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tbcm-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'observations.json');
  const input = join(directory, 'input.json');
  const valid = parseImport({ payload: renderPayload, format: 'search-render', observedAt, provenance: 'operator feed' });
  await writeFile(input, JSON.stringify(renderPayload));
  await writeFile(path, '{broken');
  await assert.rejects(importMarketFile({ inputPath: input, outputPath: path,
    format: 'search-render', observedAt, provenance: 'operator feed', publish: true, rightsConfirmed: true, now: fixedNow }), /Could not read previous public observations/);
  await assert.equal(await readFile(path, 'utf8'), '{broken');
  await unlink(path);
  const published = await importMarketFile({ inputPath: input, outputPath: path, format: 'search-render', observedAt,
    provenance: 'operator feed', publish: true, rightsConfirmed: true, now: fixedNow });
  assert.equal(published.changed, true);
  const firstWrite = await readFile(path, 'utf8');
  assert.equal(JSON.parse(firstWrite).appid, 5084200);
  const repeated = await importMarketFile({ inputPath: input, outputPath: path, format: 'search-render', observedAt,
    provenance: 'operator feed', publish: true, rightsConfirmed: true, now: fixedNow });
  assert.equal(repeated.changed, false);
  assert.equal(await readFile(path, 'utf8'), firstWrite);
  const duplicate = mergeMarketObservations(valid, valid);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.snapshot.products[0].observations.length, 1);
  const attested = parseMarketImport({ payload: renderPayload, observedAt, provenance: 'operator feed', rightsConfirmed: true, now: fixedNow });
  const confirmation = mergeMarketObservations(valid, attested);
  assert.equal(confirmation.changed, true);
  assert.equal(confirmation.snapshot.imports[0].rightsConfirmed, true);
});

test('bad AppID, duplicate item, malformed USD price and invalid time are rejected', () => {
  assert.throws(() => parseImport({ payload: { ...renderPayload, results: [{ ...renderRow,
    asset_description: { ...renderRow.asset_description, appid: 3678970 } }] }, format: 'search-render', observedAt, provenance: 'x' }), /AppID/);
  assert.throws(() => parseImport({ payload: { ...renderPayload, pagesize: 2, results: [renderRow, renderRow] }, format: 'search-render', observedAt, provenance: 'x' }), /duplicate/);
  assert.throws(() => parseImport({ payload: { ...renderPayload, results: [{ ...renderRow, sell_price_text: '$0.30' }] }, format: 'search-render', observedAt, provenance: 'x' }), /price/);
  assert.throws(() => parseImport({ payload: renderPayload, format: 'search-render', observedAt: 'yesterday', provenance: 'x' }), /timestamp/);
  assert.throws(() => parseImport({ payload: renderPayload, format: 'search-render', observedAt: '2026-10-25T10:10:00.000Z', provenance: 'x' }), /future/);
});
