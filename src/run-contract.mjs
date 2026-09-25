/**
 * Execute the consumer contract script with a bounded timeout.
 *
 * The contract is always run as an isolated child process (`node ./contract.mjs`)
 * so its exit code, stdout and stderr are captured independently of the runner.
 *
 * A timeout aborts the child and produces an INCONCLUSIVE result; the process
 * never hangs the runner.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Default timeout in milliseconds — generous enough for slow CI. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * @typedef {Object} ContractResult
 * @property {number|null} exitCode   Exit code; null if the process was killed
 * @property {string}      stdout     Captured stdout (trimmed)
 * @property {string}      stderr     Captured stderr (trimmed)
 * @property {boolean}     timedOut   True when the timeout was reached
 * @property {string}      signal     Kill signal if timedOut ('SIGTERM'), else ''
 * @property {string}      error      Spawn error message if the process could not start, else ''
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
    process.execPath,        // same Node.js binary as the runner
    ['./contract.mjs'],
    {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGTERM',
      shell: false,
      env: {
        ...process.env,
        // Prevent accidental global module resolution
        NODE_PATH: '',
        NODE_OPTIONS: '',
        // Disable npm update notifier if contract uses npm
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      },
    }
  );

  const timedOut = result.signal === 'SIGTERM' || result.error?.code === 'ETIMEDOUT';
  const spawnError = result.error ? result.error.message : '';

  return {
    exitCode: result.status,
    stdout: (result.stdout || '').trimEnd(),
    stderr: (result.stderr || '').trimEnd(),
    timedOut,
    signal: result.signal || '',
    error: spawnError,
  };
}
