import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { importMarketFile, PUBLIC_OBSERVATIONS_PATH } from './market-import.mjs';
import { saveFilesAtomically } from './steam-market.mjs';

const publicPath = fileURLToPath(PUBLIC_OBSERVATIONS_PATH);
const siteUrl = 'https://task-bar-cube-market.pages.dev/market-observations.json';

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

async function waitForDeployment(expectedGeneratedAt, expectedNames) {
  const deadline = Date.now() + 5 * 60_000;
  let lastReason = 'deployment not visible yet';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(siteUrl, { cache: 'no-store' });
      if (response.ok) {
        const snapshot = await response.json();
        const names = new Set(snapshot.products?.map(product => product.marketHashName));
        if (snapshot.appid === 5084200 && snapshot.generatedAt === expectedGeneratedAt
            && expectedNames.every(name => names.has(name))) return;
        lastReason = 'published JSON has not reached the new revision';
      } else lastReason = `HTTP ${response.status}`;
    } catch (error) {
      lastReason = error.message;
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10_000));
  }
  throw new Error(`Cloudflare Pages deployment was not confirmed: ${lastReason}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tempDir = await mkdtemp(join(tmpdir(), 'tbcm-market-publish-'));
  const stagedOutput = join(tempDir, 'market-observations.json');
  try {
    try { await copyFile(publicPath, stagedOutput); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
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

    if (git('branch', '--show-current') !== 'main') throw new Error('Publishing is allowed only from main');
    if (git('status', '--porcelain')) throw new Error('Working tree must be clean before publishing');
    run('git', ['fetch', 'origin', 'main']);
    if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) throw new Error('Local main must match origin/main before publishing');

    run('npm', ['run', 'market:validate']);
    run('npm', ['run', 'fx:validate']);
    const existingPublic = await readFile(publicPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    await saveFilesAtomically([{ path: publicPath, content: await readFile(stagedOutput, 'utf8') }]);
    try {
      run('npm', ['run', 'typecheck']);
      run('npm', ['run', 'build']);
    } catch (error) {
      if (existingPublic === null) await rm(publicPath, { force: true });
      else await saveFilesAtomically([{ path: publicPath, content: existingPublic }]);
      throw error;
    }

    run('git', ['add', '--', 'public/market-observations.json']);
    if (git('diff', '--cached', '--name-only')) {
      run('git', ['commit', '-m', 'Publish validated TBC market observations']);
      run('git', ['push', 'origin', 'main']);
    } else {
      console.info('No generated JSON diff; skipping commit and Pages build trigger.');
      return;
    }
    await waitForDeployment(proposed.generatedAt, proposed.products.map(product => product.marketHashName));
    console.info(`Cloudflare Pages JSON confirmed: ${siteUrl}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Market publish failed:', error.message); process.exitCode = 1; });
}
