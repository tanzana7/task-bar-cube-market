import { readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { FX_RATE_URL, fetchFxRate, validateFxRateRecord } from './steam-market.mjs';

const DEFAULT_CACHE = new URL('../public/fx-rate.json', import.meta.url);

export async function updateFxRate({ fetchImpl = fetch, now = () => new Date(), cachePath = DEFAULT_CACHE } = {}) {
  // This isolated updater calls fetchFxRate only; it never invokes Steam collection code.
  const observed = await fetchFxRate(fetchImpl, now);
  const currentTime = now();
  const validated = validateFxRateRecord(observed, currentTime);
  const record = {
    schemaVersion: 1,
    source: validated.source,
    apiUrl: FX_RATE_URL,
    base: validated.base,
    quote: validated.quote,
    rate: validated.rate,
    rateDate: validated.rateDate,
    fetchedAt: validated.fetchedAt,
  };

  let previous;
  try {
    previous = JSON.parse(await readFile(cachePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not read existing FX cache', { cause: error });
  }

  if (previous?.schemaVersion === 1) {
    try {
      const validPrevious = validateFxRateRecord(previous, currentTime);
      // A repeated business-day observation (often on weekends) does not require a Pages rebuild.
      // Keep fetchedAt as the timestamp of the persisted observation; never advance it synthetically.
      if (validPrevious.rateDate === record.rateDate && validPrevious.rate === record.rate) {
        return { status: 'unchanged', record: previous };
      }
    } catch {
      // Replace malformed or expired cache only after obtaining and validating a fresh observation.
    }
  }

  const temporary = new URL(cachePath.href + '.tmp');
  try {
    await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', 'utf8');
    await rename(temporary, cachePath);
  } catch (error) {
    throw new Error('Could not atomically save FX cache', { cause: error });
  }
  return { status: 'updated', record };
}

export async function validateFxCache(cachePath = DEFAULT_CACHE, now = new Date()) {
  let record;
  try {
    record = JSON.parse(await readFile(cachePath, 'utf8'));
  } catch (error) {
    throw new Error('FX cache is missing or invalid JSON', { cause: error });
  }
  if (record?.schemaVersion !== 1) throw new Error('FX cache schema is invalid');
  validateFxRateRecord(record, now);
  return record;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--validate-cache')) {
    throw new Error('Supported option: --validate-cache');
  }
  if (args[0] === '--validate-cache') {
    const record = await validateFxCache();
    console.info(JSON.stringify({ status: 'valid', rateDate: record.rateDate, rate: record.rate, fetchedAt: record.fetchedAt }));
    return;
  }
  const result = await updateFxRate();
  console.info(JSON.stringify({ status: result.status, rateDate: result.record.rateDate,
    rate: result.record.rate, fetchedAt: result.record.fetchedAt, source: result.record.source }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('FX rate update failed:', error.message); process.exitCode = 1; });
}
