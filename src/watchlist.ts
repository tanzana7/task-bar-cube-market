import { parsePriceFilterInput } from './market-features.ts';

export type WatchCurrency = 'USD' | 'JPY';
export type WatchDirection = 'buy-at-or-below' | 'sell-at-or-above';
export type WatchTarget = {
  currency: WatchCurrency;
  direction: WatchDirection;
  priceMinor: number;
};
export type WatchPrice = { currency: WatchCurrency; priceMinor: number; observedAt: string };
export type WatchStatus = 'reached' | 'not-reached' | 'missing' | 'stale' | 'fx-unavailable';

export const WATCH_TARGETS_STORAGE_KEY = 'tbcm-5084200-watch-targets';
export const WATCH_OBSERVATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function parseWatchTargets(value: string | null): Map<string, WatchTarget> {
  if (!value) return new Map();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion !== 1 || !record.targets || typeof record.targets !== 'object' || Array.isArray(record.targets)) return new Map();
    const targets = new Map<string, WatchTarget>();
    for (const [marketHashName, raw] of Object.entries(record.targets as Record<string, unknown>)) {
      if (!marketHashName.trim() || !raw || typeof raw !== 'object') continue;
      const candidate = raw as Partial<WatchTarget>;
      if ((candidate.currency !== 'USD' && candidate.currency !== 'JPY')
          || !['buy-at-or-below', 'sell-at-or-above'].includes(candidate.direction ?? '')
          || !Number.isSafeInteger(candidate.priceMinor) || (candidate.priceMinor ?? -1) < 0
          || (candidate.currency === 'JPY' && (candidate.priceMinor ?? 0) % 100 !== 0)) continue;
      targets.set(marketHashName, candidate as WatchTarget);
    }
    return targets;
  } catch {
    return new Map();
  }
}

export function serializeWatchTargets(targets: Map<string, WatchTarget>): string {
  return JSON.stringify({ schemaVersion: 1, targets: Object.fromEntries(targets) });
}

export function setWatchTarget(targets: Map<string, WatchTarget>, marketHashName: string, target: WatchTarget | null): Map<string, WatchTarget> {
  if (!marketHashName.trim()) throw new Error('market_hash_name is required');
  const next = new Map(targets);
  if (target === null) next.delete(marketHashName);
  else {
    if ((target.currency !== 'USD' && target.currency !== 'JPY')
        || !['buy-at-or-below', 'sell-at-or-above'].includes(target.direction)
        || !Number.isSafeInteger(target.priceMinor) || target.priceMinor < 0
        || (target.currency === 'JPY' && target.priceMinor % 100 !== 0)) throw new Error('Invalid watch target');
    next.set(marketHashName, target);
  }
  return next;
}

export function parseWatchTargetPrice(input: string, currency: WatchCurrency): { priceMinor: number | null; error: string | null } {
  const result = parsePriceFilterInput(input, currency);
  if (currency === 'JPY' && result.value !== null && result.value % 100 !== 0) {
    return { priceMinor: null, error: 'JPY価格は整数で入力してください。' };
  }
  return { priceMinor: result.value, error: result.error };
}

function convertMinor(priceMinor: number, from: WatchCurrency, to: WatchCurrency, usdJpyRate: number | null): number | null {
  if (from === to) return priceMinor;
  if (usdJpyRate === null || !Number.isFinite(usdJpyRate) || usdJpyRate < 1 || usdJpyRate > 1000) return null;
  const converted = from === 'USD'
    ? Math.round(priceMinor / 100 * usdJpyRate) * 100
    : Math.round((priceMinor / 100) / usdJpyRate * 100);
  return Number.isSafeInteger(converted) ? converted : null;
}

export function evaluateWatchTarget(target: WatchTarget, price: WatchPrice | null, usdJpyRate: number | null,
  now = Date.now()): WatchStatus {
  if (!Number.isFinite(now) || !price || !Number.isSafeInteger(price.priceMinor) || price.priceMinor < 0) return 'missing';
  const observedAt = Date.parse(price.observedAt);
  if (!Number.isFinite(observedAt) || observedAt > now + 5 * 60_000) return 'missing';
  if (now - observedAt > WATCH_OBSERVATION_MAX_AGE_MS) return 'stale';
  const comparable = convertMinor(price.priceMinor, price.currency, target.currency, usdJpyRate);
  if (comparable === null) return 'fx-unavailable';
  return target.direction === 'buy-at-or-below'
    ? comparable <= target.priceMinor ? 'reached' : 'not-reached'
    : comparable >= target.priceMinor ? 'reached' : 'not-reached';
}

export function mergeFavoriteKeys(current: Set<string>, legacyValues: Array<string | null>): Set<string> {
  const merged = new Set(current);
  for (const value of legacyValues) {
    if (!value) continue;
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every(name => typeof name === 'string' && name.trim())) {
        for (const name of parsed) merged.add(name);
      }
    } catch {
      // A malformed legacy key is ignored without damaging the current watchlist.
    }
  }
  return merged;
}
