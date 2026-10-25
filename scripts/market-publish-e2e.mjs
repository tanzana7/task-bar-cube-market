import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile, chmod } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = process.cwd();
const rootDir = await mkdtemp(join(tmpdir(), 'tbcm-publish-e2e-'));
const workDir = join(rootDir, 'work');
const remoteDir = join(rootDir, 'remote.git');
const inputPath = join(rootDir, 'captured-market.har');
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const temporarySecrets = ['E2E_COOKIE_SECRET', 'E2E_SESSION_SECRET', 'E2E_AUTH_SECRET'];
let mockMode = 'serve';
let server;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function publish(args, env = {}) {
  return new Promise(resolvePromise => {
    const child = spawn(process.execPath, [npmCli, 'run', 'market:publish', '--', ...args], {
      cwd: workDir,
      env: { ...process.env, ...env, TBCM_SKIP_PUBLISH_E2E: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill(), 180_000);
    child.once('error', error => {
      clearTimeout(timeout);
      resolvePromise({ error, status: null, stdout, stderr });
    });
    child.once('close', (status, signal) => {
      clearTimeout(timeout);
      resolvePromise({ error: signal ? new Error(`market:publish ended by ${signal}`) : null, status, stdout, stderr });
    });
  });
}

function marketPage(rows, start) {
  return {
    success: true,
    start,
    pagesize: rows.length,
    total_count: 30,
    results: rows,
  };
}

function captureEntry(payload, observedAt) {
  return {
    startedDateTime: observedAt,
    time: 36,
    request: {
      method: 'GET',
      url: `https://steamcommunity.com/market/search/render/?appid=5084200&start=${payload.start}`,
      headers: [
        { name: 'Cookie', value: 'sessionid=E2E_SESSION_SECRET; steamLoginSecure=E2E_COOKIE_SECRET' },
        { name: 'Authorization', value: 'Bearer E2E_AUTH_SECRET' },
      ],
    },
    response: {
      status: 200,
      content: { mimeType: 'application/json; charset=utf-8', text: JSON.stringify(payload) },
    },
  };
}

async function writeHar(rows, baseTime, changedProduct = null) {
  const pageRows = rows.map((row, index) => {
    const next = { ...row };
    if (changedProduct === index) {
      next.sell_price = 29;
      next.sell_price_text = '$0.29';
      next.sell_listings += 9;
    }
    return next;
  });
  const time0 = new Date(baseTime).toISOString();
  const time1 = new Date(Date.parse(baseTime) + 1_000).toISOString();
  const unrelated = {
    startedDateTime: time0,
    request: { method: 'GET', url: 'https://steamcommunity.com/login/home/', headers: [
      { name: 'Cookie', value: temporarySecrets[0] },
    ] },
    response: { status: 200, content: { mimeType: 'text/plain', text: temporarySecrets.join(' ') } },
  };
  const document = {
    log: {
      version: '1.2',
      creator: { name: 'isolated TBCM publish E2E', version: '1.0' },
      entries: [
        unrelated,
        captureEntry(marketPage(pageRows.slice(0, 15), 0), time0),
        captureEntry(marketPage(pageRows.slice(15), 15), time1),
      ],
    },
  };
  await writeFile(inputPath, JSON.stringify(document));
}

function publicSnapshotInRemote() {
  return JSON.parse(execFileSync('git', ['--git-dir', remoteDir, 'show', 'main:public/market-observations.json'], { encoding: 'utf8' }));
}

function assertNoHarSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of temporarySecrets) assert.equal(text.includes(secret), false, `HAR secret leaked: ${secret}`);
}

async function prepareProject() {
  await mkdir(workDir, { recursive: true });
  const files = git(sourceRoot, 'ls-files', '-z').split('\0').filter(Boolean);
  for (const relativePath of files) {
    const absoluteSource = resolve(sourceRoot, relativePath);
    const absoluteTarget = resolve(workDir, relativePath);
    if (!absoluteTarget.startsWith(`${resolve(workDir)}${sep}`)) throw new Error(`Unsafe tracked path: ${relativePath}`);
    await mkdir(dirname(absoluteTarget), { recursive: true });
    await cp(absoluteSource, absoluteTarget);
  }
  await symlink(join(sourceRoot, 'node_modules'), join(workDir, 'node_modules'), 'junction');

  git(workDir, 'init', '--initial-branch=main');
  git(workDir, 'config', 'user.name', 'TBCM isolated E2E');
  git(workDir, 'config', 'user.email', 'tbcm-e2e@example.invalid');
  git(workDir, 'add', '-A');
  git(workDir, 'commit', '-m', 'Initialize isolated market publish test');
  git(rootDir, 'init', '--bare', remoteDir);
  git(remoteDir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(workDir, 'remote', 'add', 'origin', remoteDir);
  git(workDir, 'push', '-u', 'origin', 'main');
}

async function startMockPages() {
  server = createServer(async (request, response) => {
    if (request.url === '/market-observations.json') {
      if (mockMode === 'unavailable') {
        response.writeHead(503, { 'content-type': 'text/plain' });
        response.end('deployment pending');
        return;
      }
      try {
        const snapshot = publicSnapshotInRemote();
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify(snapshot));
      } catch {
        response.writeHead(404);
        response.end('not deployed');
      }
      return;
    }
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><head><title>Task Bar Cube Market | isolated test</title></head><body><script type="module" src="/assets/e2e.js"></script></body></html>');
      return;
    }
    if (request.url === '/assets/e2e.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end('"market-observations.json";"部分観測";');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  return `http://127.0.0.1:${server.address().port}/market-observations.json`;
}

function assertRunSucceeded(result, message) {
  if (result.error || result.status !== 0) {
    throw new Error(`${message}\n${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`);
  }
}

function publishArgs() {
  return ['--input', inputPath, '--provenance', 'isolated synthetic HAR fixture', '--publish', '--rights-confirmed'];
}

try {
  await prepareProject();
  const url = await startMockPages();
  const fixture = JSON.parse(await readFile(join(sourceRoot, 'tests/fixtures/tbh-query-action-real-start30-usd.json'), 'utf8'));
  const rows = fixture.data.results.map(row => ({
    name: row.asset_description.market_name,
    sell_price: 3,
    sell_price_text: '$0.03',
    sell_listings: row.cSellOrders,
    asset_description: {
      appid: 5084200,
      market_hash_name: row.asset_description.market_hash_name,
      icon_url: row.asset_description.icon_url,
    },
  }));
  const now = Date.now();
  const t0 = new Date(now - 120_000);
  await writeHar(rows, t0);
  const testEnv = {
    TBCM_MARKET_PUBLISH_SITE_URL: url,
    TBCM_MARKET_PUBLISH_DEPLOY_TIMEOUT_MS: '1200',
    TBCM_MARKET_PUBLISH_POLL_INTERVAL_MS: '50',
  };

  const lockKey = createHash('sha256').update(resolve(workDir).toLowerCase()).digest('hex').slice(0, 20);
  const lockPath = join(tmpdir(), `tbcm-market-publish-${lockKey}.lock`);
  await writeFile(lockPath, '{"pid":0,"test":"busy"}');
  const locked = await publish(publishArgs(), testEnv);
  assert.notEqual(locked.status, 0, 'concurrent publish lock must block the CLI');
  assert.match(`${locked.stdout}\n${locked.stderr}`, /another market publish is running/i);
  await rm(lockPath, { force: true });

  const first = await publish(publishArgs(), testEnv);
  assertRunSucceeded(first, 'Initial 30-product, two-page publish did not complete through the local Git/Pages path');
  const initial = publicSnapshotInRemote();
  assert.equal(initial.appid, 5084200);
  assert.equal(initial.products.length, 30);
  assert.equal(initial.imports.length, 2);
  assert.equal(initial.products[0].observations[0].priceMinor, 3);
  assert.ok(initial.products.every(product => Number.isSafeInteger(product.observations[0].listings)));
  assert.ok(initial.products.every(product => product.imageUrl?.startsWith('https://community.cloudflare.steamstatic.com/economy/image/')));
  assert.ok(initial.products.every(product => product.steamUrl.startsWith('https://steamcommunity.com/market/listings/5084200/')));
  const updatedProductKey = rows[0].asset_description.market_hash_name;
  assertNoHarSecrets(initial);
  assertNoHarSecrets(git(workDir, 'show', 'HEAD:public/market-observations.json'));
  const firstHead = git(workDir, 'rev-parse', 'HEAD');

  const duplicate = await publish(publishArgs(), testEnv);
  assertRunSucceeded(duplicate, 'Idempotent second input did not exit successfully');
  assert.match(`${duplicate.stdout}\n${duplicate.stderr}`, /no data change/i);
  assert.equal(git(workDir, 'rev-parse', 'HEAD'), firstHead, 'identical input must not create a new commit');

  const t1 = new Date(now - 60_000);
  await writeHar(rows, t1, 0);
  const updated = await publish(publishArgs(), testEnv);
  assertRunSucceeded(updated, 'Second observation update did not publish through the isolated remote');
  const updatedSnapshot = publicSnapshotInRemote();
  assert.equal(updatedSnapshot.products.length, 30);
  const updatedProduct = updatedSnapshot.products.find(product => product.marketHashName === updatedProductKey);
  assert.equal(updatedProduct.observations.length, 2);
  assert.equal(updatedProduct.observations.at(-1).priceMinor, 29);
  assert.equal(updatedProduct.observations.at(-1).listings, rows[0].sell_listings + 9);
  assert.equal(updatedProduct.observations[0].priceMinor, 3);
  assert.equal(git(workDir, 'status', '--porcelain'), '');

  const beforePushFailureHead = git(workDir, 'rev-parse', 'HEAD');
  const beforePushFailureCache = await readFile(join(workDir, 'public/market-observations.json'), 'utf8');
  const hookPath = join(remoteDir, 'hooks', 'pre-receive');
  await writeFile(hookPath, '#!/bin/sh\necho isolated push failure >&2\nexit 1\n');
  await chmod(hookPath, 0o755);
  await writeHar(rows, new Date(now - 35_000), 1);
  const pushFailure = await publish(publishArgs(), testEnv);
  assert.notEqual(pushFailure.status, 0, 'rejected isolated Git push must fail');
  assert.equal(git(workDir, 'rev-parse', 'HEAD'), beforePushFailureHead, 'failed push must roll local commit back');
  assert.deepEqual(JSON.parse(await readFile(join(workDir, 'public/market-observations.json'), 'utf8')),
    JSON.parse(beforePushFailureCache), 'failed push must preserve the prior public cache');
  assert.equal(git(workDir, 'status', '--porcelain'), '', 'failed push rollback must leave the isolated main checkout clean');
  await rm(hookPath, { force: true });

  mockMode = 'unavailable';
  await writeHar(rows, new Date(now - 20_000), 2);
  const deployFailure = await publish(publishArgs(), testEnv);
  assert.notEqual(deployFailure.status, 0, 'unavailable Pages mock must not be reported as success');
  assert.match(`${deployFailure.stdout}\n${deployFailure.stderr}`, /Cloudflare Pages deployment was not confirmed/i);
  assert.equal(git(workDir, 'rev-parse', 'HEAD'), git(workDir, 'rev-parse', 'origin/main'),
    'a pushed valid snapshot remains committed when deployment confirmation is unavailable');
  const afterDeployFailure = publicSnapshotInRemote();
  assert.equal(afterDeployFailure.products.length, 30);
  const deployFailureProduct = afterDeployFailure.products.find(product => product.marketHashName === rows[2].asset_description.market_hash_name);
  assert.equal(deployFailureProduct.observations.at(-1).priceMinor, 29);

  console.info(JSON.stringify({
    status: 'passed',
    isolatedProducts: afterDeployFailure.products.length,
    pages: afterDeployFailure.imports.length,
    duplicateNoop: true,
    updateObservations: updatedProduct.observations.length,
    pushFailurePreservedCache: true,
    deploymentFailureReported: true,
    harSecretsExcluded: true,
    testCheckout: workDir,
  }, null, 2));
  if (process.env.TBCM_MARKET_PUBLISH_E2E_KEEP !== '1') await rm(rootDir, { recursive: true, force: true });
} catch (error) {
  console.error('Market publish E2E failed:', error.stack ?? error.message);
  if (process.env.TBCM_MARKET_PUBLISH_E2E_KEEP === '1') console.error(`Isolated checkout retained for inspection: ${workDir}`);
  else await rm(rootDir, { recursive: true, force: true });
  process.exitCode = 1;
} finally {
  if (server) await new Promise(resolvePromise => server.close(resolvePromise));
}
