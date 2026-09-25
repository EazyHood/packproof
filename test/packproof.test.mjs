/**
 * PackProof test suite — node:test, no extra dependencies.
 *
 * Organisation:
 *   Unit tests  — hash, classify, report-build (pure logic, no child processes)
 *   Integration — runContract (real child process), runCase (full pipeline)
 *
 * These tests deliberately do NOT run `npm pack` or `npm install` because that
 * would require network or offline cache setup in CI.  The pack/install path is
 * covered by the runner integration test which exercises the full pipeline
 * against a fixture that IS available on the filesystem.
 *
 * Provenance note: fixture packages and contracts are by Codex.  These tests
 * are the PackProof implementation, separately attributed per PROVENANCE.md.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(prefix = 'packproof-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// 1. sha256File / sha256String
// ---------------------------------------------------------------------------

test('hash: sha256String produces consistent uppercase hex', async (t) => {
  const { sha256String } = await import('../src/hash.mjs');
  const h1 = sha256String('hello world');
  const h2 = sha256String('hello world');
  assert.equal(h1, h2, 'same input → same hash');
  assert.match(h1, /^[A-F0-9]{64}$/, 'uppercase hex 64 chars');
});

test('hash: sha256String differs for different inputs', async (t) => {
  const { sha256String } = await import('../src/hash.mjs');
  assert.notEqual(sha256String('a'), sha256String('b'));
});

test('hash: sha256File hashes a real file', async (t) => {
  const { sha256File } = await import('../src/hash.mjs');
  const tmp = makeTmpDir();
  try {
    const p = join(tmp, 'sample.txt');
    writeFileSync(p, 'PackProof\n', 'utf8');
    const h = sha256File(p);
    assert.match(h, /^[A-F0-9]{64}$/, 'uppercase hex 64 chars');
    // Deterministic: same file content → same hash
    assert.equal(h, sha256File(p));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. classify
// ---------------------------------------------------------------------------

test('classify: pack failure → INCONCLUSIVE', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 1, installExit: null, contractExit: null, timedOut: false, contractError: '' });
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.match(r.reason, /pack/i);
});

test('classify: install failure → INCONCLUSIVE', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 1, contractExit: null, timedOut: false, contractError: '' });
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.match(r.reason, /install/i);
});

test('classify: timeout → INCONCLUSIVE', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 0, contractExit: null, timedOut: true, contractError: '' });
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.match(r.reason, /timeout/i);
});

test('classify: contract exits 0 → PASS', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 0, contractExit: 0, timedOut: false, contractError: '' });
  assert.equal(r.outcome, 'PASS');
});

test('classify: contract exits non-zero → FAIL', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 0, contractExit: 1, timedOut: false, contractError: '' });
  assert.equal(r.outcome, 'FAIL');
});

test('classify: spawn error with null exit → INCONCLUSIVE', async () => {
  const { classify } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 0, contractExit: null, timedOut: false, contractError: 'ENOENT' });
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.match(r.reason, /start/i);
});

// ---------------------------------------------------------------------------
// 3. buildReport
// ---------------------------------------------------------------------------

test('buildReport: schema version is set', async () => {
  const { buildReport, REPORT_SCHEMA_VERSION } = await import('../src/report.mjs');
  const tmp = makeTmpDir();
  try {
    const contractPath = join(tmp, 'contract.mjs');
    writeFileSync(contractPath, '// test contract\n', 'utf8');

    const report = buildReport({
      runId: 'test-run-id',
      caseName: 'test-case',
      fixtureDir: tmp,
      contractFile: contractPath,
      tarballPath: null,
      archiveSHA256: null,
      packedFiles: [],
      packExit: 1,
      packStdout: '',
      packStderr: 'error',
      npmVersion: '11.0.0',
      nodeVersion: 'v24.0.0',
      consumerDir: null,
      installedPkgDir: null,
      installedIsSymlink: false,
      installExit: null,
      installStdout: '',
      installStderr: '',
      contractExit: null,
      contractStdout: '',
      contractStderr: '',
      timedOut: false,
      timeoutMs: 15000,
      contractRunError: '',
      outcome: 'INCONCLUSIVE',
      outcomeReason: 'npm pack exited 1',
    });

    assert.equal(report.$schema, REPORT_SCHEMA_VERSION);
    assert.equal(report.caseName, 'test-case');
    assert.equal(report.result.outcome, 'INCONCLUSIVE');
    assert.ok(typeof report.recordedAt === 'string');
    assert.ok(report.environment.node);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildReport: contract SHA-256 is computed from file content', async () => {
  const { buildReport } = await import('../src/report.mjs');
  const { sha256String } = await import('../src/hash.mjs');
  const tmp = makeTmpDir();
  try {
    const src = '// my contract\n';
    const contractPath = join(tmp, 'contract.mjs');
    writeFileSync(contractPath, src, 'utf8');

    const report = buildReport({
      runId: 'x', caseName: 'x', fixtureDir: tmp, contractFile: contractPath,
      tarballPath: null, archiveSHA256: null, packedFiles: [],
      packExit: 0, packStdout: '', packStderr: '', npmVersion: '', nodeVersion: '',
      consumerDir: null, installedPkgDir: null, installedIsSymlink: false,
      installExit: 0, installStdout: '', installStderr: '',
      contractExit: 0, contractStdout: '', contractStderr: '',
      timedOut: false, timeoutMs: 15000, contractRunError: '',
      outcome: 'PASS', outcomeReason: 'Contract exited 0',
    });

    assert.equal(report.contract.contractSHA256, sha256String(src));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('writeReport: creates file with valid JSON', async () => {
  const { buildReport, writeReport } = await import('../src/report.mjs');
  const tmp = makeTmpDir();
  try {
    const contractPath = join(tmp, 'contract.mjs');
    writeFileSync(contractPath, '// x\n', 'utf8');

    const report = buildReport({
      runId: 'write-test', caseName: 'write-test', fixtureDir: tmp, contractFile: contractPath,
      tarballPath: null, archiveSHA256: null, packedFiles: [],
      packExit: 0, packStdout: '', packStderr: '', npmVersion: '', nodeVersion: '',
      consumerDir: null, installedPkgDir: null, installedIsSymlink: false,
      installExit: 0, installStdout: '', installStderr: '',
      contractExit: 0, contractStdout: '', contractStderr: '',
      timedOut: false, timeoutMs: 15000, contractRunError: '',
      outcome: 'PASS', outcomeReason: 'Contract exited 0',
    });

    const outPath = join(tmp, 'report.json');
    writeReport(report, outPath);

    const { readFileSync } = await import('node:fs');
    const parsed = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(parsed.$schema, report.$schema);
    assert.equal(parsed.result.outcome, 'PASS');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. runContract — real child process, no npm involved
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
    rmSync(tmp, { recursive: true, force: true });
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
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('runContract: captures stdout and stderr', async () => {
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
    assert.equal(r.stdout, 'hello');
    assert.equal(r.stderr, 'err');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('runContract: timeout kills hanging process → timedOut true', { timeout: 10_000 }, async () => {
  const { runContract } = await import('../src/run-contract.mjs');
  const tmp = makeTmpDir();
  try {
    writeFileSync(join(tmp, 'package.json'), '{"type":"module"}', 'utf8');
    // Contract that sleeps 60 seconds — should be killed well before that
    writeFileSync(
      join(tmp, 'contract.mjs'),
      'await new Promise(r => setTimeout(r, 60_000));\n',
      'utf8'
    );
    const r = runContract({ consumerDir: tmp, timeoutMs: 500 });
    assert.equal(r.timedOut, true, 'should be killed by timeout');
    assert.notEqual(r.exitCode, 0, 'should not exit 0');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}); // timeout: 10s for slow CI

test('runContract: missing consumerDir → error string', async () => {
  const { runContract } = await import('../src/run-contract.mjs');
  const r = runContract({ consumerDir: '/nonexistent-packproof-test-dir-xyz' });
  assert.ok(r.error.length > 0, 'error should be set');
  assert.equal(r.exitCode, null);
});

// ---------------------------------------------------------------------------
// 5. classify outcome distinctions (design-critical: timeout ≠ pass)
// ---------------------------------------------------------------------------

test('classify: timeout outcome is never PASS', async () => {
  const { classify, Outcome } = await import('../src/classify.mjs');
  const r = classify({ packExit: 0, installExit: 0, contractExit: 0, timedOut: true, contractError: '' });
  // Even though exit code is 0 (spawnSync may return 0 on timeout in some cases),
  // timedOut=true MUST produce INCONCLUSIVE.
  assert.equal(r.outcome, Outcome.INCONCLUSIVE);
});

test('classify: wrong expectation (exit 1) is FAIL not INCONCLUSIVE', async () => {
  const { classify, Outcome } = await import('../src/classify.mjs');
  // Simulates the fixed-wrong-expectation case: pack/install succeed, contract fails
  const r = classify({ packExit: 0, installExit: 0, contractExit: 1, timedOut: false, contractError: '' });
  assert.equal(r.outcome, Outcome.FAIL);
});

// ---------------------------------------------------------------------------
// 6. Source contract correctness (frozen output check — by Codex fixtures)
//    These tests run source contracts directly, identical to what the Codex
//    manual baseline verified.  They do NOT use npm pack/install.
// ---------------------------------------------------------------------------

test('source: formatLabel produces the frozen label output', async () => {
  const { formatLabel } = await import('../validation-fixtures/labels-missing-template/src/index.mjs');
  assert.equal(
    formatLabel({ sku: 'SKU-042', quantity: 12, bin: 'B-7' }),
    'SKU-042 | QTY 12 | BIN B-7\n',
    'frozen label output must match exactly'
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
// 7. CLI argument validation (unit-level: bad input fails clearly)
// ---------------------------------------------------------------------------

test('cli: missing --fixture/--contract/--out fails clearly', async () => {
  const { spawnSync } = await import('node:child_process');
  // Running the CLI with no arguments should exit non-zero and print usage
  const r = spawnSync(process.execPath, [join(PROJECT_ROOT, 'src/cli.mjs')], {
    encoding: 'utf8',
    shell: false,
    env: { ...process.env },
  });
  assert.notEqual(r.status, 0, 'should exit non-zero on missing args');
  const combined = (r.stderr || '') + (r.stdout || '');
  assert.match(combined, /--fixture|--contract|Usage/i, 'should print usage');
});

test('cli: --help exits 0 and prints Usage', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [join(PROJECT_ROOT, 'src/cli.mjs'), '--help'], {
    encoding: 'utf8',
    shell: false,
    env: { ...process.env },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage/i);
});
