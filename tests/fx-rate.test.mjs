import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { collectPair, FX_RATE_URL } from '../scripts/steam-market.mjs';
import { updateFxRate, validateFxCache } from '../scripts/fx-rate.mjs';
import { deriveJpyReferenceSnapshot, formatFxRateLabel, parseFreshFxRate } from '../src/market.ts';

const now = () => new Date('2026-10-25T09:00:00.000Z');
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

async function withCache(action) {
  const dir = await mkdtemp(join(tmpdir(), 'tbcm-fx-rate-'));
  const cachePath = pathToFileURL(join(dir, 'fx-rate.json'));
  try { await action(cachePath); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

const validBody = { base: 'USD', quote: 'JPY', rate: 157.12, date: '2026-10-23' };

test('standalone FX updater fetches only Frankfurter and writes the validated record', async () => {
  await withCache(async cachePath => {
    const requests = [];
    const result = await updateFxRate({ cachePath, now, fetchImpl: async url => {
      requests.push(url);
      return reply(validBody);
    } });
    assert.deepEqual(requests, [FX_RATE_URL]);
    assert.equal(result.status, 'updated');
    assert.deepEqual(result.record, {
      schemaVersion: 1, source: 'Frankfurter', apiUrl: FX_RATE_URL, base: 'USD', quote: 'JPY',
      rate: 157.12, rateDate: '2026-10-23', fetchedAt: '2026-10-25T09:00:00.000Z',
    });
    assert.deepEqual(await validateFxCache(cachePath, now()), result.record);
  });
});

test('weekend observation remains valid without refreshing fetchedAt', async () => {
  await withCache(async cachePath => {
    const result = await updateFxRate({ cachePath, now, fetchImpl: async () => reply(validBody) });
    assert.equal(result.record.rateDate, '2026-10-23');
  });
});

test('market fallback reuses the validated standalone rate cache without fetching another FX quote', async () => {
  await withCache(async cachePath => {
    const rate = { schemaVersion: 1, source: 'Frankfurter', apiUrl: FX_RATE_URL, base: 'USD', quote: 'JPY',
      rate: 157.12, rateDate: '2026-10-23', fetchedAt: '2026-10-25T09:00:00.000Z' };
    await writeFile(cachePath, JSON.stringify(rate));
    const pages = JSON.parse(await readFile(new URL('./fixtures/steam-pages.json', import.meta.url), 'utf8'));
    const pair = await collectPair(async url => reply(pages.USD[Number(new URL(url).searchParams.get('start'))]),
      async () => {}, async () => { throw new Error('cached FX should be used'); }, now,
      { fxRateCachePath: cachePath });
    assert.equal(pair.JPY.fxRate.rate, 157.12);
    assert.equal(pair.JPY.fxRate.fetchedAt, rate.fetchedAt);
  });
});

test('same daily rate is unchanged and does not rewrite the cache', async () => {
  await withCache(async cachePath => {
    const prior = {
      schemaVersion: 1, source: 'Frankfurter', apiUrl: FX_RATE_URL, base: 'USD', quote: 'JPY',
      rate: validBody.rate, rateDate: validBody.date, fetchedAt: '2026-10-24T09:00:00.000Z',
    };
    const bytes = `${JSON.stringify(prior, null, 2)}\n`;
    await writeFile(cachePath, bytes);
    const result = await updateFxRate({ cachePath, now, fetchImpl: async () => reply(validBody) });
    assert.equal(result.status, 'unchanged');
    assert.equal(result.record.fetchedAt, prior.fetchedAt);
    assert.equal(await readFile(cachePath, 'utf8'), bytes);
  });
});

test('invalid, stale, future and failed observations leave the prior cache untouched', async () => {
  await withCache(async cachePath => {
    const prior = { schemaVersion: 1, source: 'Frankfurter', apiUrl: FX_RATE_URL, base: 'USD', quote: 'JPY',
      rate: 150, rateDate: '2026-10-23', fetchedAt: '2026-10-24T09:00:00.000Z' };
    const bytes = `${JSON.stringify(prior, null, 2)}\n`;
    await writeFile(cachePath, bytes);
    for (const body of [
      { ...validBody, rate: 0 },
      { ...validBody, rate: 10001 },
      { ...validBody, base: 'EUR' },
      { ...validBody, date: '2026-10-26' },
      { ...validBody, date: '2026-10-20' },
    ]) {
      await assert.rejects(updateFxRate({ cachePath, now, fetchImpl: async () => reply(body) }), /invalid or stale/);
      assert.equal(await readFile(cachePath, 'utf8'), bytes);
    }
    await assert.rejects(updateFxRate({ cachePath, now, fetchImpl: async () => reply({}, 503) }), /HTTP 503/);
    assert.equal(await readFile(cachePath, 'utf8'), bytes);
    await assert.rejects(updateFxRate({ cachePath, now, fetchImpl: async () => { throw new Error('offline'); } }), /network request failed/);
    assert.equal(await readFile(cachePath, 'utf8'), bytes);
  });
});

test('FX-only repricing uses aligned USD capture and preserves market fetchedAt', () => {
  const usd = { schemaVersion: 2, appid: 5084200, status: 'ok', fetchedAt: '2026-10-24T08:00:00Z',
    currency: 'USD', priceSource: 'steam', items: [{ name: 'Cube item', marketHashName: 'Cube item',
      imageUrl: null, priceMinor: 3, priceText: '$0.03', listings: 4,
      steamUrl: 'https://steamcommunity.com/market/listings/5084200/Cube%20item' }] };
  const jpy = { ...usd, currency: 'JPY', priceSource: 'fx', items: [{ ...usd.items[0], priceMinor: 500, priceText: '¥5' }] };
  const rate = parseFreshFxRate({ schemaVersion: 1, source: 'Frankfurter', apiUrl: FX_RATE_URL,
    base: 'USD', quote: 'JPY', rate: 157.12, rateDate: '2026-10-25', fetchedAt: '2026-10-25T08:00:00Z' },
  Date.parse('2026-10-25T09:00:00Z'));
  assert.ok(rate);
  assert.equal(formatFxRateLabel(rate), '参考為替：1 USD ≒ 157.12 JPY（2026-10-25）');
  const repriced = deriveJpyReferenceSnapshot(jpy, usd, rate);
  assert.equal(repriced.items[0].priceText, '¥5');
  assert.equal(repriced.fetchedAt, usd.fetchedAt);
  assert.equal(repriced.fxRate.fetchedAt, rate.fetchedAt);
  assert.equal(deriveJpyReferenceSnapshot({ ...jpy, priceSource: 'steam' }, usd, rate), null);
  assert.equal(deriveJpyReferenceSnapshot({ ...jpy, fetchedAt: '2026-10-23T08:00:00Z' }, usd, rate), null);
});

test('FX label is absent when the rate is stale or future-dated, including an empty market', () => {
  const empty = [];
  assert.equal(empty.length, 0);
  const current = parseFreshFxRate({ schemaVersion: 1, source: 'Frankfurter', apiUrl: FX_RATE_URL,
    base: 'USD', quote: 'JPY', rate: 157.12, rateDate: '2026-10-25', fetchedAt: '2026-10-25T08:00:00Z' },
  Date.parse('2026-10-25T09:00:00Z'));
  assert.equal(formatFxRateLabel(current), '参考為替：1 USD ≒ 157.12 JPY（2026-10-25）');
  assert.equal(parseFreshFxRate({ schemaVersion: 1, source: 'Frankfurter', apiUrl: FX_RATE_URL,
    base: 'USD', quote: 'JPY', rate: 157, rateDate: '2026-10-20', fetchedAt: '2026-10-20T09:00:00Z' },
  Date.parse('2026-10-25T09:00:00Z')), null);
  assert.equal(parseFreshFxRate({ schemaVersion: 1, source: 'Frankfurter', apiUrl: FX_RATE_URL,
    base: 'USD', quote: 'JPY', rate: 157, rateDate: '2026-10-26', fetchedAt: '2026-10-25T09:00:00Z' },
  Date.parse('2026-10-25T09:00:00Z')), null);
  assert.equal(formatFxRateLabel(null), null);
});
