import assert from 'node:assert/strict';
import tally from '@packproof/tally';

const actual = tally.summarizeQuantities([
  { quantity: 2, unit: 'crate' },
  { quantity: 3, unit: 'unit' }
]);
assert.deepEqual(actual, { totalUnits: 11, lineCount: 2 });
console.log(JSON.stringify({ contract: 'tally-operation-v1', actual }));
