/**
 * Assemble and write the versioned JSON report for a PackProof run.
 *
 * Report schema version: "packproof-report-v1"
 *
 * The report captures everything needed to reproduce the observation:
 * - tool versions and environment
 * - archive identity (path, SHA-256, packed file list)
 * - install identity
 * - contract identity (path, SHA-256)
 * - contract execution (stdout, stderr, exit, timeout)
 * - outcome classification (PASS / FAIL / INCONCLUSIVE) with reason
 *
 * No fabricated durations, success values, or measured ROI.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { sha256String } from './hash.mjs';

export const REPORT_SCHEMA_VERSION = 'packproof-report-v1';

/**
 * @typedef {Object} ReportInput
 * @property {string}      runId           Unique run identifier (e.g. UUID or timestamp slug)
 * @property {string}      caseName        Human label for this check (e.g. 'missing-template-operation')
 * @property {string}      fixtureDir      Absolute path to the fixture source directory
 * @property {string}      contractFile    Absolute path to the original contract file
 * @property {string|null} tarballPath     Absolute path to the packed .tgz (null if pack failed)
 * @property {string|null} archiveSHA256   SHA-256 of tarball (null if pack failed)
 * @property {string[]}    packedFiles     Files listed inside the archive
 * @property {number}      packExit        npm pack exit code
 * @property {string}      packStdout      npm pack stdout
 * @property {string}      packStderr      npm pack stderr
 * @property {string}      npmVersion      npm version string
 * @property {string}      nodeVersion     Node.js version string
 * @property {string|null} consumerDir     Absolute path to consumer dir (null if pack failed)
 * @property {string|null} installedPkgDir Installed package directory (best-effort)
 * @property {boolean}     installedIsSymlink True if the install used a symlink
 * @property {number|null} installExit     npm install exit code (null if pack failed)
 * @property {string}      installStdout   npm install stdout
 * @property {string}      installStderr   npm install stderr
 * @property {number|null} contractExit    Contract exit code
 * @property {string}      contractStdout  Contract stdout
 * @property {string}      contractStderr  Contract stderr
 * @property {boolean}     timedOut        Whether the contract was killed by timeout
 * @property {number}      timeoutMs       The timeout ceiling used
 * @property {string}      contractRunError Spawn error, if any
 * @property {string}      outcome         'PASS' | 'FAIL' | 'INCONCLUSIVE'
 * @property {string}      outcomeReason   Human-readable reason
 * @property {string}      recordedAt      ISO-8601 timestamp
 */

/**
 * Build the report object (does not write to disk).
 *
 * @param {ReportInput} input
 * @returns {Object}  Versioned report object
 */
export function buildReport(input) {
  const contractSHA256 = input.contractFile ? sha256String(readContractSource(input.contractFile)) : null;

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
    },
    archive: {
      fixtureDir: input.fixtureDir,
      tarballPath: input.tarballPath,
      archiveSHA256: input.archiveSHA256,
      packedFiles: input.packedFiles,
      packExit: input.packExit,
      packStdout: input.packStdout,
      packStderr: input.packStderr,
    },
    consumer: {
      consumerDir: input.consumerDir,
      installedPkgDir: input.installedPkgDir,
      installedIsSymlink: input.installedIsSymlink,
      installExit: input.installExit ?? null,
      installStdout: input.installStdout,
      installStderr: input.installStderr,
    },
    contract: {
      contractFile: input.contractFile,
      contractSHA256,
      exitCode: input.contractExit,
      stdout: input.contractStdout,
      stderr: input.contractStderr,
      timedOut: input.timedOut,
      timeoutMs: input.timeoutMs,
      error: input.contractRunError,
    },
    result: {
      outcome: input.outcome,
      reason: input.outcomeReason,
    },
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readContractSource(contractFile) {
  try {
    return readFileSync(contractFile, 'utf8');
  } catch {
    return '';
  }
}
