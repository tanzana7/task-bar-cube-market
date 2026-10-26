import type { MarketItem, MarketSnapshot } from './market';
import { filterHistoryPoints, type HistoryPoint, type HistoryRange } from './history.ts';
import { gradeAtLeast, type ItemGrade, type ItemType, classifyItemName } from './item-classification.ts';

export type MarketFilters = {
  query: string;
  currency?: 'USD' | 'JPY';
  minimumPrice: number | null;
  maximumPrice: number | null;
  minimumListings: number | null;
  favoritesOnly: boolean;
  favorites: Set<string>;
  grades?: Set<ItemGrade>;
  minimumGrade?: ItemGrade | null;
  types?: Set<ItemType>;
  minimumQuality?: number | null;
  maximumQuality?: number | null;
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

export type PriceFilterParse = { value: number | null; error: string | null };

export const OBSERVATION_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isObservationStale(observedAt: string, now = Date.now()): boolean {
  const timestamp = Date.parse(observedAt);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp > OBSERVATION_STALE_AFTER_MS;
}

export function parsePriceFilterInput(input: string, currency: 'USD' | 'JPY'): PriceFilterParse {
  const value = input.trim();
  if (!value) return { value: null, error: null };
  const match = currency === 'USD'
    ? /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value)
    : /^(0|[1-9]\d*)$/.exec(value);
  if (!match) {
    return { value: null, error: currency === 'USD' ? '価格は0以上、小数第2位まで入力してください。' : 'JPY価格は0以上の整数で入力してください。' };
  }
  const major = Number(match[1]);
  const fraction = currency === 'USD' ? Number((match[2] ?? '').padEnd(2, '0') || '0') : 0;
  const minor = major * 100 + fraction;
  if (!Number.isSafeInteger(minor)) return { value: null, error: '価格が大きすぎます。' };
  return { value: minor, error: null };
}

export function filterMarketItems(items: MarketItem[], filters: MarketFilters, sort: MarketSort): MarketItem[] {
  const needle = filters.query.trim().toLocaleLowerCase();
  const matches = items.filter(item => {
    if (needle && !item.name.toLocaleLowerCase().includes(needle)) return false;
    if (filters.favoritesOnly && !filters.favorites.has(item.marketHashName)) return false;
    const classification = classifyItemName(item.marketHashName);
    if (filters.grades?.size && (classification.grade === null || !filters.grades.has(classification.grade))) return false;
    if (filters.minimumGrade && !gradeAtLeast(classification.grade, filters.minimumGrade)) return false;
    if (filters.types?.size && (classification.type === null || !filters.types.has(classification.type))) return false;
    if (filters.minimumQuality !== null && filters.minimumQuality !== undefined
        && (classification.quality === null || classification.quality < filters.minimumQuality)) return false;
    if (filters.maximumQuality !== null && filters.maximumQuality !== undefined
        && (classification.quality === null || classification.quality > filters.maximumQuality)) return false;
    const comparison = comparablePrice(item, filters.currency ?? 'USD');
    if (filters.minimumPrice !== null && (comparison === null || comparison < filters.minimumPrice)) return false;
    if (filters.maximumPrice !== null && (comparison === null || comparison > filters.maximumPrice)) return false;
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
    const aPrice = comparablePrice(a, filters.currency ?? 'USD');
    const bPrice = comparablePrice(b, filters.currency ?? 'USD');
    if (aPrice === null) return bPrice === null ? collator.compare(a.name, b.name) : 1;
    if (bPrice === null) return -1;
    return (sort === 'price-desc' ? bPrice - aPrice : aPrice - bPrice) || collator.compare(a.name, b.name);
  });
}

export type RecommendationPriority = 'price' | 'quality' | 'balanced';
export type RecommendationOptions = {
  type: ItemType;
  minimumGrade: ItemGrade | null;
  minimumQuality: number | null;
  budgetMinor: number | null;
  currency: 'USD' | 'JPY';
  priority: RecommendationPriority;
};
export type RecommendedItem = { item: MarketItem; score: number | null; reason: string; criteria: string | null };

/**
 * Recommendations are a transparent ordering aid, not a gameplay power estimate.
 * Balance mode only compares the selected equipment type and only scores observed attributes.
 */
export function recommendEquipment(items: MarketItem[], options: RecommendationOptions): RecommendedItem[] {
  const candidates = items.filter(item => {
    const classification = classifyItemName(item.marketHashName);
    if (classification.type !== options.type) return false;
    if (options.minimumGrade && !gradeAtLeast(classification.grade, options.minimumGrade)) return false;
    if (options.minimumQuality !== null && (classification.quality === null || classification.quality < options.minimumQuality)) return false;
    const price = comparablePrice(item, options.currency);
    if (options.budgetMinor !== null && (price === null || price > options.budgetMinor)) return false;
    return true;
  });
  const priceOf = (item: MarketItem) => comparablePrice(item, options.currency);
  const priceSorted = [...candidates].sort((a, b) => {
    const pa = priceOf(a); const pb = priceOf(b);
    if (pa === null) return pb === null ? a.name.localeCompare(b.name) : 1;
    if (pb === null) return -1;
    return pa - pb || a.name.localeCompare(b.name);
  });
  const qualitySorted = [...candidates].sort((a, b) => {
    const qa = classifyItemName(a.marketHashName).quality; const qb = classifyItemName(b.marketHashName).quality;
    if (qa === null) return qb === null ? (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity) : 1;
    if (qb === null) return -1;
    return qb - qa || (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity);
  });
  const knownPrices = candidates.map(priceOf).filter((value): value is number => value !== null);
  const minKnownPrice = knownPrices.reduce((minimum, value) => Math.min(minimum, value), Infinity);
  const maxKnownPrice = knownPrices.reduce((maximum, value) => Math.max(maximum, value), -Infinity);
  const balancedScore = (item: MarketItem): { score: number; criteria: string } | null => {
    const classification = classifyItemName(item.marketHashName);
    const dimensions: Array<{ name: string; weight: number; value: number }> = [];
    const gradeIndex = classification.grade ? ITEM_GRADE_INDEX(classification.grade) : null;
    if (gradeIndex !== null) dimensions.push({ name: 'Grade', weight: 45, value: gradeIndex / 6 * 100 });
    if (classification.quality !== null) dimensions.push({ name: 'Quality', weight: 35, value: classification.quality / 95 * 100 });
    const currentPrice = priceOf(item);
    if (currentPrice !== null && knownPrices.length > 1) {
      dimensions.push({ name: '価格', weight: 20, value: (maxKnownPrice === minKnownPrice ? 1 : 1 - (currentPrice - minKnownPrice) / (maxKnownPrice - minKnownPrice)) * 100 });
    } else if (currentPrice !== null) dimensions.push({ name: '価格', weight: 20, value: 100 });
    if (!dimensions.length) return null;
    const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
    const score = dimensions.reduce((sum, dimension) => sum + dimension.value * dimension.weight, 0) / totalWeight;
    const criteria = dimensions.map(dimension => `${dimension.name} ${((dimension.weight / totalWeight) * 100).toFixed(1)}%`).join(' · ');
    return { score, criteria };
  };
  const ordered = options.priority === 'price' ? priceSorted
    : options.priority === 'quality' ? qualitySorted
      : [...candidates].sort((a, b) => (balancedScore(b)?.score ?? -1) - (balancedScore(a)?.score ?? -1)
        || (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity) || a.name.localeCompare(b.name));
  return ordered.map((item, index) => {
    const classification = classifyItemName(item.marketHashName);
    const price = priceOf(item);
    const balanced = options.priority === 'balanced' ? balancedScore(item) : null;
    const reason = options.priority === 'price'
      ? price === null ? '価格未取得' : index === 0 ? '条件内で参考価格が最安' : '参考価格の安い順'
      : options.priority === 'quality'
        ? classification.quality === null ? 'Quality未取得' : index === 0 ? `Quality ${classification.quality}%で最高` : `${classification.quality}% · 同Qualityは価格順`
        : balanced === null ? '比較できる価格・属性がありません' : '利用できる項目だけで比較';
    return { item, score: balanced?.score ?? null, reason,
      criteria: options.priority === 'balanced' ? balanced?.criteria ?? null : null };
  });
}

function ITEM_GRADE_INDEX(value: ItemGrade): number {
  const order: ItemGrade[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Divine'];
  return order.indexOf(value);
}

function comparablePrice(item: MarketItem, currency: 'USD' | 'JPY'): number | null {
  const value = item as MarketItem & { comparisonPriceMinor?: number | null; comparisonCurrency?: 'USD' | 'JPY' };
  if (value.comparisonPriceMinor !== undefined) {
    return value.comparisonCurrency === currency ? value.comparisonPriceMinor : null;
  }
  return item.priceMinor;
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
