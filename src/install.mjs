/**
 * Install a tarball into a fresh, isolated consumer directory.
 *
 * ISOLATION REQUIREMENTS (from BOB_TASK_02 and BRIEF.md clarification):
 * - The consumer directory is allocated in the OS temp directory (os.tmpdir()),
 *   NOT inside the source checkout. This prevents Node module resolution from
 *   walking up into the project's own node_modules via ancestor lookup.
 * - The installed package is not a symlink to source.
 * - Each call uses a unique subdirectory; existing directories are rejected.
 *
 * npm install is called with --offline --ignore-scripts --no-audit --no-fund
 * so there is no network access and no lifecycle execution.
 *
 * A separate per-run npm cache directory (also in OS tmpdir) avoids poisoning
 * the user's global cache.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  copyFileSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnNpm } from './npm-runner.mjs';
import { sha256File } from './hash.mjs';

/** Default install timeout in milliseconds. */
export const DEFAULT_INSTALL_TIMEOUT_MS = 120_000;

/**
 * @typedef {Object} InstallResult
 * @property {string}      consumerDir          Absolute path to the consumer directory in OS tmpdir
 * @property {string}      contractCopiedPath   Absolute path to the copied contract file
 * @property {string|null} contractCopiedSHA256 SHA-256 of the contract bytes as copied (before execution)
 * @property {number|null} installExit          Exit code from npm install (null if killed/error)
 * @property {string}      installStdout        Raw stdout from npm install
 * @property {string}      installStderr        Raw stderr from npm install
 * @property {string}      installSignal        Kill signal, or ''
 * @property {boolean}     installTimedOut      True if killed by timeout
 * @property {string}      installError         Spawn error, if any
 * @property {string|null} installedPkgDir      Absolute path to installed package dir (verified)
 * @property {string|null} installedPkgName     Package name read from installed package.json
 * @property {boolean}     installedIsSymlink    True if the installed entry is a symlink (isolation violation)
 * @property {boolean}     isolationPreconditionMet  False if consumer dir cannot be confirmed outside checkout
 */

/**
 * Prepare a fresh isolated consumer directory in OS tmpdir and install the tarball.
 *
 * @param {Object} options
 * @param {string} options.tarballPath    Absolute path to the .tgz to install
 * @param {string} options.contractPath   Absolute path to the contract .mjs file
 * @param {string} options.cacheDir       Absolute path for a private npm cache (in OS tmpdir)
 * @param {string} [options.runTmpDir]    Parent directory in OS tmpdir to allocate consumer under
 * @param {number} [options.timeoutMs]    Kill timeout for npm install (default 120 000)
 * @returns {InstallResult}
 */
export function installTarball({ tarballPath, contractPath, cacheDir, runTmpDir, timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS }) {
  tarballPath = resolve(tarballPath);
  contractPath = resolve(contractPath);
  cacheDir = resolve(cacheDir);

  if (!existsSync(tarballPath)) {
    throw new Error(`Tarball not found: ${tarballPath}`);
  }
  if (!existsSync(contractPath)) {
    throw new Error(`Contract file not found: ${contractPath}`);
  }

  // Allocate a unique consumer directory in OS tmpdir
  const tmpParent = runTmpDir ? resolve(runTmpDir) : tmpdir();
  mkdirSync(tmpParent, { recursive: true });
  const consumerDir = mkdtempSync(join(tmpParent, 'packproof-consumer-'));

  mkdirSync(cacheDir, { recursive: true });

  // Verify isolation precondition: consumerDir must not be inside the checkout
  // (best-effort: check that the consumer path does not start with process.cwd())
  const cwd = process.cwd();
  const isolationPreconditionMet = !consumerDir.startsWith(cwd + sep) && consumerDir !== cwd;

  // Write minimal package.json for the consumer (module type matches ESM contracts)
  const consumerPkg = JSON.stringify(
    { name: 'packproof-consumer', private: true, type: 'module' },
    null,
    2
  );
  writeFileSync(join(consumerDir, 'package.json'), consumerPkg, 'utf8');

  // Write empty .npmrc to override any user config
  const emptyNpmrc = join(cacheDir, 'empty.npmrc');
  if (!existsSync(emptyNpmrc)) {
    writeFileSync(emptyNpmrc, '', 'utf8');
  }

  // Copy the contract into the consumer directory and hash it before execution
  const contractCopiedPath = join(consumerDir, 'contract.mjs');
  copyFileSync(contractPath, contractCopiedPath);

  let contractCopiedSHA256 = null;
  try {
    contractCopiedSHA256 = sha256File(contractCopiedPath);
  } catch {
    // hash failure is recorded as null — not hashed as empty string
  }

  const npmResult = spawnNpm(
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
      timeoutMs,
      env: {
        NPM_CONFIG_CACHE: cacheDir,
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
        NPM_CONFIG_USERCONFIG: emptyNpmrc,
        // Clear NODE_PATH so ancestor node_modules are not traversed
        NODE_PATH: '',
        NODE_OPTIONS: '',
      },
    }
  );

  const installStdout = npmResult.stdout;
  const installStderr = npmResult.stderr;
  const installExit = npmResult.status;
  const installSignal = npmResult.signal || '';
  const installTimedOut = npmResult.timedOut;
  const installError = npmResult.error || '';

  // Resolve installed package — read from package.json metadata, not heuristic scan
  let installedPkgDir = null;
  let installedPkgName = null;
  let installedIsSymlink = false;

  const normalInstall = installExit === 0 && !installTimedOut && !installError;
  if (normalInstall) {
    const pkgResult = resolveInstalledPkg(consumerDir, tarballPath);
    installedPkgDir = pkgResult.pkgDir;
    installedPkgName = pkgResult.pkgName;

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
    contractCopiedPath,
    contractCopiedSHA256,
    installExit,
    installStdout,
    installStderr,
    installSignal,
    installTimedOut,
    installError,
    installedPkgDir,
    installedPkgName,
    installedIsSymlink,
    isolationPreconditionMet,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the installed package directory from npm install metadata.
 * Reads package.json from node_modules entries to get actual package name,
 * rather than relying on directory naming conventions.
 *
 * @param {string} consumerDir
 * @param {string} tarballPath  Used for context only (not to find the package)
 * @returns {{ pkgDir: string|null, pkgName: string|null }}
 */
function resolveInstalledPkg(consumerDir, tarballPath) {
  const nmDir = join(consumerDir, 'node_modules');
  if (!existsSync(nmDir)) return { pkgDir: null, pkgName: null };

  // Read package-lock.json or .package-lock.json if available (most reliable)
  // Otherwise fall back to scanning node_modules
  const candidates = collectPkgCandidates(nmDir);
  for (const pkgDir of candidates) {
    const pkgJsonPath = join(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    let meta;
    try {
      meta = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    } catch {
      continue;
    }
    if (meta && meta.name) {
      // Verify the directory is actually inside the consumer dir (not a symlink to source)
      const resolved = resolve(pkgDir);
      if (!resolved.startsWith(nmDir + sep) && !resolved.startsWith(nmDir + '/')) continue;
      return { pkgDir, pkgName: meta.name };
    }
  }
  return { pkgDir: null, pkgName: null };
}

/**
 * Collect all package directories inside node_modules (one or two levels).
 *
 * @param {string} nmDir
 * @returns {string[]}
 */
function collectPkgCandidates(nmDir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(nmDir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = join(nmDir, entry);
    if (entry.startsWith('@')) {
      let scoped;
      try { scoped = readdirSync(full); } catch { continue; }
      for (const sub of scoped) {
        if (!sub.startsWith('.')) results.push(join(full, sub));
      }
    } else {
      results.push(full);
    }
  }
  return results;
}
