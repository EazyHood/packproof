/**
 * Classify a consumer run into one of three outcomes:
 *
 *   PASS          Contract exited 0, all prerequisites pass, no timeout or error.
 *   FAIL          Contract exited non-zero without infrastructure error.
 *   INCONCLUSIVE  Any infrastructure/runner problem: pack failure, install
 *                 failure, prerequisite failure, spawn error, timeout, signal,
 *                 or unknown completion.
 *
 * Classification rules (in order of precedence):
 *   1. Pack failure           → INCONCLUSIVE
 *   2. Install failure        → INCONCLUSIVE
 *   3. Prerequisite failure   → INCONCLUSIVE  (isolation/identity/contractHash)
 *   4. Changed contract hash  → INCONCLUSIVE  (post-execution check)
 *   5. Timeout                → INCONCLUSIVE  (before spawn-error check)
 *   6. Spawn error            → INCONCLUSIVE
 *   7. Signal (non-timeout)   → INCONCLUSIVE
 *   8. Unknown exit (null)    → INCONCLUSIVE  (unknown completion ≠ pass)
 *   9. Exit 0                 → PASS
 *  10. Exit non-zero          → FAIL
 *
 * Design note (from BRIEF.md): "Missing reports, skipped checks and timeouts
 * are never passes."  An intentionally failing contract is FAIL, not INCONCLUSIVE.
 * Contract process exit is preserved in the report regardless of overall outcome.
 */

/** @enum {string} */
export const Outcome = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  INCONCLUSIVE: 'INCONCLUSIVE',
});

/**
 * @typedef {Object} ClassifyInput
 * @property {number|null} packExit          Exit code from npm pack (null = killed/error)
 * @property {number|null} installExit       Exit code from npm install (null = not run or killed)
 * @property {number|null} contractExit      Exit code from contract (null = not run/killed/unknown)
 * @property {boolean}     timedOut          True when the contract was killed by our timeout
 * @property {string}      contractSignal    Kill signal received by contract process, or ''
 * @property {string}      contractError     Spawn error message, if any (e.g. ENOENT for node)
 * @property {string|null} prereqFailure     First failing required prerequisite reason, or null
 * @property {string|null} contractHashChanged  Post-execution hash change reason, or null
 */

/**
 * @typedef {Object} ClassifyResult
 * @property {string} outcome   One of 'PASS', 'FAIL', 'INCONCLUSIVE'
 * @property {string} reason    Human-readable reason for the classification
 */

/**
 * Classify the outcome of a single run.
 *
 * @param {ClassifyInput} input
 * @returns {ClassifyResult}
 */
export function classify({
  packExit,
  installExit,
  contractExit,
  timedOut,
  contractSignal = '',
  contractError = '',
  prereqFailure = null,
  contractHashChanged = null,
}) {
  // 1. Pack failure
  if (packExit == null || packExit !== 0) {
    return {
      outcome: Outcome.INCONCLUSIVE,
      reason: `npm pack exited ${packExit}; archive was not produced`,
    };
  }

  // 2. Install failure (null means not attempted or killed)
  if (installExit == null || installExit !== 0) {
    return {
      outcome: Outcome.INCONCLUSIVE,
      reason: `npm install exited ${installExit}; consumer environment could not be prepared`,
    };
  }

  // 3. Prerequisite failure (isolation / identity / pre-execution contractHash)
  if (prereqFailure) {
    return {
      outcome: Outcome.INCONCLUSIVE,
      reason: `Prerequisite check failed: ${prereqFailure}`,
    };
  }

  // 4. Contract hash changed post-execution (evidence integrity)
  if (contractHashChanged) {
    return {
      outcome: Outcome.INCONCLUSIVE,
      reason: `Contract bytes changed after execution: ${contractHashChanged}`,
    };
  }

  // 5. Timeout — must be checked BEFORE generic spawn error (a timeout also sets an error)
  if (timedOut) {
    return {
      outcome: Outcome.INCONCLUSIVE,
      reason: 'Contract exceeded the allowed timeout and was killed',
    };
  }

  // 6. Spawn error (process could not start or had an infrastructure error)
  if (contractError) {
    return {
      outcome: Outcome.INCONCLUSIVE,
      reason: `Contract process could not start or had an infrastructure error: ${contractError}`,
    };
  }

  // 7. Signal from a cause other than our timeout (e.g. OOM kill, external SIGKILL)
  if (contractSignal) {
    return {
      outcome: Outcome.INCONCLUSIVE,
      reason: `Contract terminated by signal ${contractSignal}`,
    };
  }

  // 8. Unknown completion (null exit without any of the above — do not treat as pass)
  if (!Number.isInteger(contractExit) || contractExit < 0) {
    return {
      outcome: Outcome.INCONCLUSIVE,
      reason: 'Contract exit code unknown (null); completion unverified',
    };
  }

  // 9. Contract ran to completion with exit 0
  if (contractExit === 0) {
    return {
      outcome: Outcome.PASS,
      reason: 'Contract exited 0',
    };
  }

  // 10. Non-zero exit — genuine contract failure (e.g. assertion, wrong expectation, ENOENT)
  return {
    outcome: Outcome.FAIL,
    reason: `Contract exited ${contractExit}`,
  };
}
