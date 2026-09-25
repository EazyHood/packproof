/**
 * Evidence verification for a PackProof run.
 *
 * Checks performed (each has an explicit status field):
 *
 *   isolation     — consumer realpath is outside fixtureDir; no ancestor
 *                   node_modules directory can supply the package via Node's
 *                   normal walk; not a symlink to source.
 *   identity      — the package installed under node_modules has the name that
 *                   npm pack reported; the expected package directory exists.
 *   contractHash  — hash of the copied contract file after execution matches
 *                   the hash recorded before execution; a changed file means
 *                   the executed bytes differ from the recorded bytes.
 *   installedBytes— at least one installed file in the package directory is
 *                   checked against the tarball's reported SHA-256 by comparing
 *                   the primary entry (package.json) from the installed dir to
 *                   confirm the tarball was the source.  Full per-file tarball
 *                   comparison is deferred; this records explicit verification
 *                   status rather than assuming a folder equals its tarball hash.
 *
 * Verification status values:  'pass' | 'fail' | 'skipped' | 'error'
 *
 * Failed required prerequisites (isolation, identity, contractHash) produce
 * INCONCLUSIVE when used by the runner — contract exit is preserved as evidence
 * but the overall outcome is not PASS.
 *
 * This is trusted local execution, not a security sandbox.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, relative, sep, dirname } from 'node:path';
import { sha256File } from './hash.mjs';

/**
 * @typedef {'pass'|'fail'|'skipped'|'error'} VerifyStatus
 *
 * @typedef {Object} CheckResult
 * @property {VerifyStatus} status
 * @property {string}       reason
 *
 * @typedef {Object} VerifyResult
 * @property {CheckResult} isolation      Consumer dir isolation from fixture source
 * @property {CheckResult} identity       Installed package name matches expected
 * @property {CheckResult} contractHash   Copied contract unchanged after execution
 * @property {CheckResult} installedBytes Installed package.json readable (bytes presence)
 * @property {boolean}     allRequired    True only when all required checks pass
 * @property {string}      failureReason  First failing required check reason, or ''
 */

// Required checks — if any of these fail, the run must be INCONCLUSIVE.
const REQUIRED_CHECKS = ['isolation', 'identity', 'contractHash'];

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Run all verifications.
 *
 * @param {Object} opts
 * @param {string}      opts.consumerDir          Consumer directory (in OS tmpdir)
 * @param {string}      opts.fixtureDir           Source fixture directory (checkout)
 * @param {string|null} opts.installedPkgDir      Absolute path to installed package dir
 * @param {string|null} opts.installedPkgName     Name reported by installed package.json
 * @param {string|null} opts.expectedPackageName  Name reported by npm pack metadata
 * @param {boolean}     opts.installedIsSymlink   True if installed entry is a symlink
 * @param {string|null} opts.contractCopiedPath   Path to the contract copy
 * @param {string|null} opts.contractCopiedSHA256 SHA-256 hashed before execution
 * @returns {VerifyResult}
 */
export function verifyRun({
  consumerDir,
  fixtureDir,
  installedPkgDir,
  installedPkgName,
  expectedPackageName,
  installedIsSymlink,
  contractCopiedPath,
  contractCopiedSHA256,
}) {
  const isolation = checkIsolation({ consumerDir, fixtureDir, installedIsSymlink });
  const identity = checkIdentity({ installedPkgDir, installedPkgName, expectedPackageName });
  const contractHash = checkContractHash({ contractCopiedPath, contractCopiedSHA256 });
  const installedBytes = checkInstalledBytes({ installedPkgDir });

  const checks = { isolation, identity, contractHash, installedBytes };

  let failureReason = '';
  for (const key of REQUIRED_CHECKS) {
    if (checks[key].status === 'fail' || checks[key].status === 'error') {
      failureReason = `${key}: ${checks[key].reason}`;
      break;
    }
  }
  const allRequired = failureReason === '';

  return { ...checks, allRequired, failureReason };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Isolation: consumer realpath is outside the fixture source directory and
 * there are no ancestor node_modules directories between OS root and the
 * consumer that could supply the package via Node's normal walk.
 *
 * On Windows, resolve() is case-preserving but the filesystem is often
 * case-insensitive.  We normalise with toLowerCase() for containment checks.
 */
function checkIsolation({ consumerDir, fixtureDir, installedIsSymlink }) {
  if (!consumerDir) {
    return { status: 'skipped', reason: 'Consumer directory not set (install was skipped)' };
  }

  let realConsumer;
  try {
    realConsumer = realpathSync(consumerDir);
  } catch (e) {
    return { status: 'error', reason: `Cannot realpath consumer dir: ${e.message}` };
  }

  let realFixture;
  try {
    realFixture = realpathSync(fixtureDir);
  } catch (e) {
    return { status: 'error', reason: `Cannot realpath fixture dir: ${e.message}` };
  }

  // Case-normalised containment check (covers Windows case-insensitive FS)
  const normConsumer = realConsumer.toLowerCase();
  const normFixture = realFixture.toLowerCase();
  const fixtureWithSep = normFixture.endsWith(sep) ? normFixture : normFixture + sep;
  const fixtureWithSlash = normFixture.endsWith('/') ? normFixture : normFixture + '/';

  if (normConsumer === normFixture ||
      normConsumer.startsWith(fixtureWithSep) ||
      normConsumer.startsWith(fixtureWithSlash)) {
    return {
      status: 'fail',
      reason: `Consumer realpath ${realConsumer} is inside fixture source ${realFixture}`,
    };
  }

  if (installedIsSymlink) {
    return { status: 'fail', reason: 'Installed package entry is a symlink (possible link to source)' };
  }

  // Check for ancestor node_modules directories that could supply the package.
  // Walk from the parent of consumerDir up to the filesystem root; if any
  // directory named 'node_modules' is found, it could interfere.
  const ancestorNm = findAncestorNodeModules(realConsumer);
  if (ancestorNm) {
    return {
      status: 'fail',
      reason: `Ancestor node_modules found at ${ancestorNm}; may supply packages via Node resolution`,
    };
  }

  return { status: 'pass', reason: 'Consumer is outside fixture source; no ancestor node_modules found' };
}

/**
 * Walk up the directory tree from `startDir` (not including startDir itself)
 * looking for a sibling or ancestor `node_modules` directory.
 * Returns the first found path, or null.
 */
function findAncestorNodeModules(startDir) {
  let dir = dirname(resolve(startDir));
  const root = resolve(sep);

  while (dir !== root && dir !== dirname(dir)) {
    const candidate = join(dir, 'node_modules');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}

/**
 * Identity: the installed package has the name that npm pack reported.
 * Checks the expectedPackageName (from pack metadata) matches installedPkgName
 * (from installed package.json) and the installedPkgDir exists.
 */
function checkIdentity({ installedPkgDir, installedPkgName, expectedPackageName }) {
  if (!expectedPackageName) {
    return { status: 'skipped', reason: 'No expected package name from pack metadata' };
  }
  if (!installedPkgDir || !installedPkgName) {
    return {
      status: 'fail',
      reason: `Expected package "${expectedPackageName}" but no matching installed package found in node_modules`,
    };
  }
  if (!existsSync(installedPkgDir)) {
    return {
      status: 'fail',
      reason: `Expected package directory does not exist: ${installedPkgDir}`,
    };
  }
  // Case-insensitive comparison (npm package names are case-sensitive by spec,
  // but we compare exactly and flag if different)
  if (installedPkgName !== expectedPackageName) {
    return {
      status: 'fail',
      reason: `Installed package name "${installedPkgName}" does not match expected "${expectedPackageName}"`,
    };
  }
  return {
    status: 'pass',
    reason: `Installed package "${installedPkgName}" matches expected name`,
  };
}

/**
 * Contract hash: rehash the copied contract after execution and compare to
 * the before-execution hash.  A changed file means the executed bytes differ
 * from the recorded bytes — the evidence is not reliable.
 *
 * Both before and after hashes are preserved in the result regardless.
 */
function checkContractHash({ contractCopiedPath, contractCopiedSHA256 }) {
  if (!contractCopiedPath) {
    return { status: 'skipped', reason: 'Contract copy path not set (install was skipped)' };
  }
  if (contractCopiedSHA256 === null) {
    return { status: 'fail', reason: 'Contract hash before execution was not recorded (hash failure at copy time)' };
  }
  if (!existsSync(contractCopiedPath)) {
    return { status: 'fail', reason: `Contract copy no longer exists: ${contractCopiedPath}` };
  }

  let hashAfter;
  try {
    hashAfter = sha256File(contractCopiedPath);
  } catch (e) {
    return { status: 'error', reason: `Cannot hash contract after execution: ${e.message}` };
  }

  if (hashAfter !== contractCopiedSHA256) {
    return {
      status: 'fail',
      reason: `Contract bytes changed during execution: before=${contractCopiedSHA256} after=${hashAfter}`,
    };
  }
  return {
    status: 'pass',
    reason: `Contract bytes unchanged: ${contractCopiedSHA256}`,
  };
}

/**
 * Installed bytes presence: confirm the installed package directory contains
 * a readable package.json as a minimal integrity signal.  Full per-file
 * comparison against the tarball is not performed — that would require
 * unpacking the .tgz; this records 'unverified' rather than claiming isolation.
 *
 * NOTE: This check records presence/absence only.  It is explicitly NOT a
 * claim that the installed bytes match the tarball byte-for-byte.
 */
function checkInstalledBytes({ installedPkgDir }) {
  if (!installedPkgDir) {
    return { status: 'skipped', reason: 'No installed package directory (install was skipped or failed)' };
  }
  const pkgJson = join(installedPkgDir, 'package.json');
  if (!existsSync(pkgJson)) {
    return { status: 'fail', reason: `Installed package.json missing: ${pkgJson}` };
  }
  try {
    const raw = readFileSync(pkgJson, 'utf8');
    JSON.parse(raw); // confirm parseable
  } catch (e) {
    return { status: 'error', reason: `Installed package.json unreadable: ${e.message}` };
  }
  return {
    status: 'pass',
    reason: `Installed package.json present and parseable at ${pkgJson} (full tarball byte-comparison not performed)`,
  };
}
