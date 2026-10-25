import type { MarketItem } from './market';

export type ObservationPoint = {
  observedAt: string;
  sourceKind: 'search-render' | 'query-action';
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
  imports: Array<{ sourceKind: 'search-render' | 'query-action'; provenance: string; observedAt: string;
    start: number; totalCount: number; pageSize: number; complete: boolean }>;
};

export type ListedItem = MarketItem & {
  observation?: ObservationPoint;
  importedPriceText?: string;
};

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
    && /^https:\/\/community\.cloudflare\.steamstatic\.com\/economy\/image\/[A-Za-z0-9_/?=&%-]+$/.test(value));
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
      const reference = point?.sourceKind === 'query-action';
      const validPrice = reference
        ? point.priceBasis === 'min-sell-subtotal-unverified-fees' && point.priceMinor === null
          && point.priceText === null && typeof point.referencePriceText === 'string'
          && validUsdText(point.referencePriceText, Number(point.referencePriceText.replace(/[^\d.]/g, '').replace('.', '')))
        : point.priceBasis === 'steam-search-render-sell-price'
          && ((point.priceMinor === null && point.priceText === null)
            || (point.priceMinor !== null && validUsdText(point.priceText, point.priceMinor)))
          && point.referencePriceText === null;
      if (!isIsoTimestamp(point?.observedAt) || observedMs <= previous
          || !['query-action', 'search-render'].includes(point.sourceKind) || point.currency !== 'USD'
          || (reference && (point.requestCurrencyId !== null || point.responseCurrencyId !== 1))
          || (!reference && (point.requestCurrencyId !== null || point.responseCurrencyId !== null))
          || !validPrice || typeof point.provenance !== 'string' || !point.provenance.trim() || point.provenance.length > 240
          || (point.listings !== null && (!Number.isSafeInteger(point.listings) || point.listings < 0))) return null;
      previous = observedMs;
    }
  }
  let previousImport = -Infinity;
  for (const capture of data.imports) {
    const captureMs = Date.parse(capture?.observedAt);
    if (!capture || !['query-action', 'search-render'].includes(capture.sourceKind)
        || !isIsoTimestamp(capture.observedAt) || typeof capture.provenance !== 'string' || !capture.provenance.trim()
        || !Number.isSafeInteger(capture.start) || capture.start < 0 || !Number.isSafeInteger(capture.totalCount)
        || capture.totalCount < capture.start || !Number.isSafeInteger(capture.pageSize) || capture.pageSize < 0
        || capture.pageSize > capture.totalCount - capture.start
        || capture.complete !== (capture.start === 0 && capture.pageSize === capture.totalCount)
        || captureMs < previousImport) return null;
    previousImport = captureMs;
  }
  return data as MarketObservations;
}

export function latestObservedItems(data: MarketObservations | null): ListedItem[] {
  if (!data) return [];
  return data.products.map(product => {
    const observation = product.observations.at(-1)!;
    return {
      name: product.name,
      marketHashName: product.marketHashName,
      imageUrl: product.imageUrl,
      priceMinor: observation.sourceKind === 'search-render' ? observation.priceMinor : null,
      priceText: observation.sourceKind === 'search-render' ? observation.priceText : null,
      listings: observation.listings,
      steamUrl: product.steamUrl,
      observation,
      importedPriceText: observation.sourceKind === 'query-action'
        ? `${observation.referencePriceText} USD · 参考値`
        : observation.priceText ? `${observation.priceText} USD · 取込値` : '価格情報なし',
    };
  });
}
