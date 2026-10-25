import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { APPID, normalizeResult, parsePage, searchUrl } from './steam-market.mjs';

const PAGE_FIXTURE = new URL('../tests/fixtures/steam-pages.json', import.meta.url);

export async function inspectFirstPage({ live = false, fetchImpl = fetch } = {}) {
  let body;
  let httpStatus = 'fixture';
  if (live) {
    const response = await fetchImpl(searchUrl(0, 'USD'), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    httpStatus = response.status;
    if (response.status === 403 || response.status === 429) {
      return { appid: APPID, httpStatus, ok: false, stopped: true, reason: `Steam access stopped: HTTP ${response.status}` };
    }
    if (!response.ok) return { appid: APPID, httpStatus, ok: false, stopped: true, reason: `Steam HTTP ${response.status}` };
    try {
      body = await response.json();
    } catch {
      return { appid: APPID, httpStatus, ok: false, stopped: true, reason: 'Non-JSON or CAPTCHA response; stopped' };
    }
  } else {
    const fixture = JSON.parse(await readFile(PAGE_FIXTURE, 'utf8'));
    body = fixture.USD[0];
  }

  try {
    const page = parsePage(body, 0);
    for (const result of page.results) normalizeResult(result, 'USD');
    return {
      appid: APPID,
      httpStatus,
      ok: true,
      stopped: false,
      requestedCurrency: 'USD',
      responseCurrency: page.results.length === 0 ? 'unavailable' : 'USD verified',
      totalCount: page.total_count,
      returned: page.results.length,
      hasListings: page.results.some(result => Number.isSafeInteger(result.sell_listings)),
    };
  } catch (error) {
    return { appid: APPID, httpStatus, ok: false, stopped: true, reason: `Invalid market response: ${error.message}` };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  if (args.some(arg => arg !== '--live')) throw new Error('Supported option: --live');
  const result = await inspectFirstPage({ live });
  console.info(JSON.stringify({ mode: live ? 'live' : 'fixture', ...result }));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('Market check failed:', error.message); process.exitCode = 1; });
}
