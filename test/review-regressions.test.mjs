// Independent Codex review regressions; original fixture contracts stay frozen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { runCase } from '../src/runner.mjs';
import { classify } from '../src/classify.mjs';
import { findNpmCliJs } from '../src/npm-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frozen = readFileSync(join(root, 'validation-fixtures/contracts/label-operation.mjs'), 'utf8');

function executeControl(t, suffix, appendedCode) {
  if (!findNpmCliJs()) { t.skip('npm CLI unavailable; full integration not executed'); return null; }
  const scratch = mkdtempSync(join(tmpdir(), `packproof-review-${suffix}-`));
  const contractFile = join(scratch, 'control.mjs');
  writeFileSync(contractFile, frozen + '\n' + appendedCode + '\n');
  return runCase({
    fixtureDir: join(root, 'validation-fixtures/labels-fixed'), contractFile,
    artifactDir: join(scratch, 'artifacts'), caseName: suffix, timeoutMs: 2000,
  });
}

test('review: modified executed contract blocks PASS while preserving actual exit 0', t => {
  const r = executeControl(t, 'self-change',
    'import { writeFileSync } from "node:fs"; writeFileSync(new URL(import.meta.url), "// changed\\n");');
  if (!r) return;
  assert.equal(r.report.contract.exitCode, 0);
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.equal(r.report.verify.contractHashAfter.status, 'fail');
});

test('review: unreadable executed copy after exit is INCONCLUSIVE, not PASS', t => {
  const r = executeControl(t, 'copy-is-directory',
    'import { unlinkSync, mkdirSync } from "node:fs"; const self=new URL(import.meta.url); unlinkSync(self); mkdirSync(self);');
  if (!r) return;
  assert.equal(r.report.contract.exitCode, 0);
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.notEqual(r.report.verify.contractHashAfter.status, 'pass');
});

test('review: installed package changed by operation invalidates archive byte evidence', t => {
  const r = executeControl(t, 'installed-change',
    'import { appendFileSync } from "node:fs"; appendFileSync(new URL(import.meta.resolve("@packproof/labels")), "\\n// changed after operation\\n");');
  if (!r) return;
  assert.equal(r.report.contract.exitCode, 0);
  assert.equal(r.outcome, 'INCONCLUSIVE');
  assert.equal(r.report.verify.before.installedBytes.status, 'pass');
  assert.equal(r.report.verify.installedBytes.status, 'fail');
});

test('review: error or signal evidence cannot be ignored because exit is zero', () => {
  for (const detail of [{ contractError: 'capture error' }, { contractSignal: 'SIGKILL' }]) {
    assert.equal(classify({ packExit: 0, installExit: 0, contractExit: 0,
      timedOut: false, ...detail }).outcome, 'INCONCLUSIVE');
  }
  assert.equal(classify({ packExit: 0, installExit: 0, timedOut: false }).outcome, 'INCONCLUSIVE');
});
