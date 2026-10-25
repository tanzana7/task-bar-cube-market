import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { importMarketFile } from './market-import.mjs';
import { saveFilesAtomically } from './steam-market.mjs';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));
const maxBytes = 8 * 1024 * 1024;

function isolatedOutput(root) {
  const directory = resolve(root);
  // Isolation cannot point at a deployable directory in the real checkout.
  for (const forbidden of [repository, join(repository, 'public'), join(repository, 'dist')]) {
    const path = relative(resolve(forbidden), directory);
    if (directory.toLowerCase() === resolve(forbidden).toLowerCase()
        || (forbidden !== repository && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))) {
      throw new Error('Choose a separate isolation directory outside production public/dist');
    }
  }
  return join(directory, 'public', 'market-observations.json');
}

export function validateFeedUrl(value, isolated = false) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash
      || !(url.protocol === 'https:' || (isolated && loopback && url.protocol === 'http:'))
      || /(^|\.)(steamcommunity\.com|steampowered\.com|steamstatic\.com)$/i.test(url.hostname)
      || (!loopback && (/^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')))
      || (loopback && !isolated)) {
    throw new Error('Feed must be a configured HTTPS source without credentials; Steam sources and redirects are not supported');
  }
  return url;
}

async function fetchFeed(url, isolated) {
  validateFeedUrl(url, isolated);
  const response = await fetch(url, { redirect: 'error', credentials: 'omit',
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    const error = new Error(`Feed HTTP ${response.status}; no retry, previous data retained`);
    error.httpStatus = response.status;
    throw error;
  }
  if (!/^application\/(?:json|[\w.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('Feed did not return JSON');
  }
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Feed exceeds 8 MiB');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('Feed exceeds 8 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function runFeedCycle({ sourceUrl, inputPath, isolationRoot = null,
  rightsReference = null, enabled = false, provenance = 'Configured TBC market feed' }) {
  const isolated = isolationRoot !== null;
  if ((sourceUrl ? 1 : 0) + (inputPath ? 1 : 0) !== 1) throw new Error('Configure exactly one feed URL or input file');
  if (!isolated && (!enabled || typeof rightsReference !== 'string' || !rightsReference.trim()
      || rightsReference.length > 180 || /[\r\n\0]/.test(rightsReference) || inputPath)) {
    throw new Error('Production feed needs explicit enablement, a recorded rights review, and a configured HTTPS feed');
  }
  return runMarketInputCycle({ isolationRoot, rightsReference, enabled, provenance,
    loadText: () => sourceUrl ? fetchFeed(sourceUrl, isolated) : readFile(inputPath, 'utf8') });
}

// Acquisition adapters share the same validation, merge, rollback and Pages publication path.
// The callback runs under the output lock, so a second cycle cannot acquire another page first.
export async function runMarketInputCycle({ loadText, isolationRoot = null,
  rightsReference = null, enabled = false, provenance }) {
  const isolated = isolationRoot !== null;
  if (typeof loadText !== 'function') throw new Error('A market input loader is required');
  if (!isolated && (!enabled || typeof rightsReference !== 'string' || !rightsReference.trim()
      || rightsReference.length > 180 || /[\r\n\0]/.test(rightsReference))) {
    throw new Error('Production input needs explicit enablement and a recorded rights review');
  }
  const outputPath = isolated ? isolatedOutput(isolationRoot) : fileURLToPath(new URL('../public/market-observations.json', import.meta.url));
  const recordedProvenance = isolated ? provenance : `${provenance}; rights: ${rightsReference}`;
  const lockKey = createHash('sha256').update(outputPath.toLowerCase()).digest('hex');
  const lockPath = join(tmpdir(), `tbcm-feed-${lockKey}.lock`);
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another feed cycle is running; previous data retained'); throw error; }
  let temporary;
  let stage = 'receive';
  try {
    temporary = await mkdtemp(join(tmpdir(), 'tbcm-feed-input-'));
    const text = await loadText();
    if (Buffer.byteLength(text) > maxBytes) throw new Error('Feed exceeds 8 MiB');
    stage = 'validate';
    JSON.parse(text);
    const staged = join(temporary, 'input.json');
    await writeFile(staged, text);
    // Raw HARs/headers live only in the OS temp directory. Only the existing
    // importer's allowlisted product fields can reach a store or Git commit.
    const result = await importMarketFile({ inputPath: staged, outputPath,
      provenance: recordedProvenance, rightsConfirmed: !isolated, publish: false });
    if (!result.changed) return { changed: false, products: result.snapshot.products.length, addedPoints: 0 };
    if (isolated) {
      stage = 'save';
      await mkdir(dirname(outputPath), { recursive: true });
      await saveFilesAtomically([{ path: outputPath, content: `${JSON.stringify(result.snapshot, null, 2)}\n` }]);
    } else {
      stage = 'publish';
      // Keep the existing clean-main, build, rollback, push and exact Pages JSON
      // verification path; a feed must not invent a second publication protocol.
      await exec(process.execPath, [fileURLToPath(new URL('./market-publish.mjs', import.meta.url)),
        '--input', staged, '--provenance', recordedProvenance, '--publish', '--rights-confirmed'],
      { cwd: repository, timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 });
    }
    return { changed: true, products: result.snapshot.products.length, addedPoints: result.addedPoints };
  } catch (error) {
    error.feedStage = stage;
    throw error;
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await lock.close();
    await unlink(lockPath);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes('--once');
  const rootIndex = args.indexOf('--isolation-root');
  const inputIndex = args.indexOf('--input');
  const allowed = new Set(['--once', '--isolation-root', '--input']);
  for (let i = 0; i < args.length; i += 1) {
    if (!allowed.has(args[i])) throw new Error('Unknown feed option');
    if (args[i] !== '--once' && (typeof args[++i] !== 'string' || args[i].startsWith('--'))) throw new Error('Feed option needs a value');
  }
  const isolationRoot = rootIndex >= 0 ? args[rootIndex + 1] : null;
  const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : null;
  const interval = Number(process.env.TBCM_FEED_INTERVAL_MS ?? 6 * 60 * 60_000);
  if (!Number.isSafeInteger(interval) || interval < 60_000) throw new Error('Feed interval must be at least 60 seconds');
  do {
    try {
      const result = await runFeedCycle({ sourceUrl: process.env.TBCM_FEED_URL,
        inputPath, isolationRoot, enabled: process.env.TBCM_FEED_ENABLED === 'true',
        rightsReference: process.env.TBCM_FEED_RIGHTS_REFERENCE,
        provenance: process.env.TBCM_FEED_PROVENANCE ?? 'Configured TBC market feed' });
      console.info(JSON.stringify({ event: 'feed-cycle', ...result }));
    } catch (error) {
      // Never echo a source body or subprocess output: supplied HARs may contain secrets.
      console.error(JSON.stringify({ event: 'feed-cycle-failed', stage: error.feedStage ?? 'configuration',
        httpStatus: error.httpStatus ?? null,
        message: 'Check source validation or publication status; failed input is never accepted.' }));
      process.exitCode = 1;
      return; // 403/429 and all other failures stop the daemon rather than retrying.
    }
    if (!once) await new Promise(resolvePromise => setTimeout(resolvePromise, interval));
  } while (!once);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Feed configuration failed'); process.exitCode = 1; });
}
