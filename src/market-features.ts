import type { MarketItem, MarketSnapshot } from './market';
import { filterHistoryPoints, type HistoryPoint, type HistoryRange } from './history.ts';

export type MarketFilters = {
  query: string;
  minimumPrice: number | null;
  maximumPrice: number | null;
  minimumListings: number | null;
  favoritesOnly: boolean;
  favorites: Set<string>;
};

export type MarketSort = 'price-asc' | 'price-desc' | 'name' | 'listings-desc' | 'listings-asc';
export type MarketOverview = { itemTypes: number; totalListings: number | null };
export type PriceStats = {
  minimum: number;
  maximum: number;
  latest: number;
  change: number;
  changePercent: number | null;
  latestListings: number;
};
export type RankingPeriod = '24h' | '7d';
export type RankingItem = { marketHashName: string; fromCents: number; toCents: number; changeCents: number; changePercent: number };
export type RankingSnapshot = { schemaVersion: 1; appid: 5084200; generatedAt: string | null; periods: Record<RankingPeriod, { toleranceHours: number; up: RankingItem[]; down: RankingItem[] }> };
export type TechnicalPoint = { sma20: number | null; upperBand: number | null; lowerBand: number | null; rsi14: number | null };

export function filterMarketItems(items: MarketItem[], filters: MarketFilters, sort: MarketSort): MarketItem[] {
  const needle = filters.query.trim().toLocaleLowerCase();
  const matches = items.filter(item => {
    if (needle && !item.name.toLocaleLowerCase().includes(needle)) return false;
    if (filters.favoritesOnly && !filters.favorites.has(item.marketHashName)) return false;
    if (filters.minimumPrice !== null && (item.priceMinor === null || item.priceMinor < filters.minimumPrice)) return false;
    if (filters.maximumPrice !== null && (item.priceMinor === null || item.priceMinor > filters.maximumPrice)) return false;
    if (filters.minimumListings !== null && (item.listings === null || item.listings < filters.minimumListings)) return false;
    return true;
  });
  const collator = new Intl.Collator('ja', { sensitivity: 'base' });
  return matches.sort((a, b) => {
    if (sort === 'name') return collator.compare(a.name, b.name);
    if (sort === 'listings-desc' || sort === 'listings-asc') {
      if (a.listings === null) return b.listings === null ? collator.compare(a.name, b.name) : 1;
      if (b.listings === null) return -1;
      return (sort === 'listings-desc' ? b.listings - a.listings : a.listings - b.listings) || collator.compare(a.name, b.name);
    }
    if (a.priceMinor === null) return b.priceMinor === null ? collator.compare(a.name, b.name) : 1;
    if (b.priceMinor === null) return -1;
    return (sort === 'price-desc' ? b.priceMinor - a.priceMinor : a.priceMinor - b.priceMinor) || collator.compare(a.name, b.name);
  });
}

export function parseFavorites(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some(name => typeof name !== 'string' || !name.trim())) return new Set();
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

export function toggleFavorite(favorites: Set<string>, marketHashName: string): Set<string> {
  const next = new Set(favorites);
  if (next.has(marketHashName)) next.delete(marketHashName);
  else next.add(marketHashName);
  return next;
}

export function summarizeMarket(items: MarketItem[]): MarketOverview {
  if (items.some(item => item.listings === null)) return { itemTypes: items.length, totalListings: null };
  return { itemTypes: items.length, totalListings: items.reduce((total, item) => total + (item.listings ?? 0), 0) };
}

export function priceStatistics(points: HistoryPoint[], range: HistoryRange, now = Date.now()): PriceStats | null {
  const selected = filterHistoryPoints(points, range, now);
  if (selected.length === 0) return null;
  const values = selected.map(point => point.priceCents);
  const first = selected[0].priceCents;
  const latest = selected[selected.length - 1].priceCents;
  return {
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    latest,
    change: latest - first,
    changePercent: first === 0 ? null : (latest - first) / first * 100,
    latestListings: selected[selected.length - 1].listings,
  };
}

export function calculateTechnicalIndicators(points: HistoryPoint[]): TechnicalPoint[] {
  return points.map((point, index) => {
    const prices = points.slice(Math.max(0, index - 19), index + 1).map(sample => sample.priceCents);
    if (prices.length < 20) return { sma20: null, upperBand: null, lowerBand: null, rsi14: null };
    const average = prices.reduce((sum, value) => sum + value, 0) / prices.length;
    const variance = prices.reduce((sum, value) => sum + (value - average) ** 2, 0) / prices.length;
    const deviation = Math.sqrt(variance);
    const deltas = points.slice(Math.max(1, index - 13), index + 1).map((sample, offset, samples) => {
      const absoluteIndex = Math.max(1, index - 13) + offset;
      return sample.priceCents - points[absoluteIndex - 1].priceCents;
    });
    const gains = deltas.reduce((sum, change) => sum + Math.max(0, change), 0) / deltas.length;
    const losses = deltas.reduce((sum, change) => sum + Math.max(0, -change), 0) / deltas.length;
    const rsi = losses === 0 ? (gains === 0 ? 50 : 100) : 100 - 100 / (1 + gains / losses);
    return { sma20: average, upperBand: average + 2 * deviation, lowerBand: Math.max(0, average - 2 * deviation), rsi14: rsi };
  });
}

export function makeRankingSnapshot(
  histories: Array<{ marketHashName: string; points: HistoryPoint[] }>,
  generatedAt: string,
  activeMarketHashNames?: string[],
): RankingSnapshot {
  const latestTime = Date.parse(generatedAt);
  if (!Number.isFinite(latestTime)) throw new Error('Invalid ranking timestamp');
  const activeNames = activeMarketHashNames ? new Set(activeMarketHashNames) : null;
  const periods: RankingSnapshot['periods'] = { '24h': { toleranceHours: 6, up: [], down: [] }, '7d': { toleranceHours: 36, up: [], down: [] } };
  for (const period of ['24h', '7d'] as const) {
    const duration = period === '24h' ? 24 * 3600000 : 7 * 24 * 3600000;
    const tolerance = periods[period].toleranceHours * 3600000;
    const candidates: RankingItem[] = [];
    for (const history of histories) {
      if (activeNames && !activeNames.has(history.marketHashName)) continue;
      const valid = history.points.filter(point => Date.parse(point.observedAt) <= latestTime);
      if (valid.length < 2) continue;
      const latest = valid[valid.length - 1];
      // Rankings describe the current USD snapshot. A product with only old
      // observations must not appear current merely because its own history
      // has a nearby baseline relative to that stale endpoint.
      if (latestTime - Date.parse(latest.observedAt) > tolerance) continue;
      const target = latestTime - duration;
      const baseline = valid.slice(0, -1).reduce<HistoryPoint | null>((best, point) => {
        if (Math.abs(Date.parse(point.observedAt) - target) > tolerance) return best;
        return !best || Math.abs(Date.parse(point.observedAt) - target) < Math.abs(Date.parse(best.observedAt) - target) ? point : best;
      }, null);
      if (!baseline || baseline.priceCents === 0) continue;
      const changeCents = latest.priceCents - baseline.priceCents;
      candidates.push({ marketHashName: history.marketHashName, fromCents: baseline.priceCents, toCents: latest.priceCents,
        changeCents, changePercent: changeCents / baseline.priceCents * 100 });
    }
    periods[period].up = candidates.filter(item => item.changeCents > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 20);
    periods[period].down = candidates.filter(item => item.changeCents < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 20);
  }
  return { schemaVersion: 1, appid: 5084200, generatedAt, periods };
}

export function parseRankingSnapshot(value: unknown): RankingSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Partial<RankingSnapshot>;
  if (snapshot.schemaVersion !== 1 || snapshot.appid !== 5084200
      || (snapshot.generatedAt !== null && (typeof snapshot.generatedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.generatedAt))))
      || !snapshot.periods) return null;
  for (const period of ['24h', '7d'] as const) {
    const section = snapshot.periods[period];
    if (!section || section.toleranceHours !== (period === '24h' ? 6 : 36)
        || !Array.isArray(section.up) || !Array.isArray(section.down)) return null;
    for (const entry of [...section.up, ...section.down]) {
      if (!entry || typeof entry.marketHashName !== 'string' || !entry.marketHashName.trim()
          || !Number.isSafeInteger(entry.fromCents) || entry.fromCents <= 0
          || !Number.isSafeInteger(entry.toCents) || entry.toCents < 0
          || !Number.isSafeInteger(entry.changeCents) || entry.changeCents !== entry.toCents - entry.fromCents
          || !Number.isFinite(entry.changePercent) || entry.changePercent !== entry.changeCents / entry.fromCents * 100) return null;
    }
  }
  return snapshot as RankingSnapshot;
}

export function currencyView(usd: MarketSnapshot, currency: 'USD' | 'JPY', rate: number | null): MarketSnapshot {
  if (currency === 'USD') return usd;
  const validRate = rate !== null && Number.isFinite(rate) && rate >= 1 && rate <= 1000;
  const items = usd.items.map(item => {
    if (!validRate || item.priceMinor === null) return { ...item, priceMinor: null, priceText: null };
    const yen = Math.round(item.priceMinor * rate / 100);
    if (!Number.isSafeInteger(yen) || !Number.isSafeInteger(yen * 100)) return { ...item, priceMinor: null, priceText: null };
    return { ...item, priceMinor: yen * 100, priceText: `¥${yen.toLocaleString('ja-JP')}` };
  });
  return { ...usd, currency: 'JPY', priceSource: 'fx', items };
}
