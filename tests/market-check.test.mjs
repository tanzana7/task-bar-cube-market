import test from 'node:test';
import assert from 'node:assert/strict';
import { APPID } from '../scripts/steam-market.mjs';
import { inspectFirstPage } from '../scripts/market-check.mjs';

test('market:check defaults to the local fixture without making a request', async () => {
  let calls = 0;
  const result = await inspectFirstPage({ fetchImpl: async () => { calls += 1; throw new Error('unexpected network call'); } });
  assert.equal(calls, 0);
  assert.equal(result.appid, APPID);
  assert.equal(result.httpStatus, 'fixture');
  assert.equal(result.ok, true);
  assert.equal(result.totalCount, 3);
  assert.equal(result.returned, 2);
});

test('market:check live makes one read-only request for the fixed Cube AppID', async () => {
  let calls = 0;
  const result = await inspectFirstPage({ live: true, fetchImpl: async url => {
    calls += 1;
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('appid'), String(APPID));
    assert.equal(parsed.searchParams.get('start'), '0');
    return { ok: true, status: 200, json: async () => ({
      success: true, start: 0, pagesize: 1, total_count: 1,
      results: [{ name: 'Cube item', hash_name: 'Cube item', sell_price: 125, sell_price_text: '$1.25',
        sell_listings: 1, asset_description: { appid: APPID, market_hash_name: 'Cube item' } }],
    }) };
  } });
  assert.equal(calls, 1);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.responseCurrency, 'USD verified');
  assert.equal(result.returned, 1);
});

test('market:check stops on 403/429 and never retries or falls back', async () => {
  for (const status of [403, 429]) {
    let calls = 0;
    const result = await inspectFirstPage({ live: true, fetchImpl: async () => {
      calls += 1;
      return { ok: false, status };
    } });
    assert.equal(calls, 1);
    assert.equal(result.httpStatus, status);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, true);
  }
});

test('market:check treats non-JSON CAPTCHA-style replies as a stop without printing their body', async () => {
  const result = await inspectFirstPage({ live: true, fetchImpl: async () => ({
    ok: true, status: 200, json: async () => { throw new Error('secret response body'); },
  }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /CAPTCHA/);
  assert.doesNotMatch(JSON.stringify(result), /secret response body/);
});
