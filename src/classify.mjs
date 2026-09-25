/**
 * Classify a consumer run into one of three outcomes:
 *
 *   PASS          Contract exited 0, no timeout, no infrastructure error.
 *   FAIL          Contract exited non-zero and it was not an infrastructure error.
 *   INCONCLUSIVE  Timeout, runner/infrastructure error, or pack/install failure.
 *
 * Design note (from BRIEF.md): "Missing reports, skipped checks and timeouts
 * are never passes."  A failing contract is FAIL, not INCONCLUSIVE, even if the
 * failure was intentionally expected by the test design.
 */

/** @enum {string} */
export const Outcome = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  INCONCLUSIVE: 'INCONCLUSIVE',
});

/**
 * @typedef {Object} ClassifyInput
 * @property {number|null} packExit        Exit code from npm pack (null = not run)
 * @property {number|null} installExit     Exit code from npm install (null = not run)
 * @property {number|null} contractExit    Exit code from contract (null = process could not start)
 * @property {boolean}     timedOut        True when the contract was killed by timeout
 * @property {string}      contractError   Spawn error message, if any (e.g. ENOENT for node)
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
export function classify({ packExit, installExit, contractExit, timedOut, contractError }) {
  // Pack failure
  if (packExit !== 0) {
    return {
      outcome: Outcome.INCONCLUSIVE,
      reason: `npm pack exited ${packExit}; archive was not produced`,
    };
  }

  // Install failure (null means it was not attempted — treat as failure)
  if (installExit == null || installExit !== 0) {
    return {
      outcome: Outcome.INCONCLUSIVE,
      reason: `npm install exited ${installExit}; consumer environment could not be prepared`,
    };
  }

  // Contract process could not start (e.g. node not found, contract.mjs missing)
  if (contractError && contractExit === null) {
    return {
      outcome: Outcome.INCONCLUSIVE,
      reason: `Contract process failed to start: ${contractError}`,
    };
  }

  // Timeout — never a pass regardless of intent
  if (timedOut) {
    return {
      outcome: Outcome.INCONCLUSIVE,
      reason: 'Contract exceeded the allowed timeout and was killed',
    };
  }

  // Contract ran to completion
  if (contractExit === 0) {
    return {
      outcome: Outcome.PASS,
      reason: 'Contract exited 0',
    };
  }

  return {
    outcome: Outcome.FAIL,
    reason: `Contract exited ${contractExit}`,
  };
}
