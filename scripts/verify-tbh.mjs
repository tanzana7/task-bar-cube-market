import { readFile } from 'node:fs/promises';
import { normalizeResult, parsePage } from './steam-market.mjs';

const TBH_APPID = 3678970;
const live = process.argv.includes('--live');
if (process.argv.some(arg => arg.startsWith('--') && arg !== '--live')) {
  throw new Error('Only --live is supported');
}

async function main() {
  let body;
  if (live) {
    // Explicit opt-in and ten rows limit Steam traffic; this script never writes a market cache.
    const url = new URL('https://steamcommunity.com/market/search/render/');
    for (const [key, value] of Object.entries({ appid: TBH_APPID, norender: 1, count: 10, start: 0, currency: 1, country: 'US' })) {
      url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (response.status === 403 || response.status === 429) throw new Error(`Steam access stopped: HTTP ${response.status}`);
    if (!response.ok) throw new Error(`Steam HTTP ${response.status}`);
    body = await response.json();
  } else {
    body = JSON.parse(await readFile(new URL('../tests/fixtures/tbh-search-page.json', import.meta.url), 'utf8'));
  }
  const page = parsePage(body, 0);
  const items = page.results.map(result => normalizeResult(result, 'USD', TBH_APPID));
  // Report structure and verification outcomes only; no response, identifiers or credentials are saved.
  console.info(JSON.stringify({ source: live ? 'Steam' : 'fixture', appid: TBH_APPID,
    totalCount: page.total_count, start: page.start ?? null, pagesize: page.pagesize ?? null,
    returned: items.length, priceVerified: items.every(item => item.priceMinor !== null),
    imagesPresent: items.filter(item => item.imageUrl !== null).length,
    listingsPresent: items.filter(item => item.listings !== null).length }));
}

main().catch(error => { console.error('TBH verification failed:', error.message); process.exitCode = 1; });
