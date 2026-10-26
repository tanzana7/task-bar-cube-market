import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bargainSignal, bargainSignals, observationChange, periodChange, referenceComparisons, referenceSeries } from '../src/market-analysis.ts';
import { parseMarketObservations } from '../src/market-observations.ts';

const real = parseMarketObservations(JSON.parse(readFileSync(new URL('../public/market-observations.json', import.meta.url), 'utf8')));

test('published TBC observations produce valid quality-band comparisons as the catalog grows', () => {
  assert.ok(real);
  assert.ok(real.products.length >= 1);
  assert.ok(real.products.reduce((count, product) => count + product.observations.length, 0) >= real.products.length);
  const comparisons = referenceComparisons(real);
  assert.ok(comparisons.length > 0);
  assert.ok(comparisons.every(entry => entry.groupSize >= 3));
  assert.ok(comparisons.every(entry => entry.qualityBand.includes('–')));
  assert.ok(comparisons.every(entry => entry.priceMinor >= 0 && entry.medianMinor >= 0));
});

test('prior observation changes use actual timestamps and do not invent 24h differences', () => {
  const changes = real.products.flatMap(product => observationChange(real, product.marketHashName) ?? []);
  assert.ok(changes.length > 0);
  assert.ok(changes.every(change => Date.parse(change.latest.observedAt) > Date.parse(change.previous.observedAt)));
  assert.ok(changes.every(change => change.priceDelta === null || Number.isFinite(change.priceDelta)));
  assert.ok(real.products.every(product => {
    const period = periodChange(real, product.marketHashName, 24);
    return period === null || period.latest.observedAt !== period.previous.observedAt;
  }));
});

test('different price bases, missing prices and duplicate observations are excluded from reference changes', () => {
  const source = real.products.find(product => product.observations.length >= 2
    && product.observations.every(point => point.sourceKind === 'query-action'
      && point.priceBasis === 'min-sell-subtotal-unverified-fees'));
  assert.ok(source);
  const base = structuredClone(real);
  const product = base.products.find(entry => entry.marketHashName === source.marketHashName);
  product.observations.push({ ...product.observations.at(-1), observedAt: '2026-10-25T14:00:00.000Z', priceBasis: 'other', referencePriceText: '$0.01' });
  assert.equal(referenceSeries(base, product.marketHashName).length, 0);
  product.observations.pop();
  product.observations.push({ ...product.observations.at(-1) });
  assert.equal(referenceSeries(base, product.marketHashName).length, source.observations.length);
});

test('historical bargain requires repeated same-product low quotes, enough history and fresh observation', () => {
  const data = structuredClone(real);
  const product = data.products.find(entry => entry.observations.some(point => point.sourceKind === 'query-action'));
  assert.ok(product);
  const source = product.observations.find(point => point.sourceKind === 'query-action');
  assert.ok(source);
  data.products = [product];
  const times = ['2026-10-25T08:00:00Z', '2026-10-25T12:00:00Z', '2026-10-25T18:00:00Z',
    '2026-10-26T07:00:00Z', '2026-10-26T09:00:00Z', '2026-10-26T10:00:00Z'];
  product.observations = times.map((observedAt, index) => ({ ...source, observedAt,
    referencePriceText: index < 4 ? '$1.00' : '$0.70' }));
  const now = Date.parse('2026-10-26T11:00:00Z');
  const signal = bargainSignal(data, product.marketHashName, now);
  assert.equal(signal?.discountPercent, 30);
  assert.equal(signal?.observations, 6);
  assert.equal(bargainSignals(data, now).some(entry => entry.marketHashName === product.marketHashName), true);
  product.observations[4].referencePriceText = '$1.00';
  assert.equal(bargainSignal(data, product.marketHashName, now), null);
  product.observations[4].referencePriceText = '$0.70';
  product.observations.push({ ...source, observedAt: '2026-10-26T10:30:00Z', referencePriceText: '$1.00' });
  assert.equal(bargainSignal(data, product.marketHashName, now), null);
  product.observations.pop();
  assert.equal(bargainSignal(data, product.marketHashName, now + 25 * 3_600_000), null);
  product.observations[4].priceBasis = 'other';
  assert.equal(bargainSignal(data, product.marketHashName, now), null);
});
