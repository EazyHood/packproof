/**
 * PackProof test suite — node:test, no extra dependencies.
 *
 * Organisation:
 *   §1  hash — sha256File, sha256String
 *   §2  classify — all eight classification rules
 *   §3  buildReport / writeReport — schema, null-safe fields
 *   §4  runContract — real child processes, timeout, stdout/stderr
 *   §5  classify regression — null exit, timeout vs spawn-error ordering
 *   §6  Source contract correctness (Codex frozen fixtures, no npm)
 *   §7  CLI argument validation
 *   §8  npm-runner discovery (unit)
 *   §9  Runner safety — caseName path traversal, repeated artifactDir, report filename
 *   §10 End-to-end integration — real npm pack + install for all six frozen cases
 *
 * §10 runs real npm pack and npm install; these tests are skipped when npm-cli.js
 * cannot be found (e.g. in an environment without npm).  They use unique tmpdir
 * subdirectories and never share state between cases.
 *
 * Provenance: fixture packages and contracts are by Codex (validation-fixtures/).
 * These tests are the PackProof implementation, separately attributed per PROVENANCE.md.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const FIXTURES_ROOT = join(PROJECT_ROOT, 'validation-fixtures');
const CONTRACTS_DIR = join(FIXTURES_ROOT, 'contracts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(prefix = 'packproof-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeTmp(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// §1. sha256File / sha256String
// ---------------------------------------------------------------------------

test('hash: sha256String produces consistent uppercase hex', async () => {
  const { sha256String } = await import('../src/hash.mjs');
  const h1 = sha256String('hello world');
  const h2 = sha256String('hello world');
  assert.equal(h1, h2, 'same input → same hash');
  assert.match(h1, /^[A-F0-9]{64}$/, 'uppercase hex 64 chars');
});

test('hash: sha256String differs for different inputs', async () => {
  const { sha256String } = await import('../src/hash.mjs');
  assert.notEqual(sha256String('a'), sha256String('b'));
});

test('hash: sha256File hashes a real file', async () => {
  const { sha256File } = await import('../src/hash.mjs');
  const tmp = makeTmpDir();
  try {
    const p = join(tmp, 'sample.txt');
    writeFileSync(p, 'PackProof\n', 'utf8');
    const h = sha256File(p);
    assert.match(h, /^[A-F0-9]{64}$/, 'uppercase hex 64 chars');
    assert.equal(h, sha256File(p), 'deterministic');
  } finally {
    removeTmp(tmp);
  }
});

// ---------------------------------------------------------------------------
// §2. classify — all eight rules
// ---------------------------------------------------------------------------

test('classify: pack failure (non-zero) → INCONCLUSIVE', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 1, installExit: null, contractExit: null, timedOut: false });
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.match(r.reason, /pack/i);
});

test('classify: pack failure (null) → INCONCLUSIVE', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: null, installExit: null, contractExit: null, timedOut: false });
  assert.equal(r.outcome, 'INCONCLUSIVE');
});

test('classify: install failure → INCONCLUSIVE', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 1, contractExit: null, timedOut: false });
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.match(r.reason, /install/i);
});

test('classify: install null (not attempted) → INCONCLUSIVE', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: null, contractExit: null, timedOut: false });
  assert.equal(r.outcome, 'INCONCLUSIVE');
});

test('classify: timeout → INCONCLUSIVE (not spawn-error wording)', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 0, contractExit: null, timedOut: true, contractError: 'ETIMEDOUT' });
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.match(r.reason, /timeout/i, 'timeout reason should mention timeout');
  assert.doesNotMatch(r.reason, /start/i, 'timeout reason must not say "failed to start"');
});

test('classify: spawn error with null exit → INCONCLUSIVE', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 0, contractExit: null, timedOut: false, contractError: 'ENOENT' });
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.match(r.reason, /start|infrastructure/i);
});

test('classify: null exit without any flag → INCONCLUSIVE (not FAIL or PASS)', async () => {
  const { classify } = await import('../src/classify.mjs');
  // Synthetic: pack/install 0, no timeout, no error, but null exit — unknown completion
  const r = classify({ packExit: 0, installExit: 0, contractExit: null, timedOut: false, contractError: '', contractSignal: '' });
  assert.equal(r.outcome, 'INCONCLUSIVE', 'null exit with no context must be INCONCLUSIVE');
});

test('classify: contract exits 0 → PASS', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 0, contractExit: 0, timedOut: false });
  assert.equal(r.outcome, 'PASS');
});

test('classify: contract exits non-zero → FAIL', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 0, contractExit: 1, timedOut: false });
  assert.equal(r.outcome, 'FAIL');
});

test('classify: wrong expectation (exit 1) is FAIL not INCONCLUSIVE', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 0, contractExit: 1, timedOut: false });
  assert.equal(r.outcome, 'FAIL');
});

// ---------------------------------------------------------------------------
// §3. buildReport / writeReport
// ---------------------------------------------------------------------------

test('buildReport: schema version set, no contractSHA256 from file read', async () => {
  const { buildReport, REPORT_SCHEMA_VERSION } = await import('../src/report.mjs');
  const report = buildReport({
    runId: 'test-run-id',
    caseName: 'test-case',
    fixtureDir: '/tmp/fixture',
    contractFile: '/tmp/contract.mjs',
    contractCopiedPath: '/tmp/consumer/contract.mjs',
    contractCopiedSHA256: 'AABBCC0011223344556677889900AABBCC0011223344556677889900AABBCC001122',
    tarballPath: null, archiveSHA256: null, packedFiles: [], packageName: null,
    packExit: 1, packSignal: '', packTimedOut: false, packError: 'mock error',
    packStdout: '', packStderr: '', npmVersion: '11.0.0', nodeVersion: 'v24.0.0', npmCliJs: '',
    consumerDir: null, isolationPreconditionMet: false,
    installedPkgDir: null, installedPkgName: null, installedIsSymlink: false,
    installExit: null, installSignal: '', installTimedOut: false, installError: '',
    installStdout: '', installStderr: '',
    contractExit: null, contractSignal: '', contractStdout: '', contractStderr: '',
    timedOut: false, timeoutMs: 15000, contractRunError: '',
    outcome: 'INCONCLUSIVE', outcomeReason: 'pack failed',
  });
  assert.equal(report.$schema, REPORT_SCHEMA_VERSION);
  assert.equal(report.caseName, 'test-case');
  assert.equal(report.result.outcome, 'INCONCLUSIVE');
  // Copied SHA-256 is preserved as-is (not re-read from disk)
  assert.equal(report.contract.contractCopiedSHA256, 'AABBCC0011223344556677889900AABBCC0011223344556677889900AABBCC001122');
  assert.ok(typeof report.recordedAt === 'string');
});

test('buildReport: contractCopiedSHA256 null when install did not run', async () => {
  const { buildReport } = await import('../src/report.mjs');
  const report = buildReport({
    runId: 'x', caseName: 'x', fixtureDir: '/f', contractFile: '/c.mjs',
    contractCopiedPath: null, contractCopiedSHA256: null,
    tarballPath: null, archiveSHA256: null, packedFiles: [], packageName: null,
    packExit: 1, packSignal: '', packTimedOut: false, packError: '',
    packStdout: '', packStderr: '', npmVersion: '', nodeVersion: '', npmCliJs: '',
    consumerDir: null, isolationPreconditionMet: null,
    installedPkgDir: null, installedPkgName: null, installedIsSymlink: false,
    installExit: null, installSignal: '', installTimedOut: false, installError: '',
    installStdout: '', installStderr: '',
    contractExit: null, contractSignal: '', contractStdout: '', contractStderr: '',
    timedOut: false, timeoutMs: 15000, contractRunError: '',
    outcome: 'INCONCLUSIVE', outcomeReason: 'pack failed',
  });
  assert.equal(report.contract.contractCopiedSHA256, null);
});

test('writeReport: creates file with valid JSON', async () => {
  const { buildReport, writeReport } = await import('../src/report.mjs');
  const tmp = makeTmpDir();
  try {
    const report = buildReport({
      runId: 'write-test', caseName: 'write-test', fixtureDir: tmp, contractFile: '/c.mjs',
      contractCopiedPath: null, contractCopiedSHA256: null,
      tarballPath: null, archiveSHA256: null, packedFiles: [], packageName: null,
      packExit: 0, packSignal: '', packTimedOut: false, packError: '',
      packStdout: '', packStderr: '', npmVersion: '', nodeVersion: '', npmCliJs: '',
      consumerDir: null, isolationPreconditionMet: null,
      installedPkgDir: null, installedPkgName: null, installedIsSymlink: false,
      installExit: 0, installSignal: '', installTimedOut: false, installError: '',
      installStdout: '', installStderr: '',
      contractExit: 0, contractSignal: '', contractStdout: '', contractStderr: '',
      timedOut: false, timeoutMs: 15000, contractRunError: '',
      outcome: 'PASS', outcomeReason: 'Contract exited 0',
    });
    const outPath = join(tmp, 'report.json');
    writeReport(report, outPath);
    const parsed = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(parsed.$schema, report.$schema);
    assert.equal(parsed.result.outcome, 'PASS');
  } finally {
    removeTmp(tmp);
  }
});

// ---------------------------------------------------------------------------
// §4. runContract — real child process, no npm involved
// ---------------------------------------------------------------------------

test('runContract: passes contract exit 0', async () => {
  const { runContract } = await import('../src/run-contract.mjs');
  const tmp = makeTmpDir();
  try {
    writeFileSync(join(tmp, 'package.json'), '{"type":"module"}', 'utf8');
    writeFileSync(join(tmp, 'contract.mjs'), 'process.exit(0);\n', 'utf8');
    const r = runContract({ consumerDir: tmp });
    assert.equal(r.exitCode, 0);
    assert.equal(r.timedOut, false);
    assert.equal(r.error, '');
  } finally {
    removeTmp(tmp);
  }
});

test('runContract: captures non-zero exit code', async () => {
  const { runContract } = await import('../src/run-contract.mjs');
  const tmp = makeTmpDir();
  try {
    writeFileSync(join(tmp, 'package.json'), '{"type":"module"}', 'utf8');
    writeFileSync(join(tmp, 'contract.mjs'), 'process.exit(42);\n', 'utf8');
    const r = runContract({ consumerDir: tmp });
    assert.equal(r.exitCode, 42);
    assert.equal(r.timedOut, false);
  } finally {
    removeTmp(tmp);
  }
});

test('runContract: captures raw stdout and stderr', async () => {
  const { runContract } = await import('../src/run-contract.mjs');
  const tmp = makeTmpDir();
  try {
    writeFileSync(join(tmp, 'package.json'), '{"type":"module"}', 'utf8');
    writeFileSync(
      join(tmp, 'contract.mjs'),
      'process.stdout.write("hello\\n"); process.stderr.write("err\\n"); process.exit(0);\n',
      'utf8'
    );
    const r = runContract({ consumerDir: tmp });
    // stdout/stderr are raw (not trimmed) — preserve trailing newlines
    assert.ok(r.stdout.includes('hello'), 'stdout captured');
    assert.ok(r.stderr.includes('err'), 'stderr captured');
  } finally {
    removeTmp(tmp);
  }
});

test('runContract: timeout kills hanging process → timedOut true', { timeout: 10_000 }, async () => {
  const { runContract } = await import('../src/run-contract.mjs');
  const tmp = makeTmpDir();
  try {
    writeFileSync(join(tmp, 'package.json'), '{"type":"module"}', 'utf8');
    writeFileSync(
      join(tmp, 'contract.mjs'),
      'await new Promise(r => setTimeout(r, 60_000));\n',
      'utf8'
    );
    const r = runContract({ consumerDir: tmp, timeoutMs: 500 });
    assert.equal(r.timedOut, true, 'timedOut flag must be true');
    assert.notEqual(r.exitCode, 0, 'should not exit cleanly');
  } finally {
    removeTmp(tmp);
  }
});

test('runContract: missing consumerDir → error string, null exitCode', async () => {
  const { runContract } = await import('../src/run-contract.mjs');
  const r = runContract({ consumerDir: '/nonexistent-packproof-test-dir-xyz' });
  assert.ok(r.error.length > 0, 'error should be set');
  assert.equal(r.exitCode, null);
  assert.equal(r.timedOut, false);
});

// ---------------------------------------------------------------------------
// §5. classify regressions
// ---------------------------------------------------------------------------

test('classify: timeout outcome is never PASS even with exitCode 0', async () => {
  const { classify, Outcome } = await import('../src/classify.mjs');
  // timedOut=true takes precedence over exitCode=0
  const r = classify({ packExit: 0, installExit: 0, contractExit: 0, timedOut: true });
  assert.equal(r.outcome, Outcome.INCONCLUSIVE);
});

test('classify: timeout reason is timeout-specific (not spawn-error wording)', async () => {
  const { classify } = await import('../src/classify.mjs');
  // Both timedOut=true and contractError set (as spawnSync would with ETIMEDOUT):
  const r = classify({ packExit: 0, installExit: 0, contractExit: null, timedOut: true, contractError: 'spawnSync ETIMEDOUT' });
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.match(r.reason, /timeout/i);
  assert.doesNotMatch(r.reason, /start|infrastructure/i);
});

test('classify: external signal terminates with null exit → INCONCLUSIVE', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 0, contractExit: null, timedOut: false, contractSignal: 'SIGKILL', contractError: '' });
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.match(r.reason, /signal/i);
});

// ---------------------------------------------------------------------------
// §6. Source contract correctness (frozen Codex fixtures, no npm)
// ---------------------------------------------------------------------------

test('source: formatLabel produces the frozen label output', async () => {
  const { formatLabel } = await import('../validation-fixtures/labels-missing-template/src/index.mjs');
  assert.equal(
    formatLabel({ sku: 'SKU-042', quantity: 12, bin: 'B-7' }),
    'SKU-042 | QTY 12 | BIN B-7\n',
    'frozen label output must match exactly (including LF)'
  );
});

test('source: tally produces frozen summary', async () => {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const mod = req('../validation-fixtures/tally/lib/summary.cjs');
  assert.deepEqual(
    mod.summarizeQuantities([{ quantity: 2, unit: 'crate' }, { quantity: 3, unit: 'unit' }]),
    { totalUnits: 11, lineCount: 2 }
  );
});

// ---------------------------------------------------------------------------
// §7. CLI argument validation
// ---------------------------------------------------------------------------

test('cli: missing --fixture/--contract/--out fails clearly', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [join(PROJECT_ROOT, 'src/cli.mjs')], {
    encoding: 'utf8', shell: false, env: { ...process.env },
  });
  assert.notEqual(r.status, 0);
  const combined = (r.stderr || '') + (r.stdout || '');
  assert.match(combined, /--fixture|--contract|Usage/i);
});

test('cli: --help exits 0 and prints Usage', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [join(PROJECT_ROOT, 'src/cli.mjs'), '--help'], {
    encoding: 'utf8', shell: false, env: { ...process.env },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage/i);
});

test('cli: malformed --timeout (digits+letters) → exit 1 with message', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(
    process.execPath,
    [join(PROJECT_ROOT, 'src/cli.mjs'), '--fixture', '.', '--contract', '.', '--out', '.', '--timeout', '12oops'],
    { encoding: 'utf8', shell: false, env: { ...process.env } }
  );
  assert.notEqual(r.status, 0);
  const combined = (r.stderr || '') + (r.stdout || '');
  assert.match(combined, /timeout/i);
});

test('cli: --timeout 0 is rejected', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(
    process.execPath,
    [join(PROJECT_ROOT, 'src/cli.mjs'), '--fixture', '.', '--contract', '.', '--out', '.', '--timeout', '0'],
    { encoding: 'utf8', shell: false, env: { ...process.env } }
  );
  assert.notEqual(r.status, 0);
  assert.match((r.stderr || '') + (r.stdout || ''), /timeout/i);
});

test('cli: missing fixture dir → exit 1 with message', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(
    process.execPath,
    [join(PROJECT_ROOT, 'src/cli.mjs'),
      '--fixture', '/nonexistent-dir-xyz',
      '--contract', join(CONTRACTS_DIR, 'label-operation.mjs'),
      '--out', tmpdir()],
    { encoding: 'utf8', shell: false, env: { ...process.env } }
  );
  assert.notEqual(r.status, 0);
  assert.match((r.stderr || '') + (r.stdout || ''), /fixture|not found/i);
});

// ---------------------------------------------------------------------------
// §8. npm-runner discovery (unit)
// ---------------------------------------------------------------------------

test('npm-runner: findNpmCliJs returns a string or null', async () => {
  const { findNpmCliJs } = await import('../src/npm-runner.mjs');
  const result = findNpmCliJs();
  // Either a path string or null — never throws
  assert.ok(result === null || typeof result === 'string');
});

test('npm-runner: getNpmVersion returns string or null, does not throw', async () => {
  const { getNpmVersion } = await import('../src/npm-runner.mjs');
  const v = getNpmVersion();
  assert.ok(v === null || typeof v === 'string');
  if (v !== null) {
    // Should look like a semver version
    assert.match(v, /^\d+\.\d+/);
  }
});

// ---------------------------------------------------------------------------
// §9. Runner safety
// ---------------------------------------------------------------------------

test('runner: caseName with path traversal does not affect run directory path', async (t) => {
  const { runCase } = await import('../src/runner.mjs');
  const { findNpmCliJs } = await import('../src/npm-runner.mjs');

  if (!findNpmCliJs()) {
    t.skip('npm-cli.js not found; skipping integration test');
    return;
  }

  const tmp = makeTmpDir('packproof-traversal-');
  try {
    const result = runCase({
      fixtureDir: join(FIXTURES_ROOT, 'labels-missing-template'),
      contractFile: join(CONTRACTS_DIR, 'label-operation.mjs'),
      artifactDir: tmp,
      caseName: '../../escaped-proof',   // malicious label
      timeoutMs: 15_000,
    });

    // runDir must be a child of tmp, not outside
    assert.ok(
      result.runDir.startsWith(tmp),
      `runDir ${result.runDir} must start with ${tmp}`
    );
    // report.json must also be inside tmp
    assert.ok(
      result.reportPath.startsWith(tmp),
      `reportPath ${result.reportPath} must start with ${tmp}`
    );
    // caseName in report is preserved as-is (metadata only)
    assert.equal(result.report.caseName, '../../escaped-proof');
  } finally {
    removeTmp(tmp);
  }
});

test('runner: repeated artifactDir produces separate run directories (no overwrite)', async (t) => {
  const { runCase } = await import('../src/runner.mjs');
  const { findNpmCliJs } = await import('../src/npm-runner.mjs');

  if (!findNpmCliJs()) { t.skip('npm-cli.js not found'); return; }

  const tmp = makeTmpDir('packproof-repeat-');
  try {
    const r1 = runCase({
      fixtureDir: join(FIXTURES_ROOT, 'tally'),
      contractFile: join(CONTRACTS_DIR, 'tally-operation.mjs'),
      artifactDir: tmp,
      caseName: 'tally-repeat-1',
      timeoutMs: 15_000,
    });
    const r2 = runCase({
      fixtureDir: join(FIXTURES_ROOT, 'tally'),
      contractFile: join(CONTRACTS_DIR, 'tally-operation.mjs'),
      artifactDir: tmp,
      caseName: 'tally-repeat-2',
      timeoutMs: 15_000,
    });

    assert.notEqual(r1.runDir, r2.runDir, 'each run gets a distinct directory');
    assert.notEqual(r1.report.runId, r2.report.runId, 'each run has a distinct runId');
    assert.ok(existsSync(r1.reportPath), 'first report still exists');
    assert.ok(existsSync(r2.reportPath), 'second report exists independently');
  } finally {
    removeTmp(tmp);
  }
});

test('runner: report filename is always report.json (not derived from caseName)', async (t) => {
  const { runCase } = await import('../src/runner.mjs');
  const { findNpmCliJs } = await import('../src/npm-runner.mjs');

  if (!findNpmCliJs()) { t.skip('npm-cli.js not found'); return; }

  const tmp = makeTmpDir('packproof-report-name-');
  try {
    const result = runCase({
      fixtureDir: join(FIXTURES_ROOT, 'tally'),
      contractFile: join(CONTRACTS_DIR, 'tally-operation.mjs'),
      artifactDir: tmp,
      caseName: 'some-custom-label',
      timeoutMs: 15_000,
    });
    assert.ok(result.reportPath.endsWith('report.json'), 'report file is always report.json');
  } finally {
    removeTmp(tmp);
  }
});

// ---------------------------------------------------------------------------
// §10. End-to-end integration — real npm pack + install + contract execution
//
//  These tests run the full pipeline with real npm.  Each case uses a
//  unique tmpdir so they are independent.  Tests are SKIPPED (t.skip) when
//  npm-cli.js is not found, so an npm-free host does not count them as passing.
//  Expected outcomes match the frozen Codex manual baseline.
// ---------------------------------------------------------------------------

async function runE2E(t, fixtureName, contractName, expectedOutcome, testSuffix = '') {
  const { runCase } = await import('../src/runner.mjs');
  const { findNpmCliJs } = await import('../src/npm-runner.mjs');

  if (!findNpmCliJs()) {
    t.skip('npm-cli.js not found; integration test skipped');
    return null;
  }

  const tmp = makeTmpDir(`packproof-e2e-${testSuffix}-`);
  try {
    const result = runCase({
      fixtureDir: join(FIXTURES_ROOT, fixtureName),
      contractFile: join(CONTRACTS_DIR, contractName),
      artifactDir: tmp,
      caseName: `${fixtureName}+${contractName}`,
      timeoutMs: 30_000,
    });

    assert.equal(
      result.outcome,
      expectedOutcome,
      `${fixtureName}+${contractName}: expected ${expectedOutcome}, got ${result.outcome} — ${result.reason}`
    );

    // Report must exist
    assert.ok(existsSync(result.reportPath), 'report file must exist');

    // caseName in report must match
    assert.equal(result.report.caseName, `${fixtureName}+${contractName}`);

    // Consumer dir must be in OS tmpdir (isolation)
    if (result.report.consumer.consumerDir) {
      const osTmp = tmpdir();
      assert.ok(
        result.report.consumer.consumerDir.startsWith(osTmp) ||
        result.report.consumer.consumerDir.startsWith(osTmp.replace(/\\/g, '/')),
        `consumer dir ${result.report.consumer.consumerDir} should be in OS tmpdir`
      );
    }

    // Verify block must be present in report
    assert.ok(result.report.verify !== undefined, 'report must have a verify block');

    return result;
  } finally {
    removeTmp(tmp);
  }
}

test('e2e: missing-template-operation → FAIL (ENOENT for template)', { timeout: 60_000 }, async (t) => {
  await runE2E(t, 'labels-missing-template', 'label-operation.mjs', 'FAIL', 'mt-op');
});

test('e2e: missing-template-import-only → PASS (operationExercised false)', { timeout: 60_000 }, async (t) => {
  await runE2E(t, 'labels-missing-template', 'label-import-only.mjs', 'PASS', 'mt-io');
});

test('e2e: fixed-operation → PASS (exact frozen label output)', { timeout: 60_000 }, async (t) => {
  const result = await runE2E(t, 'labels-fixed', 'label-operation.mjs', 'PASS', 'fx-op');
  if (result) {
    assert.ok(
      result.report.contract.stdout.includes('SKU-042 | QTY 12 | BIN B-7'),
      'frozen label must appear in stdout'
    );
    // verify block must show all required checks pass
    assert.equal(result.report.verify?.isolation?.status, 'pass', 'isolation check must pass for fixed-operation');
    assert.equal(result.report.verify?.identity?.status, 'pass', 'identity check must pass for fixed-operation');
  }
});

test('e2e: fixed-wrong-expectation → FAIL (deliberate wrong assertion)', { timeout: 60_000 }, async (t) => {
  await runE2E(t, 'labels-fixed', 'label-wrong-expectation.mjs', 'FAIL', 'fx-wrong');
});

test('e2e: broken-export-operation → FAIL (ERR_MODULE_NOT_FOUND)', { timeout: 60_000 }, async (t) => {
  // A broken export is the defect being tested — it still runs and produces FAIL
  const result = await runE2E(t, 'labels-broken-export', 'label-operation.mjs', 'FAIL', 'be-op');
  if (result) {
    // Identity check: the broken-export package IS correctly identified (the export is broken, not the name)
    // The outcome is FAIL because the contract fails, not because of an identity/isolation prerequisite
    assert.equal(result.outcome, 'FAIL', 'broken export must produce FAIL, not INCONCLUSIVE');
  }
});

test('e2e: tally-operation → PASS (totalUnits 11, lineCount 2)', { timeout: 60_000 }, async (t) => {
  const result = await runE2E(t, 'tally', 'tally-operation.mjs', 'PASS', 'tally-op');
  if (result) {
    assert.ok(
      result.report.contract.stdout.includes('"totalUnits":11'),
      'totalUnits 11 must appear in stdout'
    );
  }
});

// ---------------------------------------------------------------------------
// §11. verify.mjs unit tests and false-PASS regression controls
// ---------------------------------------------------------------------------

test('verify: isolation fails when consumer is inside fixtureDir', async () => {
  const { verifyRun } = await import('../src/verify.mjs');
  const tmp = makeTmpDir('packproof-verify-iso-');
  try {
    // Consumer is INSIDE the fixture-like directory
    const fakeFixture = tmp;
    const fakeConsumer = join(tmp, 'subdir');
    writeFileSync(join(tmp, 'package.json'), '{}', 'utf8');
    mkdirSync(fakeConsumer);

    const result = verifyRun({
      consumerDir: fakeConsumer,
      fixtureDir: fakeFixture,
      installedPkgDir: null,
      installedPkgName: null,
      expectedPackageName: null,
      installedIsSymlink: false,
      contractCopiedPath: null,
      contractCopiedSHA256: null,
    });

    assert.equal(result.isolation.status, 'fail', 'isolation must fail when consumer is inside fixtureDir');
    assert.equal(result.allRequired, false, 'allRequired must be false on isolation failure');
  } finally {
    removeTmp(tmp);
  }
});

test('verify: identity fails when installed name does not match expected', async () => {
  const { verifyRun } = await import('../src/verify.mjs');
  const tmp = makeTmpDir('packproof-verify-id-');
  try {
    const fakePkgDir = join(tmp, 'node_modules', 'actual-pkg');
    mkdirSync(fakePkgDir, { recursive: true });
    writeFileSync(join(fakePkgDir, 'package.json'), JSON.stringify({ name: 'actual-pkg' }), 'utf8');

    const result = verifyRun({
      consumerDir: tmp,
      fixtureDir: join(tmpdir(), 'some-fixture'),
      installedPkgDir: fakePkgDir,
      installedPkgName: 'actual-pkg',
      expectedPackageName: 'expected-pkg',
      installedIsSymlink: false,
      contractCopiedPath: null,
      contractCopiedSHA256: null,
    });

    assert.equal(result.identity.status, 'fail', 'identity must fail when names do not match');
    assert.equal(result.allRequired, false, 'allRequired must be false on identity failure');
  } finally {
    removeTmp(tmp);
  }
});

test('verify: contractHash fails when hash is null (copy failed)', async () => {
  const { verifyRun } = await import('../src/verify.mjs');
  const result = verifyRun({
    consumerDir: tmpdir(),
    fixtureDir: join(tmpdir(), 'fixture'),
    installedPkgDir: null,
    installedPkgName: null,
    expectedPackageName: null,
    installedIsSymlink: false,
    contractCopiedPath: '/tmp/some-contract.mjs',
    contractCopiedSHA256: null,  // hash failed at copy time
  });

  assert.equal(result.contractHash.status, 'fail', 'contractHash must fail when pre-execution hash is null');
  assert.equal(result.allRequired, false);
});

test('verify: contractHash fails when bytes changed', async () => {
  const { verifyRun } = await import('../src/verify.mjs');
  const tmp = makeTmpDir('packproof-verify-hash-');
  try {
    const contractPath = join(tmp, 'contract.mjs');
    writeFileSync(contractPath, '// original\n', 'utf8');

    // Record hash of original
    const { sha256File } = await import('../src/hash.mjs');
    const originalHash = sha256File(contractPath);

    // Simulate contract modifying itself during execution
    writeFileSync(contractPath, '// changed after execution\n', 'utf8');

    const result = verifyRun({
      consumerDir: tmpdir(),
      fixtureDir: join(tmpdir(), 'fixture'),
      installedPkgDir: null,
      installedPkgName: null,
      expectedPackageName: null,
      installedIsSymlink: false,
      contractCopiedPath: contractPath,
      contractCopiedSHA256: originalHash,
    });

    assert.equal(result.contractHash.status, 'fail', 'contractHash must fail when bytes changed');
    assert.match(result.contractHash.reason, /changed/i);
  } finally {
    removeTmp(tmp);
  }
});

test('classify: prereqFailure → INCONCLUSIVE even when contractExit is 0', async () => {
  // Regression for false-PASS control #1: isolation failure must block PASS
  const { classify } = await import('../src/classify.mjs');
  const r = classify({
    packExit: 0,
    installExit: 0,
    contractExit: 0,  // contract exited 0
    timedOut: false,
    prereqFailure: 'isolation: consumer is inside fixture source',
  });
  assert.equal(r.outcome, 'INCONCLUSIVE', 'isolation failure must yield INCONCLUSIVE even with exit 0');
  assert.match(r.reason, /prerequisite|isolat/i);
});

test('classify: contractHashChanged → INCONCLUSIVE even when contractExit is 0', async () => {
  // Regression for false-PASS control #2: changed contract hash must block PASS
  const { classify } = await import('../src/classify.mjs');
  const r = classify({
    packExit: 0,
    installExit: 0,
    contractExit: 0,
    timedOut: false,
    contractHashChanged: 'before=AAA after=BBB',
  });
  assert.equal(r.outcome, 'INCONCLUSIVE', 'changed contract hash must yield INCONCLUSIVE even with exit 0');
  assert.match(r.reason, /changed|hash/i);
});

// ---------------------------------------------------------------------------
// §12. verify.mjs — ancestor node_modules detection
// ---------------------------------------------------------------------------

test('verify: ancestor node_modules detection', async () => {
  const { verifyRun } = await import('../src/verify.mjs');
  const tmp = makeTmpDir('packproof-ancestor-');
  try {
    // Create a fake node_modules one level above the consumer
    const ancestorNm = join(tmp, 'node_modules');
    mkdirSync(ancestorNm);
    writeFileSync(join(ancestorNm, '.keep'), '', 'utf8');

    const consumer = join(tmp, 'consumer-dir');
    mkdirSync(consumer);
    const fixtureElsewhere = join(tmp, 'fixture-elsewhere');
    mkdirSync(fixtureElsewhere);

    const result = verifyRun({
      consumerDir: consumer,
      fixtureDir: fixtureElsewhere,
      installedPkgDir: null,
      installedPkgName: null,
      expectedPackageName: null,
      installedIsSymlink: false,
      contractCopiedPath: null,
      contractCopiedSHA256: null,
    });

    assert.equal(result.isolation.status, 'fail', 'ancestor node_modules must fail isolation');
    assert.match(result.isolation.reason, /ancestor|node_modules/i);
  } finally {
    removeTmp(tmp);
  }
});
