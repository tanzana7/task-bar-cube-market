import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectTbhMarket, tbhSearchUrl } from '../scripts/verify-tbh.mjs';

const tbhFixture = JSON.parse(await readFile(new URL('./fixtures/tbh-search-page.json', import.meta.url), 'utf8'));

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
