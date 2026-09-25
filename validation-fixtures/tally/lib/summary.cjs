'use strict';

const multipliers = require('../data/units.json');

/** Convert trusted fictional stock rows to their unit total. */
function summarizeQuantities(rows) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  let totalUnits = 0;
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.quantity) || row.quantity < 0) {
      throw new TypeError('each quantity must be a nonnegative safe integer');
    }
    if (!Object.hasOwn(multipliers, row.unit)) throw new TypeError('unknown unit');
    totalUnits += row.quantity * multipliers[row.unit];
    if (!Number.isSafeInteger(totalUnits)) throw new RangeError('total exceeds safe integer range');
  }
  return { totalUnits, lineCount: rows.length };
}

module.exports = { summarizeQuantities };
