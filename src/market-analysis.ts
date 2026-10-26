import { classifyItemName } from './item-classification.ts';
import { parseUsdReferenceMinor, type MarketObservations, type ObservationPoint } from './market-observations.ts';

export type ComparablePoint = { observedAt: string; priceMinor: number | null; listings: number | null };
export type ObservationChange = {
  marketHashName: string; previous: ComparablePoint; latest: ComparablePoint;
  priceDelta: number | null; pricePercent: number | null; listingsDelta: number | null;
};
export type PriceComparison = {
  marketHashName: string; type: string; quality: number; qualityBand: string; grade: string | null; sourceKind: 'query-action' | 'steam-dom';
  priceMinor: number; medianMinor: number; deltaMinor: number; deltaPercent: number;
  groupSize: number; listings: number | null; observedAt: string;
};

export type BargainPolicy = {
  minObservations: number;
  minSpanHours: number;
  maxAgeHours: number;
  minDiscountPercent: number;
  maxConfirmationGapHours: number;
  maxConfirmationSpreadPercent: number;
  maxDropPercent: number;
};
export const DEFAULT_BARGAIN_POLICY: Readonly<BargainPolicy> = Object.freeze({
  minObservations: 6,
  minSpanHours: 24,
  maxAgeHours: 24,
  minDiscountPercent: 20,
  maxConfirmationGapHours: 6,
  maxConfirmationSpreadPercent: 25,
  maxDropPercent: 80,
});
export type BargainSignal = {
  marketHashName: string;
  latestPriceMinor: number;
  historicalMedianMinor: number;
  discountPercent: number;
  observations: number;
  spanHours: number;
  observedAt: string;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * A cross-item distribution only supports browsing. A historical discount
 * requires repeated observations of the *same* market_hash_name and price basis.
 * Two nearby low quotes confirm that a one-off bad quote is not advertised.
 */
export function bargainSignal(data: MarketObservations | null, marketHashName: string,
  now = Date.now(), policy: Readonly<BargainPolicy> = DEFAULT_BARGAIN_POLICY): BargainSignal | null {
  if (!Number.isFinite(now) || !Number.isSafeInteger(policy.minObservations) || policy.minObservations < 4) return null;
  const points = referenceSeries(data, marketHashName).filter((point): point is ComparablePoint & { priceMinor: number } => point.priceMinor !== null);
  if (points.length < policy.minObservations) return null;
  const latest = points.at(-1)!;
  const confirmation = points.at(-2)!;
  const baseline = points.slice(0, -2);
  const spanHours = (Date.parse(latest.observedAt) - Date.parse(points[0].observedAt)) / 3_600_000;
  const ageHours = (now - Date.parse(latest.observedAt)) / 3_600_000;
  const confirmationGap = (Date.parse(latest.observedAt) - Date.parse(confirmation.observedAt)) / 3_600_000;
  if (baseline.length < 2 || spanHours < policy.minSpanHours || ageHours < 0 || ageHours > policy.maxAgeHours
      || confirmationGap <= 0 || confirmationGap > policy.maxConfirmationGapHours) return null;
  const historicalMedianMinor = median(baseline.map(point => point.priceMinor));
  if (historicalMedianMinor <= 0 || latest.priceMinor <= 0 || confirmation.priceMinor <= 0) return null;
  const discountPercent = (historicalMedianMinor - latest.priceMinor) / historicalMedianMinor * 100;
  const confirmationDiscount = (historicalMedianMinor - confirmation.priceMinor) / historicalMedianMinor * 100;
  const spreadPercent = Math.abs(latest.priceMinor - confirmation.priceMinor) / Math.max(latest.priceMinor, confirmation.priceMinor) * 100;
  if (discountPercent < policy.minDiscountPercent || confirmationDiscount < policy.minDiscountPercent
      || discountPercent > policy.maxDropPercent || spreadPercent > policy.maxConfirmationSpreadPercent) return null;
  return { marketHashName, latestPriceMinor: latest.priceMinor, historicalMedianMinor,
    discountPercent, observations: points.length, spanHours, observedAt: latest.observedAt };
}

export function bargainSignals(data: MarketObservations | null, now = Date.now(),
  policy: Readonly<BargainPolicy> = DEFAULT_BARGAIN_POLICY): BargainSignal[] {
  return (data?.products ?? []).flatMap(product => {
    const signal = bargainSignal(data, product.marketHashName, now, policy);
    return signal ? [signal] : [];
  }).sort((a, b) => b.discountPercent - a.discountPercent);
}

// Reference observations are compared only within the same source, currency and price basis.
// They must never be merged into the verified search/render price history.
function referenceKey(point: ObservationPoint): string | null {
  if (point.currency !== 'USD') return null;
  if (point.sourceKind === 'query-action' && (point.responseCurrencyId !== 1
      || point.priceBasis !== 'min-sell-subtotal-unverified-fees')) return null;
  if (point.sourceKind === 'steam-dom' && (point.responseCurrencyId !== null
      || point.priceBasis !== 'steam-market-rendered-ui-unverified-price')) return null;
  if (point.sourceKind !== 'query-action' && point.sourceKind !== 'steam-dom') return null;
  return `${point.sourceKind}:${point.currency}:${point.priceBasis}`;
}

export function referenceSeries(data: MarketObservations | null, marketHashName: string): ComparablePoint[] {
  const product = data?.products.find(entry => entry.marketHashName === marketHashName);
  if (!product?.observations.length) return [];
  const latestKey = referenceKey(product.observations.at(-1)!);
  if (!latestKey) return [];
  const seen = new Set<string>();
  return product.observations.flatMap(point => {
    if (referenceKey(point) !== latestKey) return [];
    const priceMinor = parseUsdReferenceMinor(point.referencePriceText);
    const row = { observedAt: point.observedAt, priceMinor, listings: point.listings };
    const key = JSON.stringify(row);
    if (seen.has(key)) return [];
    seen.add(key);
    return [row];
  });
}

export function observationChange(data: MarketObservations | null, marketHashName: string): ObservationChange | null {
  const points = referenceSeries(data, marketHashName);
  if (points.length < 2) return null;
  const latest = points.at(-1)!;
  const previous = points.at(-2)!;
  if (Date.parse(latest.observedAt) <= Date.parse(previous.observedAt)) return null;
  const priceDelta = latest.priceMinor === null || previous.priceMinor === null ? null : latest.priceMinor - previous.priceMinor;
  const previousPrice = previous.priceMinor;
  const pricePercent = priceDelta === null || previousPrice === null || previousPrice === 0 ? null : priceDelta / previousPrice * 100;
  const listingsDelta = latest.listings === null || previous.listings === null ? null : latest.listings - previous.listings;
  return { marketHashName, previous, latest, priceDelta, pricePercent, listingsDelta };
}

export function periodChange(data: MarketObservations | null, marketHashName: string, hours: 24 | 168): ObservationChange | null {
  const points = referenceSeries(data, marketHashName);
  if (points.length < 2) return null;
  const latest = points.at(-1)!;
  const target = Date.parse(latest.observedAt) - hours * 3_600_000;
  // The observation must be near the requested lookback, and the latest point must itself be fresh.
  if (Date.now() - Date.parse(latest.observedAt) > 24 * 3_600_000) return null;
  const tolerance = hours === 24 ? 3 : 12;
  const previous = points.slice(0, -1).reduce<ComparablePoint | null>((best, point) =>
    Math.abs(Date.parse(point.observedAt) - target) < Math.abs(Date.parse(best?.observedAt ?? '1970-01-01') - target) ? point : best, null);
  if (!previous || Math.abs(Date.parse(previous.observedAt) - target) > tolerance * 3_600_000) return null;
  const priceDelta = latest.priceMinor === null || previous.priceMinor === null ? null : latest.priceMinor - previous.priceMinor;
  const previousPrice = previous.priceMinor;
  const pricePercent = priceDelta === null || previousPrice === null || previousPrice === 0 ? null : priceDelta / previousPrice * 100;
  const listingsDelta = latest.listings === null || previous.listings === null ? null : latest.listings - previous.listings;
  return { marketHashName, previous, latest, priceDelta, pricePercent, listingsDelta };
}

export function referenceComparisons(data: MarketObservations | null): PriceComparison[] {
  if (!data) return [];
  const groups = new Map<string, Array<{ marketHashName: string; priceMinor: number; listings: number | null; observedAt: string; type: string; quality: number; qualityBand: string; grade: string | null; sourceKind: 'query-action' | 'steam-dom' }>>();
  for (const product of data.products) {
    const point = product.observations.at(-1)!;
    const basisKey = referenceKey(point);
    if (!basisKey || (point.sourceKind !== 'query-action' && point.sourceKind !== 'steam-dom')) continue;
    const priceMinor = parseUsdReferenceMinor(point.referencePriceText);
    const { type, quality, grade } = classifyItemName(product.marketHashName);
    if (priceMinor === null || !type || quality === null) continue;
    // Exact Type + Quality has at most one current product. A disclosed 25-point
    // quality band provides a useful price distribution without implying equal stats.
    const bandStart = Math.floor((quality - 5) / 25) * 25 + 5;
    const qualityBand = `${bandStart}–${Math.min(bandStart + 20, 95)}%`;
    const key = `${basisKey}:${type}:${qualityBand}:${grade ?? 'unknown'}`;
    const group = groups.get(key) ?? [];
    group.push({ marketHashName: product.marketHashName, priceMinor, listings: point.listings,
      observedAt: point.observedAt, type, quality, qualityBand, grade, sourceKind: point.sourceKind });
    groups.set(key, group);
  }
  const result: PriceComparison[] = [];
  for (const group of groups.values()) {
    if (group.length < 3) continue;
    const sorted = group.map(item => item.priceMinor).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    // A median between two cent values can be a half-cent; round once so the
    // displayed median and displayed difference remain arithmetically consistent.
    const medianMinor = sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
    for (const item of group) result.push({ ...item, medianMinor, deltaMinor: item.priceMinor - medianMinor,
      deltaPercent: medianMinor > 0 ? (item.priceMinor - medianMinor) / medianMinor * 100 : 0,
      groupSize: group.length });
  }
  return result.sort((a, b) => a.deltaPercent - b.deltaPercent || a.priceMinor - b.priceMinor);
}
