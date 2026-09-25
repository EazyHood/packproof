import assert from 'node:assert/strict';
import { formatLabel } from '@packproof/labels';

const actual = formatLabel({ sku: 'SKU-042', quantity: 12, bin: 'B-7' });
assert.equal(actual, 'SKU-042 | QTY 12 | BIN B-7\n');
console.log(JSON.stringify({ contract: 'label-operation-v1', actual }));
