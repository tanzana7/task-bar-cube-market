import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { importMarketFile, mergeMarketObservations, parseMarketImport, validateMarketObservations } from '../scripts/market-import.mjs';
import { latestObservedItems, parseMarketObservations } from '../src/market-observations.ts';

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

test('TBH real fixture is rejected for TBC publication and cannot create a public output file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tbcm-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'tbh.json');
  const output = join(directory, 'public-observations.json');
  await writeFile(input, JSON.stringify(tbh));
  await assert.rejects(importMarketFile({ inputPath: input, outputPath: output, format: 'query-action', observedAt,
    provenance: 'TBH test only', publish: true, now: fixedNow }), /AppID is invalid/);
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
    format: 'search-render', observedAt, provenance: 'operator feed', publish: true, now: fixedNow }), /Could not read previous public observations/);
  await assert.equal(await readFile(path, 'utf8'), '{broken');
  await unlink(path);
  const published = await importMarketFile({ inputPath: input, outputPath: path, format: 'search-render', observedAt,
    provenance: 'operator feed', publish: true, now: fixedNow });
  assert.equal(published.changed, true);
  const firstWrite = await readFile(path, 'utf8');
  assert.equal(JSON.parse(firstWrite).appid, 5084200);
  const repeated = await importMarketFile({ inputPath: input, outputPath: path, format: 'search-render', observedAt,
    provenance: 'operator feed', publish: true, now: fixedNow });
  assert.equal(repeated.changed, false);
  assert.equal(await readFile(path, 'utf8'), firstWrite);
  const duplicate = mergeMarketObservations(valid, valid);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.snapshot.products[0].observations.length, 1);
});

test('bad AppID, duplicate item, malformed USD price and invalid time are rejected', () => {
  assert.throws(() => parseImport({ payload: { ...renderPayload, results: [{ ...renderRow,
    asset_description: { ...renderRow.asset_description, appid: 3678970 } }] }, format: 'search-render', observedAt, provenance: 'x' }), /AppID/);
  assert.throws(() => parseImport({ payload: { ...renderPayload, pagesize: 2, results: [renderRow, renderRow] }, format: 'search-render', observedAt, provenance: 'x' }), /duplicate/);
  assert.throws(() => parseImport({ payload: { ...renderPayload, results: [{ ...renderRow, sell_price_text: '$0.30' }] }, format: 'search-render', observedAt, provenance: 'x' }), /price/);
  assert.throws(() => parseImport({ payload: renderPayload, format: 'search-render', observedAt: 'yesterday', provenance: 'x' }), /timestamp/);
  assert.throws(() => parseImport({ payload: renderPayload, format: 'search-render', observedAt: '2026-10-25T10:10:00.000Z', provenance: 'x' }), /future/);
});
