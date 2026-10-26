import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { observationChange, periodChange, referenceComparisons, referenceSeries } from '../src/market-analysis.ts';
import { parseMarketObservations } from '../src/market-observations.ts';

const real = parseMarketObservations(JSON.parse(readFileSync(new URL('../public/market-observations.json', import.meta.url), 'utf8')));

test('published TBC observations produce disclosed quality-band comparisons without treating unknown Grade as known', () => {
  assert.ok(real);
  assert.equal(real.products.length, 131);
  assert.equal(real.products.reduce((count, product) => count + product.observations.length, 0), 191);
  const comparisons = referenceComparisons(real);
  assert.equal(comparisons.length, 112);
  assert.equal(comparisons.filter(entry => entry.deltaMinor < 0).length, 28);
  assert.ok(comparisons.every(entry => entry.groupSize >= 3 && entry.grade === null));
  assert.ok(comparisons.every(entry => entry.qualityBand.includes('–')));
  assert.ok(comparisons.every(entry => entry.priceMinor >= 0 && entry.medianMinor >= 0));
});

test('prior observation changes use actual timestamps and do not invent 24h differences', () => {
  const changes = real.products.flatMap(product => observationChange(real, product.marketHashName) ?? []);
  assert.equal(changes.length, 60);
  assert.equal(changes.filter(change => (change.priceDelta ?? 0) > 0).length, 1);
  assert.equal(changes.filter(change => (change.priceDelta ?? 0) < 0).length, 0);
  assert.equal(changes.filter(change => (change.listingsDelta ?? 0) > 0).length, 6);
  assert.equal(changes.filter(change => (change.listingsDelta ?? 0) < 0).length, 1);
  assert.ok(changes.every(change => Date.parse(change.latest.observedAt) > Date.parse(change.previous.observedAt)));
  assert.ok(real.products.every(product => periodChange(real, product.marketHashName, 24) === null));
  assert.ok(real.products.every(product => periodChange(real, product.marketHashName, 168) === null));
});

test('different price bases, missing prices and duplicate observations are excluded from reference changes', () => {
  const source = real.products.find(product => product.observations.length >= 2);
  assert.ok(source);
  const base = structuredClone(real);
  const product = base.products.find(entry => entry.marketHashName === source.marketHashName);
  product.observations.push({ ...product.observations.at(-1), observedAt: '2026-10-25T14:00:00.000Z', priceBasis: 'other', referencePriceText: '$0.01' });
  assert.equal(referenceSeries(base, product.marketHashName).length, 0);
  product.observations.pop();
  product.observations.push({ ...product.observations.at(-1) });
  assert.equal(referenceSeries(base, product.marketHashName).length, source.observations.length);
});
