/**
 * PackProof runner — orchestrates the full pipeline for a single case:
 *
 *   1. Create a unique run subdirectory under the artifact parent
 *   2. Pack the fixture directory into an archive (in the run dir)
 *   3. Install the archive into a fresh isolated consumer in OS tmpdir
 *   4. Run the consumer contract with a bounded timeout
 *   5. Classify the outcome (PASS / FAIL / INCONCLUSIVE)
 *   6. Build and write the versioned JSON report (in the run dir)
 *
 * Isolation: archive directories live under the artifact parent (inside the
 * project checkout is fine); consumer directories are allocated in OS tmpdir
 * to prevent ancestor node_modules resolution.
 *
 * Safety: caseName is a metadata label only — it NEVER controls filesystem
 * paths.  The run directory is named by the runId (UUID), not the caseName.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

import { packFixture } from './pack.mjs';
import { installTarball } from './install.mjs';
import { runContract, DEFAULT_TIMEOUT_MS } from './run-contract.mjs';
import { classify } from './classify.mjs';
import { buildReport, writeReport } from './report.mjs';

/**
 * @typedef {Object} RunCaseOptions
 * @property {string}  fixtureDir    Absolute or relative path to the fixture directory
 * @property {string}  contractFile  Absolute or relative path to the contract .mjs file
 * @property {string}  artifactDir   Parent directory where the unique run subdirectory is created
 * @property {string}  [caseName]    Metadata label only (default: <fixture>+<contract>)
 * @property {number}  [timeoutMs]   Contract timeout in ms (default 15 000)
 */

/**
 * @typedef {Object} RunCaseResult
 * @property {string} outcome     'PASS' | 'FAIL' | 'INCONCLUSIVE'
 * @property {string} reason      Human-readable reason
 * @property {string} reportPath  Absolute path to the written JSON report
 * @property {string} runDir      Absolute path to the unique run subdirectory
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
    artifactDir: artifactDirRaw,
    caseName: caseNameOpt,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const fixtureDir = resolve(fixtureDirRaw);
  const contractFile = resolve(contractFileRaw);
  const artifactDir = resolve(artifactDirRaw);

  const runId = randomUUID();
  // caseName is metadata; the run directory is named by runId to prevent path traversal
  const caseName = caseNameOpt ?? `${basename(fixtureDir)}+${basename(contractFile)}`;

  // Create a unique run directory under the artifact parent
  const runDir = join(artifactDir, runId);
  if (existsSync(runDir)) {
    // Collision with an existing run — should never happen with UUID
    throw new Error(`Run directory already exists: ${runDir}`);
  }
  mkdirSync(runDir, { recursive: true });

  // Archive directory is inside the run dir (safe to keep inside checkout)
  const archiveDir = join(runDir, 'archive');
  mkdirSync(archiveDir, { recursive: true });

  // npm cache is in OS tmpdir (outside checkout)
  const cacheDir = join(tmpdir(), `packproof-cache-${runId}`);

  const recordedAt = new Date().toISOString();

  // ── Step 1: Pack ─────────────────────────────────────────────────────────────
  const packResult = packFixture({ fixtureDir, destDir: archiveDir });

  const packSucceeded = packResult.packExit === 0 &&
    !packResult.packTimedOut &&
    !packResult.packError &&
    packResult.tarballPath !== null;

  // ── Step 2: Install (only if pack succeeded) ──────────────────────────────────
  let installResult = {
    consumerDir: null,
    contractCopiedPath: null,
    contractCopiedSHA256: null,
    installExit: null,
    installStdout: '',
    installStderr: '',
    installSignal: '',
    installTimedOut: false,
    installError: packSucceeded ? '' : 'Skipped: pack failed',
    installedPkgDir: null,
    installedPkgName: null,
    installedIsSymlink: false,
    isolationPreconditionMet: false,
  };

  if (packSucceeded) {
    installResult = installTarball({
      tarballPath: packResult.tarballPath,
      contractPath: contractFile,
      cacheDir,
      // runTmpDir: use OS default (tmpdir()); can be overridden for tests
    });
  }

  const installSucceeded = installResult.installExit === 0 &&
    !installResult.installTimedOut &&
    !installResult.installError;

  // ── Step 3: Run contract (only if install succeeded) ──────────────────────────
  let contractResult = {
    exitCode: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    signal: '',
    error: packSucceeded
      ? (installSucceeded ? '' : 'Skipped: install failed')
      : 'Skipped: pack failed',
  };

  if (packSucceeded && installSucceeded) {
    contractResult = runContract({
      consumerDir: installResult.consumerDir,
      timeoutMs,
    });
  }

  // ── Step 4: Classify ──────────────────────────────────────────────────────────
  const packExitForClassify = packResult.packExit ?? (packResult.packTimedOut ? null : 1);
  const installExitForClassify = packSucceeded
    ? (installResult.installExit ?? (installResult.installTimedOut ? null : 1))
    : null;

  const { outcome, reason } = classify({
    packExit: packExitForClassify,
    installExit: installExitForClassify,
    contractExit: contractResult.exitCode,
    timedOut: contractResult.timedOut,
    contractSignal: contractResult.signal,
    contractError: contractResult.error,
  });

  // ── Step 5: Build and write report ────────────────────────────────────────────
  // contractCopiedSHA256 comes from installResult — it was hashed BEFORE execution
  const reportInput = {
    runId,
    caseName,
    fixtureDir,
    contractFile,
    contractCopiedPath: installResult.contractCopiedPath,
    contractCopiedSHA256: installResult.contractCopiedSHA256,
    tarballPath: packResult.tarballPath,
    archiveSHA256: packResult.archiveSHA256,
    packedFiles: packResult.packedFiles,
    packageName: packResult.packageName,
    packExit: packResult.packExit,
    packSignal: packResult.packSignal,
    packTimedOut: packResult.packTimedOut,
    packError: packResult.packError,
    packStdout: packResult.packStdout,
    packStderr: packResult.packStderr,
    npmVersion: packResult.npmVersion,
    nodeVersion: packResult.nodeVersion,
    npmCliJs: packResult.npmCliJs,
    consumerDir: installResult.consumerDir,
    isolationPreconditionMet: installResult.isolationPreconditionMet,
    installedPkgDir: installResult.installedPkgDir,
    installedPkgName: installResult.installedPkgName,
    installedIsSymlink: installResult.installedIsSymlink,
    installExit: installResult.installExit,
    installSignal: installResult.installSignal,
    installTimedOut: installResult.installTimedOut,
    installError: installResult.installError,
    installStdout: installResult.installStdout,
    installStderr: installResult.installStderr,
    contractExit: contractResult.exitCode,
    contractSignal: contractResult.signal,
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
  // report.json — fixed name, not derived from caseName
  const reportPath = join(runDir, 'report.json');
  writeReport(report, reportPath);

  return { outcome, reason, reportPath, runDir, report };
}
