/**
 * Install a tarball into a fresh, isolated consumer directory.
 *
 * The consumer directory is created with a minimal package.json and the
 * contract is copied in.  npm install is called with --offline --ignore-scripts
 * --no-audit --no-fund so there is no network access and no lifecycle execution.
 *
 * A separate npm cache directory is used per run to avoid poisoning the
 * user's global cache.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  lstatSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * @typedef {Object} InstallResult
 * @property {string}  consumerDir      Absolute path to the consumer directory
 * @property {string}  contractPath     Absolute path to the copied contract file
 * @property {number}  installExit      Exit code from npm install
 * @property {string}  installStdout    Raw stdout from npm install
 * @property {string}  installStderr    Raw stderr from npm install
 * @property {string|null} installedPkgDir  Resolved path inside node_modules (best-effort)
 * @property {boolean} installedIsSymlink   True if the installed entry is a symlink
 */

/**
 * Prepare consumer directory and install the tarball.
 *
 * @param {Object} options
 * @param {string} options.consumerDir   Directory to create for the consumer
 * @param {string} options.tarballPath   Absolute path to the .tgz to install
 * @param {string} options.contractPath  Absolute path to the contract .mjs file
 * @param {string} options.cacheDir      Absolute path for a private npm cache
 * @param {string} [options.moduleType]  'module' or 'commonjs' — defaults to 'module'
 * @returns {InstallResult}
 */
export function installTarball({ consumerDir, tarballPath, contractPath, cacheDir, moduleType = 'module' }) {
  consumerDir = resolve(consumerDir);
  tarballPath = resolve(tarballPath);
  contractPath = resolve(contractPath);
  cacheDir = resolve(cacheDir);

  if (!existsSync(tarballPath)) {
    throw new Error(`Tarball not found: ${tarballPath}`);
  }
  if (!existsSync(contractPath)) {
    throw new Error(`Contract file not found: ${contractPath}`);
  }

  mkdirSync(consumerDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });

  // Write minimal package.json for the consumer
  const consumerPkg = JSON.stringify(
    { name: 'packproof-consumer', private: true, type: moduleType },
    null,
    2
  );
  writeFileSync(join(consumerDir, 'package.json'), consumerPkg, 'utf8');

  // Write empty .npmrc to override any user config
  const emptyNpmrc = join(cacheDir, 'empty.npmrc');
  if (!existsSync(emptyNpmrc)) {
    writeFileSync(emptyNpmrc, '', 'utf8');
  }

  // Copy the contract into the consumer directory
  const destContract = join(consumerDir, 'contract.mjs');
  copyFileSync(contractPath, destContract);

  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const installResult = spawnSync(
    npmBin,
    [
      'install',
      '--ignore-scripts',
      '--offline',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--save=false',
      tarballPath,
    ],
    {
      cwd: consumerDir,
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        NPM_CONFIG_CACHE: cacheDir,
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
        NPM_CONFIG_USERCONFIG: emptyNpmrc,
        NODE_PATH: '',
        NODE_OPTIONS: '',
      },
    }
  );

  const installStdout = installResult.stdout || '';
  const installStderr = installResult.stderr || '';
  const installExit = installResult.status ?? 1;

  // Attempt to resolve installed package path (best-effort)
  let installedPkgDir = null;
  let installedIsSymlink = false;

  if (installExit === 0) {
    const nmDir = join(consumerDir, 'node_modules');
    installedPkgDir = findInstalledPkg(nmDir);
    if (installedPkgDir) {
      try {
        const stat = lstatSync(installedPkgDir);
        installedIsSymlink = stat.isSymbolicLink();
      } catch {
        // ignore stat errors
      }
    }
  }

  return {
    consumerDir,
    contractPath: destContract,
    installExit,
    installStdout,
    installStderr,
    installedPkgDir,
    installedIsSymlink,
  };
}

/**
 * Heuristically locate the first installed package directory inside node_modules.
 * Handles both `node_modules/@scope/name` and `node_modules/name` layouts.
 *
 * @param {string} nmDir  Path to node_modules
 * @returns {string|null}
 */
function findInstalledPkg(nmDir) {
  if (!existsSync(nmDir)) return null;
  let entries;
  try {
    entries = readdirSync(nmDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = join(nmDir, entry);
    if (entry.startsWith('@')) {
      // scoped package: look one level deeper
      let scoped;
      try {
        scoped = readdirSync(full);
      } catch {
        continue;
      }
      for (const sub of scoped) {
        if (sub.startsWith('.')) continue;
        const pkg = join(full, sub);
        if (existsSync(join(pkg, 'package.json'))) return pkg;
      }
    } else {
      if (existsSync(join(full, 'package.json'))) return full;
    }
  }
  return null;
}
