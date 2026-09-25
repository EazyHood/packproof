import assert from 'node:assert/strict';
import { formatLabel } from '@packproof/labels';

// Deliberate negative control. Never weaken this expectation to turn it green.
const actual = formatLabel({ sku: 'SKU-042', quantity: 12, bin: 'B-7' });
assert.equal(actual, 'SKU-042 | QTY 999 | BIN B-7\n');
console.log('UNEXPECTED: deliberately wrong expectation passed');
