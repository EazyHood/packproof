/**
 * PackProof runner — orchestrates the full pipeline for a single case:
 *
 *   1. Pack the fixture directory into an archive
 *   2. Install the archive into an isolated consumer directory
 *   3. Run the consumer contract with a bounded timeout
 *   4. Classify the outcome (PASS / FAIL / INCONCLUSIVE)
 *   5. Build and write the versioned JSON report
 *
 * Each call to runCase() is independent.  Pass different runDirs for parallel
 * or sequential multi-case runs.
 */

import { mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

import { packFixture } from './pack.mjs';
import { installTarball } from './install.mjs';
import { runContract, DEFAULT_TIMEOUT_MS } from './run-contract.mjs';
import { classify } from './classify.mjs';
import { buildReport, writeReport } from './report.mjs';

/**
 * @typedef {Object} RunCaseOptions
 * @property {string}  fixtureDir   Absolute or relative path to the fixture directory
 * @property {string}  contractFile Absolute or relative path to the contract .mjs file
 * @property {string}  runDir       Directory where all run artifacts are written
 * @property {string}  [caseName]   Human label (defaults to <fixture>+<contract>)
 * @property {number}  [timeoutMs]  Contract timeout in ms (default 15 000)
 * @property {boolean} [dryPack]    If true, skip npm pack/install (for testing the classify path)
 */

/**
 * @typedef {Object} RunCaseResult
 * @property {string} outcome     'PASS' | 'FAIL' | 'INCONCLUSIVE'
 * @property {string} reason      Human-readable reason
 * @property {string} reportPath  Absolute path to the written JSON report
 * @property {Object} report      The full report object
 */

/**
 * Run a single PackProof case end-to-end.
 *
 * @param {RunCaseOptions} options
 * @returns {RunCaseResult}
 */
export function runCase(options) {
  const {
    fixtureDir: fixtureDirRaw,
    contractFile: contractFileRaw,
    runDir: runDirRaw,
    caseName: caseNameOpt,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const fixtureDir = resolve(fixtureDirRaw);
  const contractFile = resolve(contractFileRaw);
  const runDir = resolve(runDirRaw);

  const runId = randomUUID();
  const caseName = caseNameOpt ?? `${basename(fixtureDir)}+${basename(contractFile)}`;

  // Create run-scoped subdirectories
  const archiveDir = join(runDir, 'archive');
  const consumerDir = join(runDir, 'consumer');
  const cacheDir = join(runDir, 'npm-cache');
  const reportsDir = join(runDir, 'reports');

  mkdirSync(archiveDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });

  const recordedAt = new Date().toISOString();

  // ── Step 1: Pack ────────────────────────────────────────────────────────────
  const packResult = packFixture({ fixtureDir, destDir: archiveDir });

  // ── Step 2: Install (only if pack succeeded) ────────────────────────────────
  let installResult = {
    consumerDir: null,
    contractPath: null,
    installExit: null,
    installStdout: '',
    installStderr: '',
    installedPkgDir: null,
    installedIsSymlink: false,
  };

  if (packResult.packExit === 0 && packResult.tarballPath) {
    installResult = installTarball({
      consumerDir,
      tarballPath: packResult.tarballPath,
      contractPath: contractFile,
      cacheDir,
    });
  }

  // ── Step 3: Run contract (only if install succeeded) ────────────────────────
  let contractResult = {
    exitCode: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    signal: '',
    error: packResult.packExit !== 0
      ? 'Skipped: pack failed'
      : installResult.installExit !== 0
        ? 'Skipped: install failed'
        : '',
  };

  if (packResult.packExit === 0 && installResult.installExit === 0) {
    contractResult = runContract({ consumerDir, timeoutMs });
  }

  // ── Step 4: Classify ─────────────────────────────────────────────────────────
  const { outcome, reason } = classify({
    packExit: packResult.packExit,
    installExit: installResult.installExit ?? (packResult.packExit !== 0 ? 1 : null),
    contractExit: contractResult.exitCode,
    timedOut: contractResult.timedOut,
    contractError: contractResult.error,
  });

  // ── Step 5: Build and write report ──────────────────────────────────────────
  const reportInput = {
    runId,
    caseName,
    fixtureDir,
    contractFile,
    tarballPath: packResult.tarballPath,
    archiveSHA256: packResult.archiveSHA256,
    packedFiles: packResult.packedFiles,
    packExit: packResult.packExit,
    packStdout: packResult.packStdout,
    packStderr: packResult.packStderr,
    npmVersion: packResult.npmVersion,
    nodeVersion: packResult.nodeVersion,
    consumerDir: installResult.consumerDir,
    installedPkgDir: installResult.installedPkgDir,
    installedIsSymlink: installResult.installedIsSymlink,
    installExit: installResult.installExit,
    installStdout: installResult.installStdout,
    installStderr: installResult.installStderr,
    contractExit: contractResult.exitCode,
    contractStdout: contractResult.stdout,
    contractStderr: contractResult.stderr,
    timedOut: contractResult.timedOut,
    timeoutMs,
    contractRunError: contractResult.error,
    outcome,
    outcomeReason: reason,
    recordedAt,
  };

  const report = buildReport(reportInput);
  const reportPath = join(reportsDir, `${caseName}.json`);
  writeReport(report, reportPath);

  return { outcome, reason, reportPath, report };
}
