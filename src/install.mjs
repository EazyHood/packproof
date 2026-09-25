/** Bob's install pipeline, with Codex review corrections for exact identity.
 * Only trusted local packages; disabling lifecycle scripts is not a sandbox.
 * Every call allocates a fresh consumer. The verifier checks real isolation.
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, copyFileSync,
  lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnNpm } from './npm-runner.mjs';
import { sha256File } from './hash.mjs';

export const DEFAULT_INSTALL_TIMEOUT_MS = 120_000;

export function installTarball({ tarballPath, contractPath, cacheDir,
  expectedPackageName, runTmpDir, timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS }) {
  tarballPath = resolve(tarballPath);
  contractPath = resolve(contractPath);
  cacheDir = resolve(cacheDir);
  if (!existsSync(tarballPath)) throw new Error(`Tarball not found: ${tarballPath}`);
  if (!existsSync(contractPath)) throw new Error(`Contract file not found: ${contractPath}`);
  if (typeof expectedPackageName !== 'string' ||
      !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(expectedPackageName) ||
      expectedPackageName.split('/').some(p => p === '.' || p === '..')) {
    throw new Error('Valid package name from archive metadata is required');
  }
  const tmpParent = resolve(runTmpDir ?? tmpdir());
  mkdirSync(tmpParent, { recursive: true });
  const consumerDir = mkdtempSync(join(tmpParent, 'packproof-consumer-'));
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
    name: 'packproof-consumer', private: true, type: 'module',
  }) + '\n');
  const userConfig = join(cacheDir, 'empty-user.npmrc');
  const globalConfig = join(cacheDir, 'empty-global.npmrc');
  writeFileSync(userConfig, '');
  writeFileSync(globalConfig, '');
  const contractCopiedPath = join(consumerDir, 'contract.mjs');
  copyFileSync(contractPath, contractCopiedPath);
  let contractCopiedSHA256 = null;
  try { contractCopiedSHA256 = sha256File(contractCopiedPath); } catch { /* verifier fails closed */ }
  const args = ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund',
    '--package-lock=false', '--save=false', tarballPath];
  const start = Date.now();
  const npmResult = spawnNpm(args, { cwd: consumerDir, timeoutMs, env: {
    NPM_CONFIG_CACHE: cacheDir,
    NPM_CONFIG_USERCONFIG: userConfig,
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    NODE_PATH: '', NODE_OPTIONS: '',
  } });
  let installedPkgDir = null;
  let installedPkgName = null;
  let installedIsSymlink = false;
  let identityError = '';
  if (npmResult.status === 0 && !npmResult.error && !npmResult.timedOut) {
    const exactPath = join(consumerDir, 'node_modules', ...expectedPackageName.split('/'));
    try {
      installedIsSymlink = lstatSync(exactPath).isSymbolicLink();
      installedPkgName = JSON.parse(readFileSync(join(exactPath, 'package.json'), 'utf8')).name ?? null;
      installedPkgDir = exactPath;
      if (installedPkgName !== expectedPackageName) identityError = 'Installed package name differs from packed package';
    } catch (err) { identityError = `Cannot inspect expected installed package: ${err.message}`; }
  }
  return {
    consumerDir, contractCopiedPath, contractCopiedSHA256,
    installExit: npmResult.status,
    installStdout: npmResult.stdout,
    installStderr: npmResult.stderr,
    installSignal: npmResult.signal ?? '',
    installTimedOut: npmResult.timedOut,
    installError: npmResult.error || identityError,
    installCommand: [process.execPath, npmResult.npmCliJs, ...args],
    installElapsedMs: Date.now() - start,
    installedPkgDir, installedPkgName, installedIsSymlink,
    isolationPreconditionMet: null,
  };
}
