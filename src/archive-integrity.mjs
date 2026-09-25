/** Codex final review correction: bounded, in-memory verification of trusted npm tarballs.
 * Supports regular files, directories and local POSIX PAX metadata. Does not extract files.
 * Links, special files, GNU extensions and unsupported PAX keys are explicitly rejected.
 * This evidence check is not a sandbox for the later consumer execution.
 */
import { readFileSync, lstatSync, realpathSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join, relative, sep, isAbsolute } from 'node:path';

export const ARCHIVE_LIMITS = Object.freeze({ compressedBytes: 16 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024, entries: 4096 });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const decoder = new TextDecoder('utf-8', { fatal: true });
const norm = (p) => process.platform === 'win32' ? p.toLowerCase() : p;
const contained = (root, path) => {
  const r = relative(norm(root), norm(path));
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`));
};

function field(header, start, length) {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  if (end >= 0 && bytes.subarray(end).some((v) => v !== 0)) throw new Error('Malformed NUL-padded TAR field');
  return decoder.decode(end < 0 ? bytes : bytes.subarray(0, end));
}
function octal(header, start, length, label) {
  const raw = header.subarray(start, start + length);
  if (raw[0] & 0x80) throw new Error(`Unsupported binary TAR ${label}`);
  const text = raw.toString('ascii').replace(/\0/g, '').trim();
  if (!/^[0-7]*$/.test(text)) throw new Error(`Invalid TAR ${label}`);
  const value = text ? Number.parseInt(text, 8) : 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid TAR ${label}`);
  return value;
}
function archivePath(raw, directory = false) {
  if (typeof raw !== 'string' || !raw || /[\\\0:]/.test(raw) || raw.startsWith('/')) throw new Error('Unsafe TAR path');
  const clean = directory ? raw.replace(/\/+$/, '') : raw;
  const parts = clean.split('/');
  if (parts[0] !== 'package' || parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe npm TAR path: ${raw}`);
  if (parts.length === 1 && !directory) throw new Error('TAR package root must be a directory');
  if (process.platform === 'win32' && parts.some((part) => /[<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('TAR path unsupported on Windows');
  }
  return parts.slice(1).join('/');
}
function paxRecords(bytes) {
  const values = {};
  const allowed = new Set(['path', 'size', 'mtime', 'atime', 'ctime', 'uid', 'gid', 'uname', 'gname']);
  let cursor = 0;
  while (cursor < bytes.length) {
    const space = bytes.indexOf(32, cursor);
    if (space < 0 || space - cursor > 12) throw new Error('Invalid PAX record length');
    const lengthText = bytes.subarray(cursor, space).toString('ascii');
    if (!/^[1-9][0-9]*$/.test(lengthText)) throw new Error('Invalid PAX length');
    const length = Number(lengthText);
    if (!Number.isSafeInteger(length) || length <= space - cursor + 2 || cursor + length > bytes.length || bytes[cursor + length - 1] !== 10) throw new Error('Truncated PAX record');
    const record = decoder.decode(bytes.subarray(space + 1, cursor + length - 1));
    const equals = record.indexOf('=');
    if (equals < 1) throw new Error('Invalid PAX key/value');
    const key = record.slice(0, equals), value = record.slice(equals + 1);
    if (!allowed.has(key) || Object.hasOwn(values, key) || /[\0\n]/.test(value)) throw new Error(`Unsupported or duplicate PAX key: ${key}`);
    if (key === 'size' && (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new Error('Invalid PAX size');
    values[key] = value;
    cursor += length;
  }
  return values;
}

/** Parse only supported npm TAR structures. Returns Map(relative path -> Buffer). */
export function readNpmArchive(tgz, limits = ARCHIVE_LIMITS) {
  if (!Buffer.isBuffer(tgz) || tgz.length > limits.compressedBytes) throw new Error('Compressed archive exceeds limit');
  const tar = gunzipSync(tgz, { maxOutputLength: limits.expandedBytes });
  const files = new Map(), names = new Set();
  let offset = 0, entries = 0, pending = null, ended = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((v) => v === 0)) {
      if (tar.length - offset < 1024 || tar.subarray(offset).some((v) => v !== 0)) throw new Error('Invalid TAR end blocks');
      ended = true; break;
    }
    if (++entries > limits.entries) throw new Error('Archive entry count exceeds limit');
    const checksum = octal(header, 148, 8, 'checksum');
    let observed = 0;
    for (let i = 0; i < 512; i++) observed += i >= 148 && i < 156 ? 32 : header[i];
    if (checksum !== observed) throw new Error('TAR header checksum mismatch');
    const magic = field(header, 257, 6);
    if (magic !== 'ustar' && magic !== 'ustar ' && magic !== '') throw new Error('Unsupported TAR format');
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    if (!['0', '5', 'x'].includes(type)) throw new Error(`Unsupported TAR entry type ${type}`);
    if (field(header, 157, 100)) throw new Error('TAR link target is unsupported');
    const headerSize = octal(header, 124, 12, 'size');
    const size = type !== 'x' && pending?.size !== undefined ? Number(pending.size) : headerSize;
    if (!Number.isSafeInteger(size) || size < 0 || size > limits.expandedBytes || offset + 512 + size > tar.length) throw new Error('TAR entry is truncated or exceeds limit');
    const body = tar.subarray(offset + 512, offset + 512 + size);
    const next = offset + 512 + Math.ceil(size / 512) * 512;
    if (next > tar.length || tar.subarray(offset + 512 + size, next).some((v) => v !== 0)) throw new Error('Invalid TAR entry padding');
    const prefix = magic ? field(header, 345, 155) : '';
    const headerName = `${prefix ? prefix + '/' : ''}${field(header, 0, 100)}`;
    if (type === 'x') {
      if (pending) throw new Error('Consecutive PAX headers unsupported');
      pending = paxRecords(body);
    } else {
      const name = archivePath(pending?.path ?? headerName, type === '5');
      pending = null;
      const unique = norm(name);
      if (names.has(unique)) throw new Error(`Duplicate TAR path: ${name}`);
      names.add(unique);
      if (type === '5') {
        if (size !== 0) throw new Error('Directory TAR entry has data');
      } else files.set(name, Buffer.from(body));
    }
    offset = next;
  }
  if (!ended || pending || !files.has('package.json')) throw new Error('Incomplete npm archive or missing package.json');
  return files;
}

/** Compare actual archive bytes with every installed regular file; no extraction to disk. */
export function verifyArchiveIntegrity({ tarballPath, archiveSHA256, installedPkgDir }) {
  try {
    if (!tarballPath || !installedPkgDir || typeof archiveSHA256 !== 'string' || !/^[a-f0-9]{64}$/i.test(archiveSHA256)) throw new Error('Archive path, installed directory and recorded SHA-256 are required');
    const stat = lstatSync(tarballPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > ARCHIVE_LIMITS.compressedBytes) throw new Error('Archive is not a supported bounded regular file');
    const raw = readFileSync(tarballPath);
    const actualArchiveSHA256 = digest(raw);
    if (actualArchiveSHA256 !== archiveSHA256.toUpperCase()) throw new Error('Archive SHA-256 changed since packing');
    const entries = readNpmArchive(raw);
    const baseStat = lstatSync(installedPkgDir);
    if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) throw new Error('Installed package directory is linked or invalid');
    const root = realpathSync(installedPkgDir);
    const files = [];
    for (const [name, bytes] of entries) {
      let current = root;
      const parts = name.split('/');
      for (let i = 0; i < parts.length; i++) {
        current = join(current, parts[i]);
        const item = lstatSync(current);
        if (item.isSymbolicLink() || (i < parts.length - 1 ? !item.isDirectory() : !item.isFile())) throw new Error(`Installed path is linked or not a regular file: ${name}`);
        if (!contained(root, realpathSync(current))) throw new Error(`Installed path escapes package: ${name}`);
      }
      const item = lstatSync(current);
      if (item.size !== bytes.length || !readFileSync(current).equals(bytes)) throw new Error(`Installed bytes differ from archive: ${name}`);
      files.push({ path: name, size: bytes.length, sha256: digest(bytes) });
    }
    // Additional installed files are not vouched for by this archive; don't silently bless them.
    let visited = 0;
    const walk = (dir, prefix = '') => {
      for (const name of readdirSync(dir)) {
        if (++visited > ARCHIVE_LIMITS.entries) throw new Error('Installed entry count exceeds limit');
        const path = join(dir, name), rel = prefix ? `${prefix}/${name}` : name;
        const item = lstatSync(path);
        if (item.isSymbolicLink()) throw new Error(`Unexpected installed link: ${rel}`);
        if (item.isDirectory()) walk(path, rel);
        else if (!item.isFile() || !entries.has(rel)) throw new Error(`Installed file not present in archive: ${rel}`);
      }
    };
    walk(root);
    return { status: 'pass', reason: 'Every archived regular file matches installed bytes; no extra installed files',
      archiveSHA256: actualArchiveSHA256, fileCount: files.length, files };
  } catch (e) { return { status: 'fail', reason: `Archive integrity unverified: ${e.message}`, fileCount: 0 }; }
}
