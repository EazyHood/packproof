import { readFileSync } from 'node:fs';

/** Format a fictional inventory label using the packaged template. */
export function formatLabel({ sku, quantity, bin }) {
  if (typeof sku !== 'string' || !/^[A-Z0-9-]+$/.test(sku)) {
    throw new TypeError('sku must contain uppercase letters, digits or hyphens');
  }
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new TypeError('quantity must be a nonnegative safe integer');
  }
  if (typeof bin !== 'string' || !/^[A-Z0-9-]+$/.test(bin)) {
    throw new TypeError('bin must contain uppercase letters, digits or hyphens');
  }
  const template = readFileSync(new URL('./templates/label.txt', import.meta.url), 'utf8');
  return template
    .replaceAll('{{sku}}', sku)
    .replaceAll('{{quantity}}', String(quantity))
    .replaceAll('{{bin}}', bin);
}
