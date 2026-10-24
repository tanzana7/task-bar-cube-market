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
