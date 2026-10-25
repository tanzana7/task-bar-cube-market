import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { APPID, validateSnapshot } from './steam-market.mjs';

const DEFAULT_INDEX = new URL('../public/history/index.json', import.meta.url);
const DEFAULT_DIRECTORY = new URL('../public/history/', import.meta.url);

function fileUrl(directory, id) {
  return new URL(`${id}.json`, directory);
}

export function historyId(marketHashName) {
  if (typeof marketHashName !== 'string' || !marketHashName.trim()) throw new Error('Invalid market hash name');
  return createHash('sha256').update(marketHashName, 'utf8').digest('hex');
}

function parseUtcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

export function validateHistoryIndex(index) {
  if (!index || index.schemaVersion !== 1 || index.appid !== APPID || !Array.isArray(index.products)) {
    throw new Error('Invalid price history index');
  }
  const ids = new Set();
  const names = new Set();
  for (const product of index.products) {
    if (!product || typeof product.marketHashName !== 'string' || !product.marketHashName.trim()
        || product.id !== historyId(product.marketHashName) || ids.has(product.id) || names.has(product.marketHashName)) {
      throw new Error('Invalid or duplicate price history product');
    }
    ids.add(product.id);
    names.add(product.marketHashName);
  }
  return index;
}

export function validateProductHistory(history, marketHashName) {
  if (!history || history.schemaVersion !== 1 || history.appid !== APPID || history.currency !== 'USD'
      || history.marketHashName !== marketHashName || !Array.isArray(history.points)) {
    throw new Error('Invalid product price history');
  }
  let previous = -Infinity;
  for (const point of history.points) {
    const timestamp = parseUtcTimestamp(point?.observedAt);
    if (timestamp === null || timestamp <= previous
        || !Number.isSafeInteger(point.priceCents) || point.priceCents < 0
        || !Number.isSafeInteger(point.listings) || point.listings < 0) {
      throw new Error('Invalid or unordered price history point');
    }
    previous = timestamp;
  }
  return history;
}

async function readIndex(indexPath) {
  try {
    return validateHistoryIndex(JSON.parse(await readFile(indexPath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, appid: APPID, products: [] };
    throw new Error('Could not validate price history index', { cause: error });
  }
}

export async function prepareHistoryUpdate(usdSnapshot, {
  indexPath = DEFAULT_INDEX,
  directory = DEFAULT_DIRECTORY,
} = {}) {
  validateSnapshot(usdSnapshot, 'USD');
  const index = await readIndex(indexPath);
  const byHash = new Map(index.products.map(product => [product.marketHashName, product]));
  const additions = new Map();
  const seen = new Set();

  for (const item of usdSnapshot.items) {
    if (seen.has(item.marketHashName)) throw new Error('Duplicate product in USD snapshot');
    seen.add(item.marketHashName);
    // Unpriced products are not observations. A missing price is never encoded as zero.
    if (item.priceMinor === null || item.listings === null) continue;
    if (!Number.isSafeInteger(item.priceMinor) || item.priceMinor < 0
        || !Number.isSafeInteger(item.listings) || item.listings < 0) throw new Error('Invalid USD history observation');
    const id = historyId(item.marketHashName);
    const known = byHash.get(item.marketHashName);
    if (known && known.id !== id) throw new Error('History ID mapping changed');
    const product = known ?? { id, marketHashName: item.marketHashName };
    if (!known) {
      const collision = index.products.find(entry => entry.id === id && entry.marketHashName !== item.marketHashName);
      if (collision) throw new Error('Price history ID collision');
      byHash.set(item.marketHashName, product);
    }
    additions.set(item.marketHashName, { product, point: {
      observedAt: usdSnapshot.fetchedAt,
      priceCents: item.priceMinor,
      listings: item.listings,
    } });
  }

  const files = [];
  for (const { product, point } of additions.values()) {
    let history;
    try {
      history = validateProductHistory(JSON.parse(await readFile(fileUrl(directory, product.id), 'utf8')), product.marketHashName);
    } catch (error) {
      if (error.code === 'ENOENT' && !index.products.some(entry => entry.id === product.id)) {
        history = { schemaVersion: 1, appid: APPID, currency: 'USD', marketHashName: product.marketHashName, points: [] };
      } else {
        throw new Error(`Could not validate existing history for ${product.marketHashName}`, { cause: error });
      }
    }

    const sameTime = history.points.find(existing => existing.observedAt === point.observedAt);
    if (sameTime) {
      if (sameTime.priceCents !== point.priceCents || sameTime.listings !== point.listings) {
        throw new Error(`Conflicting observation time for ${product.marketHashName}`);
      }
      continue;
    }
    history.points.push(point);
    history.points.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    validateProductHistory(history, product.marketHashName);
    files.push({ path: fileUrl(directory, product.id), content: `${JSON.stringify(history, null, 2)}\n` });
  }

  const products = [...byHash.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (products.length !== index.products.length) {
    const updatedIndex = validateHistoryIndex({ schemaVersion: 1, appid: APPID, products });
    files.push({ path: indexPath, content: `${JSON.stringify(updatedIndex, null, 2)}\n` });
  }
  return { files, products: products.length, observations: files.filter(file => file.path.href !== indexPath.href).length };
}

export async function validateHistoryCache({ indexPath = DEFAULT_INDEX, directory = DEFAULT_DIRECTORY } = {}) {
  let index;
  try {
    index = validateHistoryIndex(JSON.parse(await readFile(indexPath, 'utf8')));
  } catch (error) {
    throw new Error('Price history index is missing or invalid', { cause: error });
  }
  for (const product of index.products) {
    try {
      const history = validateProductHistory(JSON.parse(await readFile(fileUrl(directory, product.id), 'utf8')), product.marketHashName);
      if (history.points.length === 0) throw new Error('Empty history file');
    } catch (error) {
      throw new Error(`Invalid price history ${product.id}`, { cause: error });
    }
  }
  return index;
}
