/**
 * Execute the consumer contract script with a bounded timeout.
 *
 * The contract is run as `node ./contract.mjs` inside the consumer directory.
 * stdout, stderr, exit code, signal and elapsed duration are captured.
 *
 * Kill signal: SIGKILL is used instead of SIGTERM.  SIGTERM is catchable by
 * the child process and may not terminate it on POSIX systems.  SIGKILL cannot
 * be caught or ignored, and spawnSync enforces the wall-clock limit before
 * returning.  On Windows, spawnSync ignores killSignal and forcibly terminates
 * the process tree; SIGKILL is accepted as a valid value on all platforms.
 *
 * Limitations (documented):
 * - Descendant processes spawned by the contract are not explicitly killed on
 *   POSIX.  On Windows, Job Object containment typically terminates children.
 * - This is not a security sandbox; it is an isolated execution of trusted
 *   local fixture contracts.
 * - Only Windows behaviour has been verified by Codex; Linux behaviour is not
 *   claimed validated as of this task.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Default contract timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * @typedef {Object} ContractResult
 * @property {number|null} exitCode    Exit code; null if killed or process could not start
 * @property {string}      stdout      Captured stdout (raw, not trimmed)
 * @property {string}      stderr      Captured stderr (raw, not trimmed)
 * @property {boolean}     timedOut    True when OUR timeout killed the process (ETIMEDOUT)
 * @property {string}      signal      Signal name if process was killed by a signal, else ''
 * @property {string}      error       Spawn/infrastructure error message, else ''
 * @property {number}      elapsedMs   Wall-clock milliseconds from spawn to return
 */

/**
 * Run `node ./contract.mjs` inside a consumer directory.
 *
 * @param {Object} options
 * @param {string} options.consumerDir  Absolute path to the consumer directory
 * @param {number} [options.timeoutMs]  Kill timeout in milliseconds (default 15 000)
 * @returns {ContractResult}
 */
export function runContract({ consumerDir, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  consumerDir = resolve(consumerDir);

  if (!existsSync(consumerDir)) {
    return {
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      signal: '',
      error: `Consumer directory not found: ${consumerDir}`,
      elapsedMs: 0,
    };
  }

  const startMs = Date.now();

  const result = spawnSync(
    process.execPath,         // same Node.js binary as the runner
    ['./contract.mjs'],
    {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',  // uncatchable; replaces SIGTERM for hard termination
      shell: false,
      env: {
        ...process.env,
        // Prevent accidental global module resolution via NODE_PATH
        NODE_PATH: '',
        NODE_OPTIONS: '',
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      },
    }
  );

  const elapsedMs = Date.now() - startMs;

  // Definitive timeout: spawnSync sets error.code === 'ETIMEDOUT' when it fires.
  // SIGKILL in the signal field alongside ETIMEDOUT confirms our kill, not an
  // external signal (external SIGKILL would set signal but NOT set ETIMEDOUT).
  const timedOut = result.error?.code === 'ETIMEDOUT';

  const signal = result.signal || '';
  const errorMsg = result.error ? result.error.message : '';

  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    timedOut,
    signal,
    error: errorMsg,
    elapsedMs,
  };
}
