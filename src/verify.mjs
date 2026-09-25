/** Final evidence corrections by Codex; builds on IBM Bob's verification pipeline. */
import { existsSync, readFileSync, realpathSync, lstatSync } from 'node:fs';
import { join, relative, sep, dirname, isAbsolute } from 'node:path';
import { sha256File } from './hash.mjs';
import { verifyArchiveIntegrity } from './archive-integrity.mjs';

const REQUIRED_CHECKS = ['isolation', 'identity', 'contractHash', 'installedBytes'];
const normalPath = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
const inside = (root, child) => {
  const rel = relative(normalPath(root), normalPath(child));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};
const fail = (reason) => ({ status: 'fail', reason });
const error = (reason) => ({ status: 'error', reason });

/** Every required check must positively pass; omitted evidence never qualifies. */
export function verifyRun({ consumerDir, fixtureDir, installedPkgDir,
  installedPkgName, expectedPackageName, expectedPackageVersion, installedIsSymlink,
  contractCopiedPath, contractCopiedSHA256, tarballPath, archiveSHA256 }) {
  const isolation = checkIsolation({ consumerDir, fixtureDir, installedIsSymlink });
  const identity = checkIdentity({ consumerDir, installedPkgDir, installedPkgName,
    expectedPackageName, expectedPackageVersion });
  const contractHash = checkContractHash({ contractCopiedPath, contractCopiedSHA256 });
  const installedBytes = identity.status === 'pass'
    ? verifyArchiveIntegrity({ tarballPath, archiveSHA256, installedPkgDir: identity.packageDir })
    : error('Archive bytes not checked because installed package identity is unverified');
  const checks = { isolation, identity, contractHash, installedBytes };
  const first = REQUIRED_CHECKS.find((key) => checks[key].status !== 'pass');
  return { ...checks, allRequired: first === undefined,
    failureReason: first ? `${first}: ${checks[first].reason}` : '' };
}

export function checkIsolation({ consumerDir, fixtureDir, installedIsSymlink }) {
  if (!consumerDir || !fixtureDir) return error('Consumer and source fixture paths are required');
  try {
    const realConsumer = realpathSync(consumerDir);
    const realFixture = realpathSync(fixtureDir);
    if (!lstatSync(realConsumer).isDirectory() || !lstatSync(realFixture).isDirectory()) {
      return fail('Consumer and fixture must be directories');
    }
    if (inside(realFixture, realConsumer)) return fail('Consumer realpath is inside fixture source');
    if (installedIsSymlink) return fail('Installed package entry is a symlink');
    // Include the final filesystem root: root-level node_modules also resolves.
    for (let ancestor = dirname(realConsumer);; ancestor = dirname(ancestor)) {
      const candidate = join(ancestor, 'node_modules');
      if (existsSync(candidate)) return fail(`Ancestor node_modules found at ${candidate}`);
      if (ancestor === dirname(ancestor)) break;
    }
    return { status: 'pass', reason: 'Consumer is outside fixture; no ancestor node_modules',
      consumerRealpath: realConsumer, fixtureRealpath: realFixture };
  } catch (e) { return error(`Cannot verify isolation: ${e.message}`); }
}

export function checkIdentity({ consumerDir, expectedPackageName, expectedPackageVersion }) {
  if (!consumerDir || typeof expectedPackageName !== 'string' ||
      !/^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(expectedPackageName) ||
      expectedPackageName.split('/').some((part) => part === '.' || part === '..')) {
    return fail('A valid expected package name and consumer directory are required');
  }
  try {
    const realConsumer = realpathSync(consumerDir);
    const packageDir = join(realConsumer, 'node_modules', ...expectedPackageName.split('/'));
    let current = realConsumer;
    for (const part of ['node_modules', ...expectedPackageName.split('/')]) {
      current = join(current, part);
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return fail(`Installed package path is linked or not a directory: ${current}`);
      if (!inside(realConsumer, realpathSync(current))) return fail('Installed package path escapes consumer');
    }
    const packageRealpath = realpathSync(packageDir);
    const manifestPath = join(packageDir, 'package.json');
    if (!lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink()) {
      return fail('Installed package manifest is not a regular file');
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== expectedPackageName) return fail(`Installed name ${manifest.name} does not match expected ${expectedPackageName}`);
    if (expectedPackageVersion != null && manifest.version !== expectedPackageVersion) {
      return fail(`Installed version ${manifest.version} does not match expected ${expectedPackageVersion}`);
    }
    return { status: 'pass', reason: 'Exact expected package manifest and realpath verified',
      packageDir, packageRealpath, packageName: manifest.name, packageVersion: manifest.version ?? null };
  } catch (e) {
    return e.code === 'ENOENT'
      ? fail(`Expected installed package or manifest is missing: ${e.message}`)
      : error(`Cannot verify expected installed package: ${e.message}`);
  }
}

/** Also used after execution: unreadable/missing/changed bytes do not pass. */
export function checkContractHash({ contractCopiedPath, contractCopiedSHA256 }) {
  const beforeSHA256 = typeof contractCopiedSHA256 === 'string' ? contractCopiedSHA256.toUpperCase() : null;
  const fields = { beforeSHA256, afterSHA256: null };
  if (!contractCopiedPath || !beforeSHA256 || !/^[A-F0-9]{64}$/.test(beforeSHA256)) {
    return { ...fail('Contract copy path and valid before-execution SHA-256 are required'), ...fields };
  }
  try {
    const stat = lstatSync(contractCopiedPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return { ...fail('Contract copy is not a regular unlinked file'), ...fields };
    const afterSHA256 = sha256File(contractCopiedPath);
    return { status: afterSHA256 === beforeSHA256 ? 'pass' : 'fail',
      reason: afterSHA256 === beforeSHA256 ? 'Contract bytes unchanged' : 'Contract bytes changed',
      beforeSHA256, afterSHA256 };
  } catch (e) { return { ...error(`Cannot hash contract copy: ${e.message}`), ...fields }; }
}
