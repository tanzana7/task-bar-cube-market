export type MarketItem = {
  name: string;
  marketHashName: string;
  imageUrl: string | null;
  priceMinor: number | null;
  priceText: string | null;
  listings: number | null;
  steamUrl: string;
};

export type SortMode = 'price-asc' | 'price-desc' | 'name';
export type FxRateRecord = {
  schemaVersion: 1;
  source: 'Frankfurter';
  apiUrl: 'https://api.frankfurter.dev/v2/rate/USD/JPY';
  base: 'USD';
  quote: 'JPY';
  rate: number;
  rateDate: string;
  fetchedAt: string;
};
export type MarketSnapshot = {
  schemaVersion: 2;
  appid: 5084200;
  status: 'ok' | 'unavailable';
  fetchedAt: string | null;
  currency: 'JPY' | 'USD';
  priceSource?: 'steam' | 'fx';
  fxRate?: { source: 'Frankfurter'; sourceUrl: string; base: 'USD'; quote: 'JPY'; rate: number; rateDate: string; fetchedAt: string };
  items: MarketItem[];
};

const FX_RATE_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;

export function parseFreshFxRate(value: unknown, now = Date.now()): FxRateRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<FxRateRecord>;
  if (record.schemaVersion !== 1 || record.source !== 'Frankfurter'
      || record.apiUrl !== 'https://api.frankfurter.dev/v2/rate/USD/JPY'
      || record.base !== 'USD' || record.quote !== 'JPY'
      || typeof record.rate !== 'number' || !Number.isFinite(record.rate) || record.rate < 1 || record.rate > 1000
      || typeof record.rateDate !== 'string' || isFxRateExpired(record.rateDate, now)
      || typeof record.fetchedAt !== 'string' || !Number.isFinite(Date.parse(record.fetchedAt))
      || Date.parse(record.fetchedAt) - now > 60_000) return null;
  return record as FxRateRecord;
}

export function deriveJpyReferenceSnapshot(
  jpy: MarketSnapshot,
  usd: MarketSnapshot,
  rate: FxRateRecord,
): MarketSnapshot | null {
  if (jpy.currency !== 'JPY' || jpy.priceSource !== 'fx' || usd.currency !== 'USD'
      || jpy.status !== usd.status || jpy.fetchedAt !== usd.fetchedAt || jpy.items.length !== usd.items.length
      || jpy.items.some((item, index) => {
        const source = usd.items[index];
        return item.marketHashName !== source.marketHashName || item.name !== source.name
          || item.imageUrl !== source.imageUrl || item.listings !== source.listings || item.steamUrl !== source.steamUrl;
      })) return null;
  const items = usd.items.map(item => {
    if (item.priceMinor === null) return { ...item, priceMinor: null, priceText: null };
    const yen = Math.round(item.priceMinor * rate.rate / 100);
    if (!Number.isSafeInteger(yen) || !Number.isSafeInteger(yen * 100)) return null;
    return { ...item, priceMinor: yen * 100, priceText: `¥${yen.toLocaleString('en-US')}` };
  });
  if (items.some(item => item === null)) return null;
  return { ...jpy, items: items as MarketItem[], fxRate: {
    source: 'Frankfurter', sourceUrl: rate.apiUrl, base: 'USD', quote: 'JPY',
    rate: rate.rate, rateDate: rate.rateDate, fetchedAt: rate.fetchedAt,
  } };
}

export function formatFxRateLabel(rate: FxRateRecord | null): string | null {
  if (!rate) return null;
  const formatted = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rate.rate);
  return `参考為替：1 USD ≒ ${formatted} JPY（${rate.rateDate}）`;
}

export function isFxRateExpired(rateDate: string, now = Date.now()): boolean {
  if (!Number.isFinite(now)) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) return true;
  const publishedAt = Date.parse(`${rateDate}T00:00:00Z`);
  if (!Number.isFinite(publishedAt) || new Date(publishedAt).toISOString().slice(0, 10) !== rateDate) return true;
  const today = new Date(now).toISOString().slice(0, 10);
  return rateDate > today || now - publishedAt > FX_RATE_MAX_AGE_MS;
}

export function displayItemsWithoutExpiredFx(items: MarketItem[], expired: boolean): MarketItem[] {
  if (!expired) return items;
  // Preserve identity, images, listing counts, and Steam links while removing stale sortable prices.
  return items.map(item => ({ ...item, priceMinor: null, priceText: null }));
}

export function prepareMarketPriceView(
  items: MarketItem[],
  currency: 'JPY' | 'USD',
  priceSource: 'steam' | 'fx' | undefined,
  rateDate: string | undefined,
  now = Date.now(),
): { items: MarketItem[]; expiredFx: boolean } {
  const expiredFx = currency === 'JPY' && priceSource === 'fx'
    && (!rateDate || isFxRateExpired(rateDate, now));
  return { items: displayItemsWithoutExpiredFx(items, expiredFx), expiredFx };
}

function currencyKey(item: MarketItem): string | null {
  return item.priceText?.replace(/[\d\s.,\u00a0-]/g, '') || null;
}

export function filterAndSort(items: MarketItem[], query: string, mode: SortMode): MarketItem[] {
  const needle = query.trim().toLocaleLowerCase();
  const collator = new Intl.Collator('ja', { sensitivity: 'base' });
  return items.filter(item => item.name.toLocaleLowerCase().includes(needle)).sort((a, b) => {
    if (mode === 'name') return collator.compare(a.name, b.name);
    // Missing prices sort last; comparisons across distinct currency symbols are undefined.
    if (a.priceMinor === null) return b.priceMinor === null ? collator.compare(a.name, b.name) : 1;
    if (b.priceMinor === null) return -1;
    if (currencyKey(a) !== currencyKey(b)) return collator.compare(a.name, b.name);
    return (mode === 'price-desc' ? b.priceMinor - a.priceMinor : a.priceMinor - b.priceMinor)
      || collator.compare(a.name, b.name);
  });
}
