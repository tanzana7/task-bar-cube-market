import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  collectLiveQueryActionPages, parseQueryActionPage, queryActionObservationStorePath,
} from './query-action-market.mjs';
import { APPID, TBH_APPID, DEFAULT_COLLECTION_STATE_PATH, requestPolicyFromEnv } from './steam-market.mjs';

function parseArgs(args) {
  const parsed = new Map();
  for (const argument of args) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(argument);
    if (!match) throw new Error(`Unsupported argument: ${argument}`);
    if (match[1] === 'live' || match[1] === 'restart') {
      if (match[2] !== undefined) throw new Error(`--${match[1]} does not take a value`);
      if (parsed.has(match[1])) throw new Error(`Duplicate argument: ${argument}`);
      parsed.set(match[1], true);
    } else if (match[2] !== undefined && !parsed.has(match[1])) parsed.set(match[1], match[2]);
    else throw new Error(`Invalid or duplicate argument: ${argument}`);
  }
  const allowed = new Set(['target', 'live', 'request-currency-id', 'max-pages', 'restart']);
  for (const key of parsed.keys()) if (!allowed.has(key)) throw new Error(`Unknown option --${key}`);
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.get('target') ?? 'tbh';
  if (!['tbh', 'cube'].includes(target)) throw new Error('--target must be tbh or cube');
  const appid = target === 'tbh' ? TBH_APPID : APPID;
  const requestCurrencyId = Number(args.get('request-currency-id') ?? 1);
  const maxPages = Number(args.get('max-pages') ?? (args.has('live') ? 6 : 1));
  if (![1, 8].includes(requestCurrencyId) || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 6) {
    throw new Error('Use --request-currency-id=1|8 and --max-pages=1..6');
  }

  if (!args.has('live')) {
    if (args.has('request-currency-id') || args.has('restart')) {
      throw new Error('--request-currency-id and --restart are only valid with --live');
    }
    if (target !== 'tbh') throw new Error('Fixture mode only accepts --target=tbh');
    const payload = JSON.parse(await readFile(new URL('../tests/fixtures/tbh-query-action-real-start30-usd.json', import.meta.url), 'utf8'));
    const page = parseQueryActionPage(payload, { expectedStart: 30, expectedAppId: TBH_APPID });
    console.log(JSON.stringify({ mode: 'fixture', appid, start: page.start, totalCount: page.totalCount,
      pageSize: page.pageSize, distinctProducts: page.items.length, observedResponseCurrencyId: page.responseCurrencyId,
      requestCurrencyId: null, requestResponseCurrencyMatch: null, priceBasis: 'min-sell-subtotal-unverified-fees' }, null, 2));
    return;
  }

  const result = await collectLiveQueryActionPages({ appid, requestCurrencyId, maxPages,
    live: true, restart: args.has('restart'), statePath: DEFAULT_COLLECTION_STATE_PATH,
    storePath: queryActionObservationStorePath(appid), policy: requestPolicyFromEnv() });
  console.log(JSON.stringify({ mode: 'live', appid, progress: result.progress,
    productsStored: result.products.length, catalogComplete: result.progress.catalogComplete,
    store: fileURLToPath(queryActionObservationStorePath(appid)) }, null, 2));
}

main().catch(error => {
  console.error(`queryAction collection failed: ${error.message}`);
  process.exitCode = 1;
});
