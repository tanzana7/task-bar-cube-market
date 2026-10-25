import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, open, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { importMarketFile, PUBLIC_OBSERVATIONS_PATH, validateMarketObservations } from './market-import.mjs';
import { saveFilesAtomically } from './steam-market.mjs';

const publicPath = fileURLToPath(PUBLIC_OBSERVATIONS_PATH);
const productionSiteUrl = 'https://task-bar-cube-market.pages.dev/market-observations.json';

function run(command, args) {
  if (process.platform === 'win32' && command === 'npm') {
    const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    execFileSync(process.execPath, [npmCli, ...args], { stdio: 'inherit' });
    return;
  }
  execFileSync(command, args, { stdio: 'inherit' });
}

function parseArgs(argv) {
  const options = { inputs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--publish') { options.publish = true; options.dryRun = false; continue; }
    if (arg === '--rights-confirmed') { options.rightsConfirmed = true; continue; }
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    const key = match[1];
    const value = match[2] ?? argv[++index];
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing value for --${key}`);
    if (key === 'input') options.inputs.push(resolve(value));
    else if (['observed-at', 'provenance'].includes(key)) options[key] = value;
    else throw new Error(`Unknown option --${key}`);
  }
  if (options.publish && options.dryRun) throw new Error('Choose either --dry-run or --publish');
  if (options.publish && !options.rightsConfirmed) throw new Error('--publish requires --rights-confirmed (operator attestation, not Valve permission)');
  if (options.inputs.length === 0) throw new Error('At least one --input is required');
  options.dryRun = !options.publish;
  return options;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function getSiteUrl() {
  const override = process.env.TBCM_MARKET_PUBLISH_SITE_URL;
  if (!override) return productionSiteUrl;
  const url = new URL(override);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('TBCM_MARKET_PUBLISH_SITE_URL is restricted to loopback hosts for isolated tests');
  }
  return url.toString();
}

async function acquirePublishLock() {
  // Keying the temp lock by checkout path prevents concurrent publish processes from racing
  // over the same public JSON while allowing independent isolated test checkouts to run.
  const key = createHash('sha256').update(resolve(process.cwd()).toLowerCase()).digest('hex').slice(0, 20);
  const lockPath = join(tmpdir(), `tbcm-market-publish-${key}.lock`);
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return { handle, lockPath };
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another market publish is running or left a stale lock at ${lockPath}`);
    throw error;
  }
}

function sameSnapshot(expected, actual) {
  try {
    validateMarketObservations(actual);
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

async function verifyDeployedBrowserAssets(siteUrl) {
  const origin = new URL(siteUrl).origin;
  const response = await fetch(`${origin}/`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Cloudflare homepage returned HTTP ${response.status}`);
  const html = await response.text();
  const scriptPath = /<script[^>]+src=["']([^"']+\.js)["']/i.exec(html)?.[1];
  if (!html.includes('<title>Task Bar Cube Market') || !scriptPath) throw new Error('Cloudflare homepage shell or JavaScript bundle is invalid');
  const scriptUrl = new URL(scriptPath, origin);
  if (scriptUrl.origin !== origin) throw new Error('Cloudflare homepage references an off-site application bundle');
  const scriptResponse = await fetch(scriptUrl, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!scriptResponse.ok) throw new Error(`Cloudflare JavaScript bundle returned HTTP ${scriptResponse.status}`);
  const script = await scriptResponse.text();
  if (!script.includes('market-observations.json') || !script.includes('部分観測')) {
    throw new Error('Cloudflare JavaScript bundle does not contain the imported market rendering path');
  }
}

async function waitForDeployment(expectedSnapshot) {
  const siteUrl = getSiteUrl();
  const defaultTimeout = 5 * 60_000;
  const defaultInterval = 10_000;
  const localMock = process.env.TBCM_MARKET_PUBLISH_SITE_URL !== undefined;
  const timeout = localMock ? Number(process.env.TBCM_MARKET_PUBLISH_DEPLOY_TIMEOUT_MS ?? defaultTimeout) : defaultTimeout;
  const interval = localMock ? Number(process.env.TBCM_MARKET_PUBLISH_POLL_INTERVAL_MS ?? defaultInterval) : defaultInterval;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > defaultTimeout
      || !Number.isSafeInteger(interval) || interval < 50 || interval > defaultInterval) {
    throw new Error('Invalid local deployment verification timing override');
  }
  const deadline = Date.now() + timeout;
  let lastReason = 'deployment not visible yet';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(siteUrl, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        const snapshot = validateMarketObservations(await response.json());
        if (sameSnapshot(expectedSnapshot, snapshot)) {
          await verifyDeployedBrowserAssets(siteUrl);
          return;
        }
        lastReason = 'published JSON does not exactly match the validated product, price, listing, image, and observation data';
      } else lastReason = `HTTP ${response.status}`;
    } catch (error) {
      lastReason = error.message;
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, interval));
  }
  throw new Error(`Cloudflare Pages deployment was not confirmed: ${lastReason}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const lock = options.publish ? await acquirePublishLock() : null;
  const tempDir = await mkdtemp(join(tmpdir(), 'tbcm-market-publish-'));
  const stagedOutput = join(tempDir, 'market-observations.json');
  let originalHead = null;
  let existingPublic = null;
  let mutated = false;
  let pushed = false;
  try {
    if (options.publish) getSiteUrl();
    if (options.publish) {
      if (git('branch', '--show-current') !== 'main') throw new Error('Publishing is allowed only from main');
      if (git('status', '--porcelain')) throw new Error('Working tree must be clean before publishing');
      originalHead = git('rev-parse', 'HEAD');
      run('git', ['fetch', 'origin', 'main']);
      if (originalHead !== git('rev-parse', 'origin/main')) throw new Error('Local main must match origin/main before publishing');
    }
    try { await copyFile(publicPath, stagedOutput); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    existingPublic = await readFile(publicPath, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    const result = await importMarketFile({ inputPaths: options.inputs, outputPath: stagedOutput,
      observedAt: options['observed-at'] ?? null, provenance: options.provenance ?? null,
      publish: options.publish === true, rightsConfirmed: options.rightsConfirmed === true });
    if (!result.changed) {
      console.info(`No data change; ${result.snapshot.products.length} TBC products are already current.`);
      return;
    }
    if (!options.publish) await writeFile(stagedOutput, `${JSON.stringify(result.preview, null, 2)}\n`);
    const proposed = JSON.parse(await readFile(stagedOutput, 'utf8'));
    console.info(`Validated ${proposed.products.length} TBC products from ${proposed.imports.length} capture(s).`);
    if (options.dryRun) {
      run('npm', ['run', 'market:validate']);
      run('npm', ['run', 'fx:validate']);
      run('npm', ['run', 'typecheck']);
      run('npm', ['run', 'build']);
      console.info('Dry run: no public file, Git commit, push, or deployment was changed.');
      return;
    }

    run('npm', ['run', 'market:validate']);
    run('npm', ['run', 'fx:validate']);
    await saveFilesAtomically([{ path: publicPath, content: await readFile(stagedOutput, 'utf8') }]);
    mutated = true;
    run('npm', ['run', 'typecheck']);
    run('npm', ['run', 'build']);

    run('git', ['add', '--', 'public/market-observations.json']);
    if (git('diff', '--cached', '--name-only')) {
      run('git', ['commit', '-m', 'Publish validated TBC market observations']);
      run('git', ['push', 'origin', 'main']);
      pushed = true;
    } else {
      console.info('No generated JSON diff; skipping commit and Pages build trigger.');
      return;
    }
    await waitForDeployment(proposed);
    console.info(`Cloudflare Pages JSON confirmed: ${getSiteUrl()}`);
  } catch (error) {
    if (options.publish && mutated && !pushed && originalHead) {
      try {
        run('git', ['reset', '--hard', originalHead]);
        if (existingPublic === null) await rm(publicPath, { force: true });
        else {
          const restored = JSON.parse(await readFile(publicPath, 'utf8'));
          const previous = JSON.parse(existingPublic);
          if (!sameSnapshot(previous, restored)) throw new Error('Previous public cache content was not restored');
        }
      } catch (rollbackError) {
        throw new Error(`${error.message}; publish rollback also failed: ${rollbackError.message}`, { cause: error });
      }
    }
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    if (lock) {
      await lock.handle.close();
      await unlink(lock.lockPath).catch(() => {});
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Market publish failed:', error.message); process.exitCode = 1; });
}
