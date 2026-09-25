/**
 * Run `npm pack` against a fixture directory and return metadata about the
 * produced tarball.  Lifecycle scripts are disabled.
 *
 * npm pack --json writes a JSON array to stdout:
 *   [{ filename, name, version, files: [{path,size,...},...], ... }]
 *
 * No fallback to scanning the destination directory — if the JSON metadata is
 * missing or the named file does not exist, the result is INCONCLUSIVE.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256File } from './hash.mjs';
import { spawnNpm, getNpmVersion } from './npm-runner.mjs';

/** Default pack timeout in milliseconds. */
export const DEFAULT_PACK_TIMEOUT_MS = 60_000;

/**
 * @typedef {Object} PackResult
 * @property {string|null} tarballPath     Absolute path to the produced .tgz (null on failure)
 * @property {string|null} archiveSHA256   Uppercase hex SHA-256 of the tarball (null on failure)
 * @property {string[]}    packedFiles     Relative paths of files inside the archive
 * @property {string|null} packageName     Package name from npm pack metadata
 * @property {string}      packStdout      Raw stdout from npm pack
 * @property {string}      packStderr      Raw stderr from npm pack
 * @property {number|null} packExit        Exit code from npm pack (null if killed)
 * @property {string}      packSignal      Kill signal, or ''
 * @property {boolean}     packTimedOut    True if npm pack was killed by timeout
 * @property {string}      packError       Spawn error message, if any
 * @property {string|null} npmVersion      npm version string (null if discovery failed)
 * @property {string}      nodeVersion     Node.js version string
 * @property {string}      npmCliJs        Path to npm-cli.js used
 */

/**
 * Pack a fixture directory using npm pack --json.
 *
 * @param {Object} options
 * @param {string} options.fixtureDir   Absolute path to the fixture directory
 * @param {string} options.destDir      Absolute path where the tarball should land
 * @param {number} [options.timeoutMs]  Kill timeout for npm pack (default 60 000)
 * @returns {PackResult}
 */
export function packFixture({ fixtureDir, destDir, timeoutMs = DEFAULT_PACK_TIMEOUT_MS }) {
  fixtureDir = resolve(fixtureDir);
  destDir = resolve(destDir);

  if (!existsSync(fixtureDir)) {
    throw new Error(`Fixture directory not found: ${fixtureDir}`);
  }
  if (!existsSync(join(fixtureDir, 'package.json'))) {
    throw new Error(`No package.json found in fixture directory: ${fixtureDir}`);
  }

  mkdirSync(destDir, { recursive: true });

  const npmVersion = getNpmVersion();

  const npmResult = spawnNpm(
    ['pack', '--ignore-scripts', '--json', '--pack-destination', destDir],
    {
      cwd: fixtureDir,
      timeoutMs,
      env: {
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
        // Do not pass --offline here; pack reads the local package.json only.
        NPM_CONFIG_OFFLINE: 'false',
      },
    }
  );

  const packStdout = npmResult.stdout;
  const packStderr = npmResult.stderr;
  const packExit = npmResult.status;
  const packSignal = npmResult.signal || '';
  const packTimedOut = npmResult.timedOut;
  const packError = npmResult.error || '';

  const normalExit = packExit === 0 && !packTimedOut && !packError;

  if (!normalExit) {
    return {
      tarballPath: null,
      archiveSHA256: null,
      packedFiles: [],
      packageName: null,
      packStdout,
      packStderr,
      packExit,
      packSignal,
      packTimedOut,
      packError,
      npmVersion,
      nodeVersion: process.version,
      npmCliJs: npmResult.npmCliJs,
    };
  }

  // Parse npm pack JSON output — strict: no fallback to directory scan
  let packData = [];
  let parseError = '';
  try {
    packData = JSON.parse(packStdout);
  } catch (e) {
    parseError = `Failed to parse npm pack JSON: ${e.message}`;
  }

  if (parseError || !Array.isArray(packData) || packData.length === 0) {
    return {
      tarballPath: null,
      archiveSHA256: null,
      packedFiles: [],
      packageName: null,
      packStdout,
      packStderr,
      packExit: parseError ? 1 : packExit,
      packSignal,
      packTimedOut,
      packError: parseError || 'npm pack produced no metadata',
      npmVersion,
      nodeVersion: process.version,
      npmCliJs: npmResult.npmCliJs,
    };
  }

  const entry = packData[0];
  const tarballPath = join(destDir, entry.filename);
  const packageName = entry.name || null;
  const packedFiles = Array.isArray(entry.files) ? entry.files.map((f) => f.path) : [];

  // Strict: verify the named file exists — no substitution
  if (!existsSync(tarballPath)) {
    return {
      tarballPath: null,
      archiveSHA256: null,
      packedFiles,
      packageName,
      packStdout,
      packStderr,
      packExit: 1,
      packSignal,
      packTimedOut,
      packError: `npm pack reported filename '${entry.filename}' but file not found at: ${tarballPath}`,
      npmVersion,
      nodeVersion: process.version,
      npmCliJs: npmResult.npmCliJs,
    };
  }

  const archiveSHA256 = sha256File(tarballPath);

  return {
    tarballPath,
    archiveSHA256,
    packedFiles,
    packageName,
    packStdout,
    packStderr,
    packExit,
    packSignal,
    packTimedOut,
    packError,
    npmVersion,
    nodeVersion: process.version,
    npmCliJs: npmResult.npmCliJs,
  };
}
