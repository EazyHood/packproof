import assert from 'node:assert/strict';
import { formatLabel } from '@packproof/labels';

// Deliberately incomplete coverage: no template-backed operation is executed.
assert.equal(typeof formatLabel, 'function');
console.log(JSON.stringify({ contract: 'label-import-only-v1', operationExercised: false }));
