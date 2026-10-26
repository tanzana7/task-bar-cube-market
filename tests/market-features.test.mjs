import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTechnicalIndicators, currencyView, filterMarketItems, isObservationStale, makeRankingSnapshot, parseFavorites, parsePriceFilterInput, parseRankingSnapshot, priceStatistics, summarizeMarket, toggleFavorite } from '../src/market-features.ts';

const marketItem = (marketHashName, name, priceMinor, listings) => ({ marketHashName, name, imageUrl: null, priceMinor,
  priceText: priceMinor === null ? null : `$${(priceMinor / 100).toFixed(2)}`, listings,
  steamUrl: `https://steamcommunity.com/market/listings/5084200/${encodeURIComponent(marketHashName)}` });

test('filters by text, price, listings and favorite while keeping unknowns available by default', () => {
  const items = [marketItem('a', 'Alpha', 100, 3), marketItem('b', 'Beta', 250, 8), marketItem('c', 'Unknown', null, null)];
  const favorites = new Set(['b']);
  const base = { query: '', minimumPrice: null, maximumPrice: null, minimumListings: null, favoritesOnly: false, favorites };
  assert.deepEqual(filterMarketItems(items, base, 'price-asc').map(item => item.name), ['Alpha', 'Beta', 'Unknown']);
  assert.deepEqual(filterMarketItems(items, { ...base, query: 'ta', minimumPrice: 200, maximumPrice: 300, minimumListings: 5, favoritesOnly: true }, 'listings-desc').map(item => item.name), ['Beta']);
  assert.deepEqual(filterMarketItems(items, { ...base, minimumListings: 4 }, 'name').map(item => item.name), ['Beta']);
  assert.deepEqual(filterMarketItems(items, base, 'listings-asc').map(item => item.name), ['Alpha', 'Beta', 'Unknown']);
});

test('parses price filters exactly in currency minor units and reports invalid values', () => {
  for (const [input, cents] of [['0.03', 3], ['0.29', 29], ['1.99', 199], ['100.00', 10000]]) {
    assert.deepEqual(parsePriceFilterInput(input, 'USD'), { value: cents, error: null });
  }
  assert.deepEqual(parsePriceFilterInput('157', 'JPY'), { value: 15700, error: null });
  assert.equal(parsePriceFilterInput('0.291', 'USD').value, null);
  assert.match(parsePriceFilterInput('0.291', 'USD').error, /小数第2位/);
  assert.match(parsePriceFilterInput('157.1', 'JPY').error, /整数/);
  assert.match(parsePriceFilterInput('1e2', 'USD').error, /価格は/);
  assert.equal(parsePriceFilterInput('', 'USD').error, null);
});

test('price ranges follow the currently selected USD or converted JPY units', () => {
  const usd = { schemaVersion: 2, appid: 5084200, currency: 'USD', status: 'ok', fetchedAt: '2026-10-25T00:00:00.000Z',
    items: [marketItem('cheap', 'Cheap', 29, 1), marketItem('next', 'Next', 30, 2)] };
  const filters = { query: '', minimumPrice: parsePriceFilterInput('0.29', 'USD').value, maximumPrice: null,
    minimumListings: null, favoritesOnly: false, favorites: new Set() };
  assert.deepEqual(filterMarketItems(usd.items, filters, 'price-asc').map(item => item.marketHashName), ['cheap', 'next']);
  const jpy = currencyView(usd, 'JPY', 150);
  const jpyMinimum = parsePriceFilterInput('44', 'JPY').value;
  assert.deepEqual(filterMarketItems(jpy.items, { ...filters, minimumPrice: jpyMinimum }, 'price-asc').map(item => item.marketHashName), ['cheap', 'next']);
  assert.deepEqual(filterMarketItems(jpy.items, { ...filters, minimumPrice: parsePriceFilterInput('45', 'JPY').value }, 'price-asc').map(item => item.marketHashName), ['next']);
});

test('verified and reference prices compare by selected currency without mixing currency units', () => {
  const items = [
    { ...marketItem('verified', 'Verified', 29, 2) },
    { ...marketItem('reference-usd', 'Reference USD', null, 3), comparisonPriceMinor: 3, comparisonCurrency: 'USD', comparisonKind: 'reference' },
    { ...marketItem('reference-jpy', 'Reference JPY', null, 4), comparisonPriceMinor: 500, comparisonCurrency: 'JPY', comparisonKind: 'reference' },
    marketItem('unknown', 'Unknown', null, 5),
  ];
  const base = { query: '', minimumPrice: null, maximumPrice: null, minimumListings: null, favoritesOnly: false, favorites: new Set() };
  assert.deepEqual(filterMarketItems(items, { ...base, currency: 'USD' }, 'price-asc').map(item => item.name),
    ['Reference USD', 'Verified', 'Reference JPY', 'Unknown']);
  assert.deepEqual(filterMarketItems(items, { ...base, currency: 'USD', minimumPrice: 3, maximumPrice: 29 }, 'price-asc').map(item => item.name),
    ['Reference USD', 'Verified']);
  assert.deepEqual(filterMarketItems(items, { ...base, currency: 'JPY', minimumPrice: 500, maximumPrice: 500 }, 'price-asc').map(item => item.name),
    ['Reference JPY']);
});

test('watchlist is keyed by market name and handles malformed storage without throwing', () => {
  assert.deepEqual([...parseFavorites('["Localized Name", "other"]')], ['Localized Name', 'other']);
  assert.equal(parseFavorites('{bad').size, 0);
  const next = toggleFavorite(new Set(['item']), 'item');
  assert.equal(next.has('item'), false);
  assert.equal(toggleFavorite(next, 'item').has('item'), true);
});

test('overview distinguishes unavailable listing counts from a real zero', () => {
  assert.deepEqual(summarizeMarket([marketItem('a', 'A', 0, 0), marketItem('b', 'B', 10, 4)]), { itemTypes: 2, totalListings: 4 });
  assert.deepEqual(summarizeMarket([marketItem('a', 'A', 0, null)]), { itemTypes: 1, totalListings: null });
});

test('observations become stale after 24 hours without treating future or invalid timestamps as current data', () => {
  const now = Date.parse('2026-10-26T00:00:00.000Z');
  assert.equal(isObservationStale('2026-10-25T00:00:00.000Z', now), false);
  assert.equal(isObservationStale('2026-10-24T23:59:59.999Z', now), true);
  assert.equal(isObservationStale('2026-10-26T00:01:00.000Z', now), false);
  assert.equal(isObservationStale('invalid', now), false);
});

test('period stats use observed points and avoid division by a zero baseline', () => {
  const points = [
    { observedAt: '2026-10-20T00:00:00.000Z', priceCents: 100, listings: 7 },
    { observedAt: '2026-10-24T00:00:00.000Z', priceCents: 150, listings: 5 },
  ];
  const stats = priceStatistics(points, 'all', Date.parse('2026-10-25T00:00:00.000Z'));
  assert.equal(stats.minimum, 100); assert.equal(stats.maximum, 150); assert.equal(stats.changePercent, 50); assert.equal(stats.latestListings, 5);
  assert.equal(priceStatistics([{ ...points[0], priceCents: 0 }, points[1]], 'all').changePercent, null);
});

test('rankings require actual observations near each period and validate the compact output', () => {
  const recent = [
    { observedAt: '2026-10-24T00:00:00.000Z', priceCents: 100, listings: 4 },
    { observedAt: '2026-10-25T00:00:00.000Z', priceCents: 120, listings: 5 },
  ];
  const sparse = [
    { observedAt: '2026-09-25T00:00:00.000Z', priceCents: 100, listings: 4 },
    { observedAt: '2026-10-25T00:00:00.000Z', priceCents: 200, listings: 5 },
  ];
  const result = makeRankingSnapshot([{ marketHashName: 'up', points: recent }, { marketHashName: 'sparse', points: sparse }], '2026-10-25T00:00:00.000Z');
  assert.deepEqual(result.periods['24h'].up.map(item => item.marketHashName), ['up']);
  assert.deepEqual(result.periods['7d'].up, []);
  assert.ok(parseRankingSnapshot(result));
  assert.equal(parseRankingSnapshot({ ...result, periods: { ...result.periods, '24h': { ...result.periods['24h'], toleranceHours: 100 } } }), null);
});

test('rankings exclude stale histories and items absent from the current priced snapshot', () => {
  const now = '2026-10-25T00:00:00.000Z';
  const stale = [
    { observedAt: '2026-09-20T00:00:00.000Z', priceCents: 100, listings: 1 },
    { observedAt: '2026-09-21T00:00:00.000Z', priceCents: 200, listings: 2 },
  ];
  const current = [
    { observedAt: '2026-10-24T00:00:00.000Z', priceCents: 100, listings: 1 },
    { observedAt: now, priceCents: 200, listings: 2 },
  ];
  const result = makeRankingSnapshot([
    { marketHashName: 'stale', points: stale },
    { marketHashName: 'unpriced-now', points: current },
    { marketHashName: 'current', points: current },
  ], now, ['current']);
  assert.deepEqual(result.periods['24h'].up.map(item => item.marketHashName), ['current']);
});

test('technical indicators appear only after enough observed points', () => {
  assert.equal(calculateTechnicalIndicators([{ observedAt: '2026-10-25T00:00:00.000Z', priceCents: 100, listings: 1 }])[0].sma20, null);
  const points = Array.from({ length: 20 }, (_, index) => ({ observedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), priceCents: 100 + index, listings: index }));
  const last = calculateTechnicalIndicators(points).at(-1);
  assert.equal(last.sma20, 109.5); assert.ok(last.upperBand > last.sma20); assert.ok(last.lowerBand < last.sma20); assert.ok(last.rsi14 > 0);
});

test('JPY market view converts canonical USD when fresh and withholds it without a rate', () => {
  const usd = { schemaVersion: 2, appid: 5084200, currency: 'USD', status: 'ok', fetchedAt: '2026-10-25T00:00:00.000Z', items: [marketItem('a', 'A', 123, 2)] };
  assert.equal(currencyView(usd, 'JPY', 150).items[0].priceText, '¥185');
  assert.equal(currencyView(usd, 'JPY', null).items[0].priceText, null);
  assert.equal(currencyView(usd, 'USD', null).items[0].priceText, '$1.23');
});
