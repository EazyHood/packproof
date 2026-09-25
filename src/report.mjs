/**
 * Assemble and write the versioned JSON report for a PackProof run.
 *
 * Report schema version: "packproof-report-v1"
 *
 * The report captures everything needed to reproduce the observation:
 * - tool versions and environment
 * - archive identity (path, SHA-256, packed file list, package name)
 * - install identity (consumer dir, isolation flag, symlink check)
 * - contract identity: the SHA-256 is from the COPIED contract (the bytes
 *   that were actually executed), not the original file; recorded before
 *   execution in installTarball(). Read failures become null, not the hash
 *   of an empty string.
 * - contract execution (stdout, stderr, exit, signal, timeout)
 * - outcome classification (PASS / FAIL / INCONCLUSIVE) with reason
 *
 * No fabricated durations, success values, or measured ROI.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const REPORT_SCHEMA_VERSION = 'packproof-report-v1';

/**
 * Build the report object (does not write to disk).
 *
 * The contractCopiedSHA256 field is passed in from installResult (hashed before
 * execution).  This function no longer reads any file.
 *
 * @param {Object} input
 * @returns {Object}  Versioned report object
 */
export function buildReport(input) {
  return {
    $schema: REPORT_SCHEMA_VERSION,
    runId: input.runId,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    caseName: input.caseName,
    provenance: 'PackProof runner (IBM Bob IDE implementation); fixture packages by Codex',
    environment: {
      node: input.nodeVersion,
      npm: input.npmVersion,
      platform: process.platform,
      arch: process.arch,
      npmCliJs: input.npmCliJs ?? null,
    },
    archive: {
      fixtureDir: input.fixtureDir,
      tarballPath: input.tarballPath,
      archiveSHA256: input.archiveSHA256,
      packageName: input.packageName ?? null,
      packedFiles: input.packedFiles,
      packExit: input.packExit,
      packSignal: input.packSignal ?? '',
      packTimedOut: input.packTimedOut ?? false,
      packError: input.packError ?? '',
      packStdout: input.packStdout,
      packStderr: input.packStderr,
    },
    consumer: {
      consumerDir: input.consumerDir,
      isolationPreconditionMet: input.isolationPreconditionMet ?? null,
      installedPkgDir: input.installedPkgDir,
      installedPkgName: input.installedPkgName ?? null,
      installedIsSymlink: input.installedIsSymlink,
      installExit: input.installExit ?? null,
      installSignal: input.installSignal ?? '',
      installTimedOut: input.installTimedOut ?? false,
      installError: input.installError ?? '',
      installStdout: input.installStdout,
      installStderr: input.installStderr,
    },
    verify: input.verify ?? null,
    contract: {
      // Original contract file path (for reference)
      contractFile: input.contractFile,
      // Path and SHA-256 of the COPY that was actually executed
      contractCopiedPath: input.contractCopiedPath ?? null,
      // Hashed before execution in installTarball(); null if copy or hash failed
      contractCopiedSHA256: input.contractCopiedSHA256 ?? null,
      exitCode: input.contractExit,
      signal: input.contractSignal ?? '',
      stdout: input.contractStdout,
      stderr: input.contractStderr,
      timedOut: input.timedOut,
      elapsedMs: input.contractElapsedMs ?? null,
      timeoutMs: input.timeoutMs,
      error: input.contractRunError,
    },
    result: {
      outcome: input.outcome,
      reason: input.outcomeReason,
    },
    // Source baseline is a separate evidence record, not a consumer run.
    // 'not-run' when no source baseline was requested; never null.
    sourceBaseline: input.sourceBaseline ?? { status: 'not-run', reason: 'Not recorded' },
  };
}

/**
 * Write a report to disk as pretty-printed JSON.
 *
 * @param {Object} report   The object returned by buildReport()
 * @param {string} outPath  Absolute path for the .json output file
 */
export function writeReport(report, outPath) {
  outPath = resolve(outPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
}
