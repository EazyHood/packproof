/**
 * Run `npm pack` against a fixture directory and return metadata about the
 * produced tarball.  Lifecycle scripts are disabled.
 *
 * npm pack --json writes a JSON array to stdout where each element has the
 * shape: [{ filename, files: [{path,size},...], name, version, ... }]
 */

import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { sha256File } from './hash.mjs';

/**
 * @typedef {Object} PackResult
 * @property {string} tarballPath    Absolute path to the produced .tgz
 * @property {string} archiveSHA256  Uppercase hex SHA-256 of the tarball
 * @property {string[]} packedFiles  Relative paths of files inside the archive
 * @property {string} packStdout     Raw stdout from npm pack
 * @property {string} packStderr     Raw stderr from npm pack
 * @property {number} packExit       Exit code from npm pack
 * @property {string} npmVersion     npm version string reported by npm
 * @property {string} nodeVersion    Node.js version string
 */

/**
 * Pack a fixture directory.
 *
 * @param {Object} options
 * @param {string} options.fixtureDir  Absolute path to the fixture directory
 * @param {string} options.destDir     Absolute path where the tarball should land
 * @returns {PackResult}
 */
export function packFixture({ fixtureDir, destDir }) {
  fixtureDir = resolve(fixtureDir);
  destDir = resolve(destDir);

  if (!existsSync(fixtureDir)) {
    throw new Error(`Fixture directory not found: ${fixtureDir}`);
  }
  if (!existsSync(join(fixtureDir, 'package.json'))) {
    throw new Error(`No package.json found in fixture directory: ${fixtureDir}`);
  }

  // npm executable: on Windows npm is npm.cmd
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const npmVersionResult = spawnSync(npmBin, ['--version'], {
    encoding: 'utf8',
    shell: false,
  });
  const npmVersion = (npmVersionResult.stdout || '').trim();

  const result = spawnSync(
    npmBin,
    ['pack', '--ignore-scripts', '--json', '--pack-destination', destDir],
    {
      cwd: fixtureDir,
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
        // Disable any user .npmrc that could have problematic settings
        NPM_CONFIG_OFFLINE: 'false',
      },
    }
  );

  const packStdout = result.stdout || '';
  const packStderr = result.stderr || '';
  const packExit = result.status ?? 1;

  if (packExit !== 0) {
    return {
      tarballPath: null,
      archiveSHA256: null,
      packedFiles: [],
      packStdout,
      packStderr,
      packExit,
      npmVersion,
      nodeVersion: process.version,
    };
  }

  // Parse npm pack JSON output
  let packData = [];
  try {
    packData = JSON.parse(packStdout);
  } catch {
    // If JSON parse fails we fall back to scanning destDir
  }

  // Find the tarball
  let tarballPath = null;
  let packedFiles = [];

  if (Array.isArray(packData) && packData.length > 0) {
    const entry = packData[0];
    // npm pack reports the filename relative to where it was written
    tarballPath = join(destDir, entry.filename);
    if (Array.isArray(entry.files)) {
      packedFiles = entry.files.map((f) => f.path);
    }
  }

  // Fallback: find single .tgz in dest
  if (!tarballPath || !existsSync(tarballPath)) {
    const tgzFiles = readdirSync(destDir).filter((f) => f.endsWith('.tgz'));
    if (tgzFiles.length === 1) {
      tarballPath = join(destDir, tgzFiles[0]);
    } else if (tgzFiles.length > 1) {
      // Use most-recently modified
      tarballPath = join(destDir, tgzFiles[tgzFiles.length - 1]);
    } else {
      tarballPath = null;
    }
  }

  const archiveSHA256 = tarballPath && existsSync(tarballPath) ? sha256File(tarballPath) : null;

  return {
    tarballPath,
    archiveSHA256,
    packedFiles,
    packStdout,
    packStderr,
    packExit,
    npmVersion,
    nodeVersion: process.version,
  };
}
