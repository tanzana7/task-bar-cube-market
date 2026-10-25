import type { MarketItem } from './market';

export type ObservationPoint = {
  observedAt: string;
  sourceKind: 'search-render' | 'query-action' | 'steam-dom';
  currency: 'USD';
  requestCurrencyId: number | null;
  responseCurrencyId: number | null;
  priceBasis: string;
  priceMinor: number | null;
  priceText: string | null;
  referencePriceText: string | null;
  listings: number | null;
  provenance: string;
};

export type ObservedProduct = {
  marketHashName: string;
  name: string;
  imageUrl: string | null;
  steamUrl: string;
  observations: ObservationPoint[];
};

export type MarketObservations = {
  schemaVersion: 1;
  appid: 5084200;
  currency: 'USD';
  generatedAt: string;
  products: ObservedProduct[];
  imports: Array<{ sourceKind: 'search-render' | 'query-action' | 'steam-dom'; provenance: string; observedAt: string; rightsConfirmed?: boolean;
    start: number; totalCount: number; pageSize: number; complete: boolean }>;
};

export type MarketDisplaySelection = {
  items: ListedItem[];
  imported: Map<string, ListedItem>;
};

export type ListedItem = MarketItem & {
  observation?: ObservationPoint;
  importedPriceText?: string;
  /** Display-only comparison value. Never copied to priceMinor or price history. */
  comparisonPriceMinor?: number | null;
  comparisonCurrency?: 'USD' | 'JPY';
  comparisonKind?: 'reference';
};

function parseUsdReferenceMinor(text: string | null): number | null {
  if (!text) return null;
  const match = /^\$\s*((?:\d{1,3}(?:,\d{3})+|\d+))\.(\d{2})～?$/.exec(text);
  if (!match) return null;
  const amount = Number(match[1].replaceAll(',', '')) * 100 + Number(match[2]);
  return Number.isSafeInteger(amount) ? amount : null;
}

function formatReferencePrice(minor: number, currency: 'USD' | 'JPY'): string {
  if (currency === 'USD') return `$${Math.floor(minor / 100).toLocaleString('en-US')}.${String(minor % 100).padStart(2, '0')}～`;
  return `¥${Math.round(minor / 100).toLocaleString('ja-JP')} · 為替換算参考`;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validUsdText(text: unknown, minor: unknown): boolean {
  if (typeof text !== 'string' || !Number.isSafeInteger(minor) || (minor as number) < 0) return false;
  const match = /^\$(0|[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)\.(\d{2})$/.exec(text);
  if (!match) return false;
  return Number(match[1].replaceAll(',', '')) * 100 + Number(match[2]) === minor;
}

function validSteamImage(value: unknown): value is string | null {
  return value === null || (typeof value === 'string'
    && /^https:\/\/(?:community\.steamstatic\.com|community\.cloudflare\.steamstatic\.com)\/economy\/image\/[A-Za-z0-9_/?=&%-]+$/.test(value));
}

function validUsdReferenceText(text: unknown): text is string {
  return typeof text === 'string' && /^\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}～?$/.test(text);
}

export function parseMarketObservations(value: unknown): MarketObservations | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<MarketObservations>;
  if (data.schemaVersion !== 1 || data.appid !== 5084200 || data.currency !== 'USD'
      || !isIsoTimestamp(data.generatedAt) || !Array.isArray(data.products) || !Array.isArray(data.imports)) return null;
  const productKeys = new Set<string>();
  for (const product of data.products) {
    if (!product || typeof product.marketHashName !== 'string' || !product.marketHashName.trim()
        || productKeys.has(product.marketHashName) || typeof product.name !== 'string' || !product.name.trim()
        || !validSteamImage(product.imageUrl)
        || product.steamUrl !== `https://steamcommunity.com/market/listings/5084200/${encodeURIComponent(product.marketHashName)}`
        || !Array.isArray(product.observations) || product.observations.length === 0) return null;
    productKeys.add(product.marketHashName);
    let previous = -Infinity;
    for (const point of product.observations) {
      if (!point || typeof point !== 'object') return null;
      const observedMs = Date.parse(point?.observedAt);
      const reference = point?.sourceKind === 'query-action' || point?.sourceKind === 'steam-dom';
      const validPrice = point?.sourceKind === 'query-action'
        ? point.priceBasis === 'min-sell-subtotal-unverified-fees' && point.priceMinor === null
          && point.priceText === null && typeof point.referencePriceText === 'string'
          && validUsdText(point.referencePriceText, Number(point.referencePriceText.replace(/[^\d.]/g, '').replace('.', '')))
        : point?.sourceKind === 'steam-dom'
          ? point.priceBasis === 'steam-market-rendered-ui-unverified-price' && point.priceMinor === null
            && point.priceText === null && validUsdReferenceText(point.referencePriceText)
          : point.priceBasis === 'steam-search-render-sell-price'
          && ((point.priceMinor === null && point.priceText === null)
            || (point.priceMinor !== null && validUsdText(point.priceText, point.priceMinor)))
          && point.referencePriceText === null;
      if (!isIsoTimestamp(point?.observedAt) || observedMs <= previous
          || !['query-action', 'search-render', 'steam-dom'].includes(point.sourceKind) || point.currency !== 'USD'
          || (reference && (!(point.requestCurrencyId === null || point.requestCurrencyId === 1)
            || (point.sourceKind === 'query-action' ? point.responseCurrencyId !== 1
              : point.requestCurrencyId !== null || point.responseCurrencyId !== null)))
          || (!reference && (!(point.requestCurrencyId === null || point.requestCurrencyId === 1)
            || point.responseCurrencyId !== null))
          || !validPrice || typeof point.provenance !== 'string' || !point.provenance.trim() || point.provenance.length > 240
          || (point.listings !== null && (!Number.isSafeInteger(point.listings) || point.listings < 0))) return null;
      previous = observedMs;
    }
  }
  let previousImport = -Infinity;
  for (const capture of data.imports) {
    const captureMs = Date.parse(capture?.observedAt);
    if (!capture || !['query-action', 'search-render', 'steam-dom'].includes(capture.sourceKind)
        || !isIsoTimestamp(capture.observedAt) || typeof capture.provenance !== 'string' || !capture.provenance.trim()
        || (capture.rightsConfirmed !== undefined && typeof capture.rightsConfirmed !== 'boolean')
        || !Number.isSafeInteger(capture.start) || capture.start < 0 || !Number.isSafeInteger(capture.totalCount)
        || capture.totalCount < capture.start || !Number.isSafeInteger(capture.pageSize) || capture.pageSize < 0
        || capture.pageSize > capture.totalCount - capture.start
        || (capture.complete && !(capture.start === 0 && capture.pageSize === capture.totalCount))
        || captureMs < previousImport) return null;
    previousImport = captureMs;
  }
  return data as MarketObservations;
}

export function latestObservedItems(data: MarketObservations | null): ListedItem[] {
  if (!data) return [];
  return data.products.map(product => {
    const observation = product.observations.at(-1)!;
    const referenceMinor = observation.sourceKind === 'steam-dom' || observation.sourceKind === 'query-action'
      ? parseUsdReferenceMinor(observation.referencePriceText) : null;
    return {
      name: product.name,
      marketHashName: product.marketHashName,
      imageUrl: product.imageUrl,
      priceMinor: observation.sourceKind === 'search-render' ? observation.priceMinor : null,
      priceText: observation.sourceKind === 'search-render' ? observation.priceText : null,
      listings: observation.listings,
      steamUrl: product.steamUrl,
      observation,
      ...(referenceMinor === null ? {} : {
        comparisonPriceMinor: referenceMinor,
        comparisonCurrency: 'USD' as const,
        comparisonKind: 'reference' as const,
      }),
      importedPriceText: observation.sourceKind === 'query-action'
        ? `${observation.referencePriceText} USD · 参考値`
        : observation.sourceKind === 'steam-dom'
          ? `${observation.referencePriceText} USD`
        : observation.priceText ? `${observation.priceText} USD · 取込値` : '価格情報なし',
    };
  });
}

export function selectMarketDisplayItems(
  canonicalItems: MarketItem[],
  canonicalObservedAt: string | null,
  importedItems: ListedItem[],
  currency: 'USD' | 'JPY',
  usdJpyRate: number | null = null,
): MarketDisplaySelection {
  const canonicalTime = canonicalObservedAt ? Date.parse(canonicalObservedAt) : NaN;
  const importedByKey = new Map(importedItems.map(item => [item.marketHashName, item]));
  const selectedImports = new Map<string, ListedItem>();
  const items: ListedItem[] = canonicalItems.map(item => {
    const imported = importedByKey.get(item.marketHashName);
    const importedTime = imported?.observation ? Date.parse(imported.observation.observedAt) : NaN;
    if (!imported || !Number.isFinite(canonicalTime) || !Number.isFinite(importedTime) || importedTime <= canonicalTime) return item;
    const selected = {
      ...imported,
      // USD imports are retained as raw USD values. JPY mode never compares USD minor units
      // against yen, and rendered UI/queryAction reference observations remain non-numeric in either view.
      priceMinor: currency === 'USD' && imported.observation?.sourceKind === 'search-render' ? imported.priceMinor : null,
      priceText: currency === 'USD' && imported.observation?.sourceKind === 'search-render' ? imported.priceText : null,
    };
    applyReferenceComparison(selected, currency, usdJpyRate);
    selectedImports.set(item.marketHashName, selected);
    return selected;
  });
  const canonicalKeys = new Set(canonicalItems.map(item => item.marketHashName));
  for (const item of importedItems) {
    if (canonicalKeys.has(item.marketHashName)) continue;
    const selected = {
      ...item,
      priceMinor: currency === 'USD' && item.observation?.sourceKind === 'search-render' ? item.priceMinor : null,
      priceText: currency === 'USD' && item.observation?.sourceKind === 'search-render' ? item.priceText : null,
    };
    applyReferenceComparison(selected, currency, usdJpyRate);
    items.push(selected);
    selectedImports.set(item.marketHashName, selected);
  }
  return { items, imported: selectedImports };
}

function applyReferenceComparison(item: ListedItem, currency: 'USD' | 'JPY', rate: number | null): void {
  const observation = item.observation;
  const usdMinor = observation && (observation.sourceKind === 'steam-dom' || observation.sourceKind === 'query-action')
    ? parseUsdReferenceMinor(observation.referencePriceText) : null;
  if (usdMinor === null) return;
  if (currency === 'USD') {
    item.comparisonPriceMinor = usdMinor;
    item.comparisonCurrency = 'USD';
    item.importedPriceText = `${formatReferencePrice(usdMinor, 'USD')} USD`;
    return;
  }
  // Reference quotes can only join JPY comparisons when a currently valid rate exists.
  // The converted value remains a display aid and never becomes a canonical Steam price.
  if (rate === null || !Number.isFinite(rate) || rate < 1 || rate > 1000) {
    item.comparisonPriceMinor = null;
    item.comparisonCurrency = 'USD';
    item.importedPriceText = `${formatReferencePrice(usdMinor, 'USD')} USD · 円換算なし`;
    return;
  }
  const yen = Math.round(usdMinor * rate / 100);
  if (!Number.isSafeInteger(yen) || !Number.isSafeInteger(yen * 100)) {
    item.comparisonPriceMinor = null;
    item.comparisonCurrency = 'USD';
    item.importedPriceText = `${formatReferencePrice(usdMinor, 'USD')} USD · 円換算なし`;
    return;
  }
  item.comparisonPriceMinor = yen * 100;
  item.comparisonCurrency = 'JPY';
  item.importedPriceText = formatReferencePrice(yen * 100, 'JPY');
}
