import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePriceMinor, normalizeResult, saveFilesAtomically } from './steam-market.mjs';
import { parseQueryActionPage } from './query-action-market.mjs';

export const TBC_APPID = 5084200;
export const PUBLIC_OBSERVATIONS_PATH = new URL('../public/market-observations.json', import.meta.url);
const SOURCE_LABELS = {
  'search-render': 'Steam Community Market search/render response supplied by operator',
  'query-action': 'Steam Community Market queryAction response supplied by operator',
};

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function safeProvenance(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 240
    && !/[\r\n\0]/.test(value);
}

function parseSearchRender(payload, observedAt) {
  if (!payload || payload.success !== true || !Array.isArray(payload.results)
      || !Number.isSafeInteger(payload.total_count) || payload.total_count < 0) {
    throw new Error('Invalid search/render response envelope');
  }
  const start = payload.start === undefined ? 0 : payload.start;
  if (!Number.isSafeInteger(start) || start < 0 || start > payload.total_count
      || payload.results.length > payload.total_count - start
      || (payload.pagesize !== undefined && (!Number.isSafeInteger(payload.pagesize) || payload.pagesize < payload.results.length))) {
    throw new Error('Invalid search/render page metadata');
  }
  const seen = new Set();
  const products = payload.results.map(row => {
    if (row?.asset_description?.appid !== TBC_APPID) throw new Error('Import contains a non-TBC AppID');
    const item = normalizeResult(row, 'USD', TBC_APPID);
    if (seen.has(item.marketHashName)) throw new Error('Import contains duplicate market_hash_name values');
    seen.add(item.marketHashName);
    if (item.priceMinor !== null && parsePriceMinor(item.priceText, 'USD') !== item.priceMinor) {
      throw new Error('Imported USD price does not match its displayed text');
    }
    return {
      marketHashName: item.marketHashName,
      name: item.name,
      imageUrl: item.imageUrl,
      steamUrl: item.steamUrl,
      observations: [{
        observedAt,
        sourceKind: 'search-render',
        currency: 'USD',
        requestCurrencyId: null,
        responseCurrencyId: null,
        priceBasis: 'steam-search-render-sell-price',
        priceMinor: item.priceMinor,
        priceText: item.priceText,
        referencePriceText: null,
        listings: item.listings,
      }],
    };
  });
  return { start, totalCount: payload.total_count, pageSize: products.length, products,
    complete: start === 0 && products.length === payload.total_count };
}

function parseQueryAction(payload, observedAt) {
  const start = payload?.data?.start;
  const page = parseQueryActionPage(payload, { expectedStart: start, expectedAppId: TBC_APPID, requestCurrencyId: null });
  return {
    start: page.start, totalCount: page.totalCount, pageSize: page.pageSize, complete: page.start === 0 && page.pageSize === page.totalCount,
    products: page.items.map(item => ({
      marketHashName: item.marketHashName,
      name: item.name,
      imageUrl: item.imageUrl,
      steamUrl: item.steamUrl,
      observations: [{
        observedAt,
        sourceKind: 'query-action',
        currency: 'USD',
        requestCurrencyId: null,
        responseCurrencyId: page.responseCurrencyId,
        priceBasis: item.priceBasis,
        priceMinor: null,
        priceText: null,
        referencePriceText: item.minSellSubtotalText,
        listings: item.listings,
      }],
    })),
  };
}

export function validateMarketObservations(value) {
  if (!value || value.schemaVersion !== 1 || value.appid !== TBC_APPID || value.currency !== 'USD'
      || !validTimestamp(value.generatedAt) || !Array.isArray(value.products) || !Array.isArray(value.imports)) {
    throw new Error('Invalid public market observations envelope');
  }
  const keys = new Set();
  for (const product of value.products) {
    if (!product || typeof product.marketHashName !== 'string' || !product.marketHashName.trim()
        || keys.has(product.marketHashName) || typeof product.name !== 'string' || !product.name.trim()
        || (product.imageUrl !== null && (!/^https:\/\/community\.cloudflare\.steamstatic\.com\/economy\/image\/[A-Za-z0-9_/?=&%-]+$/.test(product.imageUrl)))
        || product.steamUrl !== `https://steamcommunity.com/market/listings/${TBC_APPID}/${encodeURIComponent(product.marketHashName)}`
        || !Array.isArray(product.observations) || product.observations.length === 0) {
      throw new Error('Invalid or duplicate public product observation');
    }
    keys.add(product.marketHashName);
    let previous = -Infinity;
    for (const point of product.observations) {
      if (!point || typeof point !== 'object') throw new Error('Invalid public observation point');
      const time = Date.parse(point?.observedAt);
      const queryAction = point?.sourceKind === 'query-action';
      if (!validTimestamp(point?.observedAt) || time <= previous || !['query-action', 'search-render'].includes(point.sourceKind)
          || point.currency !== 'USD' || !safeProvenance(point.provenance)
          || (queryAction && (point.requestCurrencyId !== null || point.responseCurrencyId !== 1
            || point.priceBasis !== 'min-sell-subtotal-unverified-fees' || point.priceMinor !== null
            || point.priceText !== null || parsePriceMinor(point.referencePriceText, 'USD') === null))
          || (!queryAction && (point.requestCurrencyId !== null || point.responseCurrencyId !== null
            || point.priceBasis !== 'steam-search-render-sell-price'
            || (point.priceMinor === null) !== (point.priceText === null)
            || (point.priceMinor !== null && parsePriceMinor(point.priceText, 'USD') !== point.priceMinor)
            || point.referencePriceText !== null))
          || (point.listings !== null && (!Number.isSafeInteger(point.listings) || point.listings < 0))) {
        throw new Error('Invalid public observation point');
      }
      previous = time;
    }
  }
  for (const capture of value.imports) {
    if (!capture || !['query-action', 'search-render'].includes(capture.sourceKind) || !safeProvenance(capture.provenance)
        || !validTimestamp(capture.observedAt) || !Number.isSafeInteger(capture.start) || capture.start < 0
        || !Number.isSafeInteger(capture.totalCount) || capture.totalCount < capture.start
        || !Number.isSafeInteger(capture.pageSize) || capture.pageSize < 0
        || capture.pageSize > capture.totalCount - capture.start
        || capture.complete !== (capture.start === 0 && capture.pageSize === capture.totalCount)) {
      throw new Error('Invalid market import metadata');
    }
  }
  return value;
}

export function parseMarketImport({ payload, format, observedAt, provenance, now = new Date() }) {
  if (!validTimestamp(observedAt)) throw new Error('observed-at must be a valid UTC ISO timestamp');
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf()) || Date.parse(observedAt) > now.valueOf() + 5 * 60_000) {
    throw new Error('observed-at cannot be in the future');
  }
  if (!safeProvenance(provenance)) throw new Error('provenance must be 1-240 characters without line breaks');
  if (!Object.hasOwn(SOURCE_LABELS, format)) throw new Error('format must be search-render or query-action');
  const capture = format === 'search-render' ? parseSearchRender(payload, observedAt) : parseQueryAction(payload, observedAt);
  const products = capture.products.map(product => ({
    ...product,
    observations: product.observations.map(point => ({ ...point, provenance })),
  }));
  const snapshot = {
    schemaVersion: 1,
    appid: TBC_APPID,
    currency: 'USD',
    generatedAt: now.toISOString(),
    products,
    imports: [{ sourceKind: format, sourceLabel: SOURCE_LABELS[format], provenance, observedAt,
      start: capture.start, totalCount: capture.totalCount, pageSize: capture.pageSize, complete: capture.complete }],
  };
  return validateMarketObservations(snapshot);
}

export function mergeMarketObservations(previous, incoming) {
  const base = previous ? validateMarketObservations(previous) : {
    schemaVersion: 1, appid: TBC_APPID, currency: 'USD', generatedAt: incoming.generatedAt, products: [], imports: [],
  };
  validateMarketObservations(incoming);
  const productMap = new Map(base.products.map(product => [product.marketHashName, structuredClone(product)]));
  let addedPoints = 0;
  for (const next of incoming.products) {
    const current = productMap.get(next.marketHashName);
    if (!current) {
      productMap.set(next.marketHashName, structuredClone(next));
      addedPoints += next.observations.length;
      continue;
    }
    if (current.name !== next.name || current.steamUrl !== next.steamUrl) throw new Error('Imported product identity conflicts with cached data');
    const knownTimes = new Map(current.observations.map(point => [point.observedAt, point]));
    for (const point of next.observations) {
      const existing = knownTimes.get(point.observedAt);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(point)) throw new Error('Conflicting observation timestamp already exists for this product');
        continue;
      }
      current.observations.push(structuredClone(point));
      knownTimes.set(point.observedAt, point);
      addedPoints += 1;
    }
    current.observations.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    if (next.imageUrl) current.imageUrl = next.imageUrl;
  }
  const merged = {
    ...base,
    generatedAt: addedPoints > 0 ? incoming.generatedAt : base.generatedAt,
    products: [...productMap.values()].sort((a, b) => a.marketHashName.localeCompare(b.marketHashName)),
    imports: [...base.imports],
  };
  const incomingCapture = incoming.imports[0];
  const sameCapture = base.imports.some(capture => capture.sourceKind === incomingCapture.sourceKind
    && capture.observedAt === incomingCapture.observedAt && capture.provenance === incomingCapture.provenance);
  if (!sameCapture) merged.imports.push(incomingCapture);
  merged.imports.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  if (addedPoints === 0 && !sameCapture) merged.generatedAt = incoming.generatedAt;
  validateMarketObservations(merged);
  return { snapshot: merged, addedPoints, changed: addedPoints > 0 || !sameCapture };
}

export async function importMarketFile({ inputPath, outputPath = PUBLIC_OBSERVATIONS_PATH, format, observedAt, provenance, publish = false, now = new Date() }) {
  if (!inputPath) throw new Error('--input is required');
  const payload = JSON.parse(await readFile(inputPath, 'utf8'));
  const incoming = parseMarketImport({ payload, format, observedAt, provenance, now });
  if (!publish) return { changed: false, preview: incoming, addedPoints: incoming.products.length };
  let previous = null;
  try { previous = JSON.parse(await readFile(outputPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read previous public observations; refusing to overwrite', { cause: error }); }
  const result = mergeMarketObservations(previous, incoming);
  if (result.changed) await saveFilesAtomically([{ path: outputPath, content: `${JSON.stringify(result.snapshot, null, 2)}\n` }]);
  return result;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--publish') { options.publish = true; continue; }
    const match = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!match) throw new Error(`Unknown argument: ${argv[i]}`);
    const key = match[1];
    const value = match[2] ?? argv[++i];
    if (!value) throw new Error(`Missing value for --${key}`);
    if (!['input', 'format', 'observed-at', 'provenance'].includes(key)) throw new Error(`Unknown option --${key}`);
    options[key] = value;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await importMarketFile({
    inputPath: options.input && resolve(options.input),
    outputPath: PUBLIC_OBSERVATIONS_PATH,
    format: options.format,
    observedAt: options['observed-at'],
    provenance: options.provenance,
    publish: options.publish === true,
  });
  const snapshot = result.snapshot ?? result.preview;
  console.info(JSON.stringify({ mode: result.snapshot ? 'published' : 'preview', appid: TBC_APPID,
    products: snapshot.products.length, addedPoints: result.addedPoints, changed: result.changed,
    completeCapture: snapshot.imports.at(-1)?.complete ?? snapshot.imports[0]?.complete ?? false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Market import failed:', error.message); process.exitCode = 1; });
}
