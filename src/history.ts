import { isFxRateExpired, type FxRateRecord } from './market.ts';

export type HistoryPoint = { observedAt: string; priceCents: number; listings: number };
export type ProductHistory = { schemaVersion: 1; appid: 5084200; currency: 'USD'; marketHashName: string; points: HistoryPoint[] };
export type HistoryIndex = { schemaVersion: 1; appid: 5084200; products: Array<{ id: string; marketHashName: string }> };
export type HistoryRange = '7d' | '30d' | 'all';
export type HistoryCurrency = 'USD' | 'JPY';
export type ChartPoint = HistoryPoint & { value: number; label: string };

const HISTORY_ID_PATTERN = /^[a-f0-9]{64}$/;

export function parseHistoryIndex(value: unknown): HistoryIndex | null {
  if (!value || typeof value !== 'object') return null;
  const index = value as Partial<HistoryIndex>;
  if (index.schemaVersion !== 1 || index.appid !== 5084200 || !Array.isArray(index.products)) return null;
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const product of index.products) {
    if (!product || typeof product.id !== 'string' || !HISTORY_ID_PATTERN.test(product.id)
        || typeof product.marketHashName !== 'string' || !product.marketHashName.trim()
        || ids.has(product.id) || hashes.has(product.marketHashName)) return null;
    ids.add(product.id);
    hashes.add(product.marketHashName);
  }
  return index as HistoryIndex;
}

export function parseProductHistory(value: unknown, marketHashName: string): ProductHistory | null {
  if (!value || typeof value !== 'object') return null;
  const history = value as Partial<ProductHistory>;
  if (history.schemaVersion !== 1 || history.appid !== 5084200 || history.currency !== 'USD' || history.marketHashName !== marketHashName
      || !Array.isArray(history.points)) return null;
  let previous = -Infinity;
  for (const point of history.points) {
    const time = Date.parse(point?.observedAt ?? '');
    if (!point || !Number.isFinite(time) || new Date(time).toISOString() !== point.observedAt
        || time <= previous || !Number.isSafeInteger(point.priceCents) || point.priceCents < 0
        || !Number.isSafeInteger(point.listings) || point.listings < 0) return null;
    previous = time;
  }
  return history as ProductHistory;
}

export function filterHistoryPoints<T extends HistoryPoint>(points: T[], range: HistoryRange, now = Date.now()): T[] {
  if (range === 'all') return [...points];
  const duration = range === '7d' ? 7 : 30;
  const since = now - duration * 24 * 60 * 60 * 1000;
  return points.filter(point => Date.parse(point.observedAt) >= since && Date.parse(point.observedAt) <= now);
}

export function makeChartPoints(
  points: HistoryPoint[],
  currency: HistoryCurrency,
  rate: FxRateRecord | null,
  now = Date.now(),
): ChartPoint[] | null {
  if (currency === 'JPY' && (!rate || isFxRateExpired(rate.rateDate, now))) return null;
  return points.map(point => {
    const value = currency === 'USD' ? point.priceCents / 100 : Math.round(point.priceCents * rate!.rate / 100);
    return { ...point, value, label: currency === 'USD' ? `$${value.toFixed(2)}` : `¥${value.toLocaleString('ja-JP')}` };
  });
}

export function formatHistoryPrice(value: number, currency: HistoryCurrency): string {
  return currency === 'USD'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
    : `¥${Math.round(value).toLocaleString('ja-JP')}`;
}
