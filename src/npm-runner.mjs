/**
 * Portable npm execution — never uses shell:true or blindly spawns npm.cmd.
 *
 * On Windows, `spawnSync('npm.cmd', …, {shell:false})` fails with EINVAL.
 * The fix is to locate npm-cli.js and run it with `process.execPath` directly.
 *
 * Discovery order:
 *   1. NPM_EXECPATH override or npm_execpath provided by npm.
 *   2. npm-cli.js adjacent to the node executable (the standard layout).
 *   3. Standard lib/node_modules layouts relative to the Node executable.
 *
 * If none work, spawnNpm() returns status:null and an actionable message.
 *
 * Limitations (documented):
 * - `process.execPath` is used as the Node.js interpreter; it must be the same
 *   binary that can require npm-cli.js (Node.js ≥ 24 is assumed).
 * - Descendant process trees are not contained — SIGKILL is sent to the direct
 *   child.  Deeply nested hanging scripts may outlive the timeout on some hosts.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Locate npm-cli.js.  Returns absolute path or null.
 * Never throws.
 */
export function findNpmCliJs() {
  // 1. NPM_EXECPATH (set by npm when running lifecycle scripts)
  const fromEnv = process.env.NPM_EXECPATH || process.env.npm_execpath;
  if (fromEnv && existsSync(fromEnv)) return resolve(fromEnv);

  // 2. Adjacent to node.exe: <node dir>/node_modules/npm/bin/npm-cli.js
  const nodeDir = dirname(process.execPath);
  const candidate1 = join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(candidate1)) return candidate1;

  // 3. One level up: <node dir>/../lib/node_modules/npm/bin/npm-cli.js (Linux/macOS)
  const candidate2 = join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(candidate2)) return resolve(candidate2);

  // 4. Two levels up (some nvm/volta layouts)
  const candidate3 = join(nodeDir, '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(candidate3)) return resolve(candidate3);

  return null;
}

/**
 * Get an actionable description of where npm-cli.js was sought.
 */
export function npmDiscoveryMessage() {
  const nodeDir = dirname(process.execPath);
  return (
    `npm-cli.js not found. Searched:\n` +
    `  NPM_EXECPATH env: ${process.env.NPM_EXECPATH || '(not set)'}\n` +
    `  Adjacent to node: ${join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')}\n` +
    `  Set NPM_EXECPATH to the absolute path of npm-cli.js to override discovery.`
  );
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Result type returned by spawnNpm — mirrors spawnSync with clarifications.
 *
 * @typedef {Object} NpmResult
 * @property {number|null} status   Exit code (null when killed or could not start)
 * @property {string}      stdout   Raw stdout
 * @property {string}      stderr   Raw stderr
 * @property {string|null} signal   Kill signal, or null
 * @property {boolean}     timedOut True if killed by the timeout
 * @property {string}      error    Error message if the process could not start or timed out description
 * @property {string}      npmCliJs Path of npm-cli.js used (or '' if not found)
 */

/**
 * Run npm via process.execPath + npm-cli.js, shell:false, with a finite timeout.
 *
 * @param {string[]}        args        Arguments to pass to npm (e.g. ['pack', '--json'])
 * @param {Object}          opts
 * @param {string}          [opts.cwd]       Working directory
 * @param {Record<string,string>} [opts.env] Environment variables (merged onto process.env)
 * @param {number}          [opts.timeoutMs] Kill timeout in ms (default 60 000)
 * @returns {NpmResult}
 */
export function spawnNpm(args, opts = {}) {
  const { cwd, env: extraEnv = {}, timeoutMs = 60_000 } = opts;

  const npmCliJs = findNpmCliJs();
  if (!npmCliJs) {
    return {
      status: null,
      stdout: '',
      stderr: npmDiscoveryMessage(),
      signal: null,
      timedOut: false,
      error: npmDiscoveryMessage(),
      npmCliJs: '',
    };
  }

  const env = {
    ...process.env,
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    ...extraEnv,
  };

  const result = spawnSync(
    process.execPath,
    [npmCliJs, ...args],
    {
      cwd,
      encoding: 'utf8',
      shell: false,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      windowsHide: true,
      env,
    }
  );

  // Distinguish timeout from other errors
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const errorMsg = result.error ? result.error.message : '';

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    signal: result.signal || null,
    timedOut,
    error: errorMsg,
    npmCliJs,
  };
}

/**
 * Run `npm --version` and return the version string, or null on failure.
 * Uses a short probe timeout (5 s) so startup hangs don't block the runner.
 *
 * @returns {string|null}
 */
export function getNpmVersion() {
  const r = spawnNpm(['--version'], { timeoutMs: 5_000 });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return null;
}
