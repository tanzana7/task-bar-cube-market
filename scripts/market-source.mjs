import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runMarketInputCycle } from './market-feed.mjs';
import { collectLiveQueryActionPages, queryActionObservationStorePath,
  validateQueryActionObservationStore } from './query-action-market.mjs';
import { APPID, DEFAULT_COLLECTION_STATE_PATH, requestPolicyFromEnv } from './steam-market.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const controlFiles = ['.market/steam-collection-state.json', '.market/query-action-observations-5084200.json'];
function git(...args) {
  try { return execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new Error(`Git ${args[0]} failed; review repository state before another source run`); }
}

function requireCleanMain() {
  if (git('branch', '--show-current') !== 'main' || git('status', '--porcelain')) {
    throw new Error('Production source needs a clean main checkout before collection');
  }
  git('fetch', 'origin', 'main');
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) throw new Error('Main must match origin/main');
}

function persistControlFiles() {
  // Persist the attempted request budget even when HTTP or parsing fails. This commit does not
  // deploy observations; market:publish still requires a clean checkout and its own rights gate.
  git('add', '--', controlFiles[0]);
  const changed = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
  if (changed.some(path => !controlFiles.includes(path))) throw new Error('Refusing unrelated staged source files');
  if (!changed.length) return;
  git('commit', '-m', '[CF-Pages-Skip] Persist bounded TBC source observations and request budget');
  git('push', 'origin', 'main');
}

export async function runQueryActionSourceCycle({ live = false, savedStorePath = null,
  isolationRoot = null, enabled = false, rightsReference = null, maxPages = 1, restart = false,
  collectImpl = collectLiveQueryActionPages } = {}) {
  if ((live ? 1 : 0) + (savedStorePath ? 1 : 0) !== 1) throw new Error('Choose --live or --saved-store');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 6) throw new Error('max-pages must be 1..6');
  const isolated = isolationRoot !== null;
  if (!isolated && !enabled) throw new Error('Production source needs explicit enablement');
  let collection;
  // The shared pipeline checks publication rights before invoking this loader or making HTTP requests.
  const result = await runMarketInputCycle({ isolationRoot, enabled, rightsReference,
    provenance: 'Steam Community Market GET queryAction; USD subtotal, fee basis unverified',
    loadText: async () => {
      if (!isolated) requireCleanMain();
      let store;
      if (savedStorePath) {
        store = validateQueryActionObservationStore(JSON.parse(await readFile(savedStorePath, 'utf8')));
      } else {
        if (process.env.STEAM_MARKET_COLLECTION_ALLOWED !== 'true') {
          throw new Error('Live source requires STEAM_MARKET_COLLECTION_ALLOWED=true');
        }
        const storePath = isolated ? join(resolve(isolationRoot), 'source', 'query-action-observations.json')
          : queryActionObservationStorePath(APPID);
        if (isolated) await mkdir(join(resolve(isolationRoot), 'source'), { recursive: true });
        try {
          store = await collectImpl({ appid: APPID, requestCurrencyId: 1, maxPages, live: true,
            statePath: DEFAULT_COLLECTION_STATE_PATH, storePath, policy: requestPolicyFromEnv(), restart });
        } finally {
          if (!isolated) {
            // Include a newly created sanitized store, but never a raw response/HAR.
            try { await readFile(queryActionObservationStorePath(APPID)); git('add', '--', controlFiles[1]); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            persistControlFiles();
          }
        }
      }
      validateQueryActionObservationStore(store);
      if (store.appid !== APPID) throw new Error('Only TBC source observations can enter this pipeline');
      collection = { reportedTotalCount: store.progress.reportedTotalCount,
        nextStart: store.progress.nextStart, status: store.progress.status, complete: false };
      return JSON.stringify(store);
    } });
  return { ...result, collection };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (seen.has(key)) throw new Error('Duplicate source option');
    seen.add(key);
    if (key === '--live' || key === '--publish' || key === '--restart') options[key.slice(2)] = true;
    else if (['--saved-store', '--isolation-root', '--max-pages'].includes(key)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('Source option needs a value');
      options[key.slice(2)] = value;
    } else throw new Error('Unknown source option');
  }
  if (!options.publish && !options['isolation-root']) throw new Error('Use --isolation-root for a local test, or explicit --publish');
  if (options.publish && options['isolation-root']) throw new Error('Choose isolation or publication');
  if (options.restart && !options.live) throw new Error('--restart requires --live');
  const result = await runQueryActionSourceCycle({ live: options.live === true,
    savedStorePath: options['saved-store'] ?? null, isolationRoot: options['isolation-root'] ?? null,
    restart: options.restart === true,
    maxPages: Number(options['max-pages'] ?? 1), enabled: options.publish === true && process.env.TBCM_FEED_ENABLED === 'true',
    rightsReference: process.env.TBCM_FEED_RIGHTS_REFERENCE ?? null });
  console.log(JSON.stringify({ event: 'query-action-source-cycle', live: options.live === true, ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`TBC source failed: ${error.message}`); process.exitCode = 1; });
}
