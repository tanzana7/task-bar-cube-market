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

const FX_RATE_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;

export function isFxRateExpired(rateDate: string, now = Date.now()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) return true;
  const publishedAt = Date.parse(`${rateDate}T00:00:00Z`);
  if (!Number.isFinite(publishedAt) || new Date(publishedAt).toISOString().slice(0, 10) !== rateDate) return true;
  return now - publishedAt > FX_RATE_MAX_AGE_MS || publishedAt - now > 24 * 60 * 60 * 1000;
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
