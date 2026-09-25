/**
 * Compute SHA-256 of a file without streaming — files are small tarballs.
 * Returns uppercase hex string.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * @param {string} filePath  Absolute or relative path to the file.
 * @returns {string}  Uppercase hex SHA-256.
 */
export function sha256File(filePath) {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex').toUpperCase();
}

/**
 * @param {string} content  String (UTF-8) to hash.
 * @returns {string}  Uppercase hex SHA-256.
 */
export function sha256String(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex').toUpperCase();
}
