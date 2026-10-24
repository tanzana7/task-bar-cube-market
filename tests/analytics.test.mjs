import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics } from '../src/analytics.ts';

test('analytics stays disabled for placeholder or absent ID', () => {
  const target = {};
  let loads = 0;
  for (const id of [undefined, 'G-XXXXXXXXXX']) {
    const analytics = createAnalytics(id, 'https://example.com/', target, () => { loads++; });
    analytics.grant();
    analytics.event('currency_change', { currency: 'JPY' });
    assert.equal(analytics.enabled, false);
  }
  assert.equal(loads, 0);
  assert.equal(target.dataLayer, undefined);
});

test('consent initializes once and sends one page view without a query or search term', () => {
  const target = {};
  const scripts = [];
  const analytics = createAnalytics('G-1H7ZSVY2G8', 'https://example.com/', target, url => scripts.push(url));
  analytics.grant();
  analytics.grant();
  analytics.event('currency_change', { currency: 'USD' });
  analytics.event('steam_market_click', { destination: 'steam_market' });
  assert.equal(scripts.length, 1);
  assert.equal(target.dataLayer.filter(x => x[0] === 'config').length, 1);
  assert.equal(target.dataLayer.filter(x => x[1] === 'page_view').length, 1);
  assert.equal(target.dataLayer.filter(x => x[1] === 'currency_change').length, 1);
  assert.equal(target.dataLayer.filter(x => x[1] === 'steam_market_click').length, 1);
  assert.equal(target.dataLayer[2][2].page_location, 'https://example.com/');
  assert.equal(JSON.stringify(target.dataLayer).includes('search_term'), false);
});
