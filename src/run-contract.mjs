/**
 * Execute the consumer contract script with a bounded timeout.
 *
 * The contract is run as `node ./contract.mjs` inside the consumer directory.
 * stdout, stderr, exit code and signal are captured.
 *
 * Timeout detection: spawnSync sets `result.error.code === 'ETIMEDOUT'` and
 * `result.signal === 'SIGTERM'` when the timeout fires and we sent SIGTERM.
 * We treat the combination (ETIMEDOUT error code) as the definitive timeout
 * indicator.  A SIGTERM arriving from another source (no ETIMEDOUT error) is
 * recorded as a signal-terminated INCONCLUSIVE, not a timeout.
 *
 * Limitations (documented):
 * - SIGTERM is the kill signal; it can be caught by the child.  If a script
 *   traps SIGTERM and continues running, the runner will unblock when spawnSync
 *   returns (it enforces the wall-clock timeout) but the child process may
 *   continue in the background on some platforms.
 * - Descendant processes spawned by the contract are not explicitly killed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Default contract timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * @typedef {Object} ContractResult
 * @property {number|null} exitCode   Exit code; null if killed or process could not start
 * @property {string}      stdout     Captured stdout (raw, not trimmed)
 * @property {string}      stderr     Captured stderr (raw, not trimmed)
 * @property {boolean}     timedOut   True when OUR timeout killed the process (ETIMEDOUT)
 * @property {string}      signal     Signal name if process was killed by a signal, else ''
 * @property {string}      error      Spawn/infrastructure error message, else ''
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
    };
  }

  const result = spawnSync(
    process.execPath,         // same Node.js binary as the runner
    ['./contract.mjs'],
    {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGTERM',
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

  // Definitive timeout: spawnSync sets error.code === 'ETIMEDOUT' when it fires.
  // Do not rely on SIGTERM alone — an external SIGTERM would also set signal='SIGTERM'
  // but would NOT set error.code === 'ETIMEDOUT'.
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
  };
}
