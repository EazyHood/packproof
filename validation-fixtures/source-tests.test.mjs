import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import tally from './tally/lib/summary.cjs';

for (const variant of ['labels-missing-template', 'labels-fixed', 'labels-broken-export']) {
  test(`${variant}: source operation produces the frozen label`, async () => {
    const { formatLabel } = await import(`./${variant}/src/index.mjs`);
    assert.equal(formatLabel({ sku: 'SKU-042', quantity: 12, bin: 'B-7' }), 'SKU-042 | QTY 12 | BIN B-7\n');
    assert.throws(() => formatLabel({ sku: 'SKU-042', quantity: -1, bin: 'B-7' }), TypeError);
  });
}

test('missing and fixed variants differ only in the files allowlist', () => {
  const load = (variant) => JSON.parse(readFileSync(new URL(`./${variant}/package.json`, import.meta.url), 'utf8'));
  const { files: brokenFiles, ...brokenRest } = load('labels-missing-template');
  const { files: fixedFiles, ...fixedRest } = load('labels-fixed');
  assert.deepEqual(brokenFiles, ['src/index.mjs']);
  assert.deepEqual(fixedFiles, ['src']);
  assert.deepEqual(brokenRest, fixedRest);
  for (const relative of ['src/index.mjs', 'src/templates/label.txt']) {
    const original = readFileSync(new URL(`./labels-missing-template/${relative}`, import.meta.url));
    for (const variant of ['labels-fixed', 'labels-broken-export']) {
      assert.deepEqual(readFileSync(new URL(`./${variant}/${relative}`, import.meta.url)), original);
    }
  }
});

test('second library uses its independent CommonJS and JSON structure', () => {
  assert.deepEqual(tally.summarizeQuantities([{ quantity: 2, unit: 'crate' }, { quantity: 3, unit: 'unit' }]), { totalUnits: 11, lineCount: 2 });
  assert.deepEqual(tally.summarizeQuantities([]), { totalUnits: 0, lineCount: 0 });
  assert.throws(() => tally.summarizeQuantities([{ quantity: 1, unit: 'unknown' }]), TypeError);
});
