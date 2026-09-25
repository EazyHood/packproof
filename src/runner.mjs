/**
 * PackProof runner — orchestrates the full pipeline for a single case:
 *
 *   1. Create a unique run subdirectory under the artifact parent
 *   2. Pack the fixture directory into an archive (in the run dir)
 *   3. Install the archive into a fresh isolated consumer in OS tmpdir
 *   4. Verify isolation, identity and contract integrity prerequisites
 *   5. Run the consumer contract (blocked when required prerequisites fail)
 *   6. Re-check contract hash after execution
 *   7. Classify the outcome (PASS / FAIL / INCONCLUSIVE)
 *   8. Build and write the versioned JSON report (in the run dir)
 *
 * Isolation: archive directories live under the artifact parent (inside the
 * project checkout is fine); consumer directories are allocated in OS tmpdir
 * to prevent ancestor node_modules resolution.
 *
 * Safety: caseName is a metadata label only — it NEVER controls filesystem
 * paths.  The run directory is named by the runId (UUID), not the caseName.
 *
 * Prerequisites (isolation, identity, contractHash) are required for PASS.
 * If any fails, the overall outcome is INCONCLUSIVE even when contract exit is 0.
 * Contract process exit and stdout/stderr are preserved in the report regardless.
 *
 * Source baseline: when runSourceBaseline: true is passed, runner executes
 * validation-fixtures/source-tests.test.mjs via Node with a bound and records
 * the result separately.  This is not a consumer run; it does not affect
 * individual case outcomes.  In single-case mode without the flag, the source
 * baseline is marked 'not-run', never PASS.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { packFixture } from './pack.mjs';
import { installTarball } from './install.mjs';
import { runContract, DEFAULT_TIMEOUT_MS } from './run-contract.mjs';
import { classify } from './classify.mjs';
import { verifyRun } from './verify.mjs';
import { buildReport, writeReport } from './report.mjs';
import { sha256File } from './hash.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), '..');

/** Timeout for the source baseline test run (ms). */
const SOURCE_BASELINE_TIMEOUT_MS = 30_000;

/**
 * @typedef {Object} RunCaseOptions
 * @property {string}  fixtureDir          Absolute or relative path to the fixture directory
 * @property {string}  contractFile        Absolute or relative path to the contract .mjs file
 * @property {string}  artifactDir         Parent directory where the unique run subdirectory is created
 * @property {string}  [caseName]          Metadata label only (default: <fixture>+<contract>)
 * @property {number}  [timeoutMs]         Contract timeout in ms (default 15 000)
 * @property {boolean} [runSourceBaseline] Run source-tests.test.mjs and record result (default false)
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
    runSourceBaseline = false,
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
      expectedPackageName: packResult.packageName,
    });
  }

  const installSucceeded = installResult.installExit === 0 &&
    !installResult.installTimedOut &&
    !installResult.installError;

  // ── Step 3: Verify prerequisites ─────────────────────────────────────────────
  const verificationInput = {
    consumerDir: installResult.consumerDir,
    fixtureDir,
    installedPkgDir: installResult.installedPkgDir,
    installedPkgName: installResult.installedPkgName,
    expectedPackageName: packResult.packageName,
    installedIsSymlink: installResult.installedIsSymlink,
    contractCopiedPath: installResult.contractCopiedPath,
    contractCopiedSHA256: installResult.contractCopiedSHA256,
    tarballPath: packResult.tarballPath,
    archiveSHA256: packResult.archiveSHA256,
  };
  let verifyResult = null;
  if (installSucceeded) {
    verifyResult = verifyRun(verificationInput);
  }

  // Required prerequisites: if any fail, skip contract execution
  const prereqsMet = verifyResult !== null && verifyResult.allRequired;

  // ── Step 4: Run contract (only if install succeeded AND prerequisites pass) ────
  let contractResult = {
    exitCode: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    signal: '',
    error: packSucceeded
      ? (installSucceeded
          ? (prereqsMet ? '' : `Skipped: prerequisite check failed — ${verifyResult?.failureReason}`)
          : 'Skipped: install failed')
      : 'Skipped: pack failed',
    elapsedMs: 0,
  };

  if (packSucceeded && installSucceeded && prereqsMet) {
    contractResult = runContract({
      consumerDir: installResult.consumerDir,
      timeoutMs,
    });
  }

  // ── Step 5: Post-execution contract hash check ────────────────────────────────
  // Re-run contractHash verification after execution; pass updated result to report.
  let verifyAfter = null;
  if (verifyResult !== null) {
    // Trusted code can still change files accidentally. Recheck the complete
    // evidence set, and keep both observations instead of assuming static state.
    const after = verifyRun(verificationInput);
    verifyAfter = { ...after, before: verifyResult, contractHashAfter: after.contractHash };
  }

  // ── Step 6: Classify ──────────────────────────────────────────────────────────
  const packExitForClassify = packResult.packExit ?? (packResult.packTimedOut ? null : 1);
  const installExitForClassify = packSucceeded
    ? (installResult.installExit ?? (installResult.installTimedOut ? null : 1))
    : null;

  // Prerequisite failures (isolation, identity, contractHash) block PASS
  const prereqFailure = verifyResult !== null && !verifyResult.allRequired
    ? verifyResult.failureReason
    : verifyAfter !== null && !verifyAfter.allRequired
      ? `Post-execution verification: ${verifyAfter.failureReason}`
      : null;

  // Changed contract after execution — also blocks PASS
  const contractHashChanged = verifyAfter && verifyAfter.contractHashAfter.status !== 'pass'
    ? verifyAfter.contractHashAfter.reason
    : null;

  const { outcome, reason } = classify({
    packExit: packExitForClassify,
    installExit: installExitForClassify,
    contractExit: contractResult.exitCode,
    timedOut: contractResult.timedOut,
    contractSignal: contractResult.signal,
    contractError: contractResult.error,
    prereqFailure,
    contractHashChanged,
  });

  // ── Step 7: Source baseline (optional) ────────────────────────────────────────
  const sourceBaseline = runSourceBaseline
    ? runSourceBaselineCheck(timeoutMs)
    : { status: 'not-run', reason: 'Source baseline not requested in single-case mode' };

  // ── Step 8: Build and write report ────────────────────────────────────────────
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
    isolationPreconditionMet: (verifyAfter ?? verifyResult)?.isolation.status === 'pass',
    installedPkgDir: installResult.installedPkgDir,
    installedPkgName: installResult.installedPkgName,
    installedIsSymlink: installResult.installedIsSymlink,
    installExit: installResult.installExit,
    installSignal: installResult.installSignal,
    installTimedOut: installResult.installTimedOut,
    installError: installResult.installError,
    installStdout: installResult.installStdout,
    installStderr: installResult.installStderr,
    installElapsedMs: installResult.installElapsedMs,
    packElapsedMs: packResult.packElapsedMs,
    verify: verifyAfter ?? verifyResult,
    contractExit: contractResult.exitCode,
    contractSignal: contractResult.signal,
    contractStdout: contractResult.stdout,
    contractStderr: contractResult.stderr,
    timedOut: contractResult.timedOut,
    contractElapsedMs: contractResult.elapsedMs,
    timeoutMs,
    contractRunError: contractResult.error,
    outcome,
    outcomeReason: reason,
    recordedAt,
    sourceBaseline,
    commands: {
      pack: [process.execPath, packResult.npmCliJs, 'pack', '--ignore-scripts', '--json', '--pack-destination', archiveDir],
      install: installResult.installCommand ?? null,
      contract: contractResult.command ?? null,
    },
  };

  const report = buildReport(reportInput);
  // report.json — fixed name, not derived from caseName
  const reportPath = join(runDir, 'report.json');
  writeReport(report, reportPath);

  return { outcome, reason, reportPath, runDir, report };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Execute the frozen source-tests.test.mjs baseline and return a record.
 * The result is stored as separate evidence; it does not change consumer outcomes.
 *
 * @param {number} boundMs  Timeout for the baseline run
 * @returns {Object}
 */
function runSourceBaselineCheck(boundMs = SOURCE_BASELINE_TIMEOUT_MS) {
  const scriptPath = join(PROJECT_ROOT, 'validation-fixtures', 'source-tests.test.mjs');

  if (!existsSync(scriptPath)) {
    return {
      status: 'error',
      reason: `source-tests.test.mjs not found: ${scriptPath}`,
      command: null, scriptHash: null, exit: null, stdout: '', stderr: '', durationMs: null,
      recordedAt: new Date().toISOString(),
    };
  }

  let scriptHash = null;
  try {
    scriptHash = sha256File(scriptPath);
  } catch { /* leave null */ }

  const command = [process.execPath, '--test', '--test-reporter=tap', scriptPath];
  const startMs = Date.now();

  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', scriptPath], {
    encoding: 'utf8',
    shell: false,
    timeout: boundMs,
    killSignal: 'SIGKILL',
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
  });

  const durationMs = Date.now() - startMs;
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const exit = r.status;

  let status;
  if (timedOut) status = 'timeout';
  else if (r.error || r.signal || !scriptHash) status = 'error';
  else if (exit === 0) status = 'pass';
  else status = 'fail';

  return {
    status,
    command,
    scriptPath,
    scriptHash,
    exit,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    durationMs,
    timedOut,
    signal: r.signal ?? null,
    error: r.error?.message ?? (!scriptHash ? 'Script hash unavailable' : null),
    recordedAt: new Date().toISOString(),
  };
}
