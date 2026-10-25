import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validateFeedUrl } from './market-feed.mjs';
import { validateMarketObservations } from './market-import.mjs';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));
const capturePath = resolve(process.argv[2] ?? '.market/tbc-dom-observation-2026-10-25T10-56-31Z.json');
const capture = JSON.parse(await readFile(capturePath, 'utf8'));
assert.equal(capture.appid, 5084200);
assert.equal(capture.products.length, 56, 'Use the actual 56-product TBC capture');
assert.equal(capture.totalCount, 73);
const root = await mkdtemp(join(tmpdir(), 'tbcm-feed-e2e-日本語-'));
const work = join(root, 'work');
const remote = join(root, 'remote.git');
const isolationRoot = join(root, 'isolated');
const output = join(isolationRoot, 'public', 'market-observations.json');
const artifacts = join(repository, '.market', 'feed-preview');
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
let body = JSON.stringify(capture);
let status = 200;
let contentType = 'application/json';
let calls = 0;
const server = createServer((request, response) => {
  assert.equal(request.url, '/feed.json');
  assert.equal(request.headers.cookie, undefined);
  calls += 1;
  response.writeHead(status, { 'content-type': contentType });
  response.end(body);
});
await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
const sourceUrl = `http://127.0.0.1:${server.address().port}/feed.json`;
const cli = fileURLToPath(new URL('./market-feed.mjs', import.meta.url));
async function tick(success = true) {
  try {
    const result = await exec(process.execPath, [cli, '--once', '--isolation-root', isolationRoot], {
      cwd: repository, env: { ...process.env, TBCM_FEED_URL: sourceUrl }, timeout: 30_000 });
    assert.equal(success, true, 'Expected feed cycle failure');
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    if (success || error.code !== 1) throw error;
    return null;
  }
}
async function command(program, args, cwd = work) {
  return exec(program, args, { cwd, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
}
async function deploy(message) {
  await cp(output, join(work, 'public', 'market-observations.json'));
  await command(process.execPath, [npmCli, 'run', 'build']);
  await command('git', ['add', 'public/market-observations.json']);
  await command('git', ['commit', '-m', message]);
  await command('git', ['push', 'origin', 'main']);
  const expected = await readFile(output, 'utf8');
  const remoteJson = await command('git', ['show', 'main:public/market-observations.json'], remote);
  assert.deepEqual(JSON.parse(remoteJson.stdout), JSON.parse(expected));
  assert.deepEqual(JSON.parse(await readFile(join(work, 'dist', 'market-observations.json'), 'utf8')), JSON.parse(expected));
  // This directory is an isolated mock Pages deployment, never the real public directory.
  await cp(join(work, 'dist'), join(artifacts, 'site'), { recursive: true, force: true });
}

try {
  await mkdir(work, { recursive: true });
  await mkdir(artifacts, { recursive: true });
  for (const entry of ['src', 'public', 'scripts', 'tests', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json']) {
    await cp(join(repository, entry), join(work, entry), { recursive: true });
  }
  await symlink(join(repository, 'node_modules'), join(work, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await command('git', ['init', '--bare', remote], root);
  await command('git', ['init', '-b', 'main']);
  await command('git', ['config', 'user.name', 'Isolated feed E2E']);
  await command('git', ['config', 'user.email', 'e2e@example.invalid']);
  await command('git', ['remote', 'add', 'origin', remote]);
  await command('git', ['commit', '--allow-empty', '-m', 'Isolated initial state']);

  const first = await tick();
  assert.equal(first.products, 56);
  assert.equal(first.addedPoints, 56);
  const initial = validateMarketObservations(JSON.parse(await readFile(output, 'utf8')));
  assert.equal(new Set(initial.products.map(row => row.marketHashName)).size, 56);
  assert.ok(initial.products.every(row => row.observations[0].priceMinor === null));
  assert.equal(initial.imports[0].pageSize, 56);
  assert.equal(initial.imports[0].totalCount, 73);
  assert.equal(initial.imports[0].complete, false);
  assert.equal(initial.imports[0].rightsConfirmed, false);
  await writeFile(join(artifacts, 'initial.json'), JSON.stringify(initial, null, 2));
  await deploy('Mock publish actual 56-product capture');
  await cp(join(artifacts, 'site'), join(artifacts, 'initial-site'), { recursive: true, force: true });
  const before = await readFile(output, 'utf8');
  assert.equal((await tick()).changed, false);
  assert.equal(await readFile(output, 'utf8'), before);

  // Only this next observation is simulated. The first cycle above is the untouched
  // real capture, and simulated prices/timestamps remain in this isolated directory.
  const next = structuredClone(capture);
  next.observedAt = new Date(Date.parse(capture.observedAt) + 60_000).toISOString();
  next.products = [next.products[0]];
  next.products[0].priceText = '$0.29～';
  next.products[0].listings += 7;
  next.products[0].imageUrl = null;
  body = JSON.stringify(next);
  const second = await tick();
  assert.equal(second.products, 56);
  assert.equal(second.addedPoints, 1);
  const updated = validateMarketObservations(JSON.parse(await readFile(output, 'utf8')));
  const changedProduct = updated.products.find(row => row.marketHashName === next.products[0].marketHashName);
  assert.equal(changedProduct.observations.length, 2);
  assert.equal(changedProduct.observations.at(-1).referencePriceText, '$0.29～');
  assert.equal(changedProduct.observations.at(-1).listings, next.products[0].listings);
  assert.equal(changedProduct.observations.at(-1).priceMinor, null);
  assert.equal(updated.products.filter(row => row.observations.at(-1).observedAt === capture.observedAt).length, 55);
  await deploy('Mock publish one simulated reobservation; retain 55 actual observations');
  const good = await readFile(output, 'utf8');
  for (const failure of ['broken', 'currency', 'conflict', 'http', 'html']) {
    status = failure === 'http' ? 429 : 200;
    contentType = failure === 'html' ? 'text/html' : 'application/json';
    if (failure === 'broken') body = '{';
    else if (failure === 'currency') body = JSON.stringify({ ...next, currency: 'JPY' });
    else if (failure === 'conflict') {
      const conflicting = structuredClone(next);
      conflicting.products[0].listings += 1;
      body = JSON.stringify(conflicting);
    } else body = '<html>Unavailable</html>';
    const beforeCalls = calls;
    await tick(false);
    assert.equal(calls, beforeCalls + 1, 'Failure must not retry');
    assert.equal(await readFile(output, 'utf8'), good, 'Normal store must survive every failure');
  }
  for (const url of ['https://steamcommunity.com/market/actions', 'https://store.steampowered.com/', 'https://feed.example/data?token=secret', 'http://127.0.0.1/data']) {
    assert.throws(() => validateFeedUrl(url));
  }
  const report = { actualProducts: 56, reportedMarketTotal: 73, complete: false,
    simulatedReobservations: 1, retainedOriginalProducts: 55,
    duplicateNoop: true, failurePreservationCases: 5,
    requests: calls, steamRequests: 0, mockGitPush: true, mockPagesDeploy: true,
    initialSite: join(artifacts, 'initial-site'), updatedSite: join(artifacts, 'site'), root };
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise(resolvePromise => server.close(resolvePromise));
}
