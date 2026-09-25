/** Independent Codex regressions for final evidence corrections; no npm or UI automation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync,
  symlinkSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, relative, sep, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readNpmArchive, verifyArchiveIntegrity, ARCHIVE_LIMITS } from '../src/archive-integrity.mjs';
import { verifyRun, checkIdentity, checkContractHash, checkIsolation } from '../src/verify.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'validation-fixtures');
const archived = join(fixtures, 'evidence', 'manual-2026-09-25-1030', 'artifacts');
const hash = (b) => createHash('sha256').update(b).digest('hex').toUpperCase();
function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'packproof-evidence-'));
  const assignedRoot = realpathSync(dir);
  t.after(() => {
    // Delete only the exact newly allocated test root, never a supplied input path.
    assert.equal(realpathSync(dir), assignedRoot);
    const rel = relative(realpathSync(tmpdir()), assignedRoot);
    assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
    assert.ok(rel.startsWith('packproof-evidence-'));
    rmSync(assignedRoot, { recursive: true, force: true });
  });
  return dir;
}
function tarEntry(name, data = '', type = '0') {
  const body = Buffer.from(data), h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  for (const [start, length, value] of [[100,8,0o644],[108,8,0],[116,8,0],[124,12,body.length],[136,12,0]]) {
    h.write(value.toString(8).padStart(length - 1, '0') + '\0', start, length, 'ascii');
  }
  h.fill(32,148,156); h[156] = type.charCodeAt(0); h.write('ustar\0',257,6); h.write('00',263,2);
  const sum = h.reduce((a,b) => a+b,0);
  h.write(sum.toString(8).padStart(6,'0') + '\0 ',148,8,'ascii');
  return Buffer.concat([h,body,Buffer.alloc((512 - body.length % 512) % 512)]);
}
function archive(entries) { return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])); }
const manifestEntry = () => tarEntry('package/package.json', '{"name":"test-pkg","version":"1.0.0"}');
function pax(key, value) {
  const body = `${key}=${value}\n`;
  let count = Buffer.byteLength(body) + 2;
  while (Buffer.byteLength(`${count} ${body}`) !== count) count = Buffer.byteLength(`${count} ${body}`);
  return `${count} ${body}`;
}
function put(rootDir, path, value) {
  const target = join(rootDir, ...path.split('/'));
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value);
  return target;
}

for (const [fixture, expectedFiles] of [
  ['labels-missing-template', ['LICENSE','package.json','src/index.mjs']],
  ['labels-fixed', ['LICENSE','package.json','src/index.mjs','src/templates/label.txt']],
  ['labels-broken-export', ['LICENSE','package.json','src/index.mjs','src/templates/label.txt']],
  ['tally', ['LICENSE','package.json','lib/summary.cjs','data/units.json']],
]) {
  test(`preserved real npm archive: ${fixture} matches independent fixture bytes`, (t) => {
    const dir = temp(t), pkg = join(dir, 'installed'); mkdirSync(pkg);
    for (const file of expectedFiles) put(pkg, file, readFileSync(join(fixtures, fixture, file)));
    const tgz = join(archived, fixture, fixture === 'tally' ? 'packproof-tally-1.0.0.tgz' : 'packproof-labels-1.0.0.tgz');
    const raw = readFileSync(tgz), parsed = readNpmArchive(raw);
    assert.deepEqual([...parsed.keys()].sort(), expectedFiles.slice().sort());
    const result = verifyArchiveIntegrity({ tarballPath: tgz, archiveSHA256: hash(raw), installedPkgDir: pkg });
    assert.equal(result.status, 'pass', result.reason);
    assert.equal(result.fileCount, expectedFiles.length);
  });
}

test('installed mutation, extra file and changed archive fingerprint cannot verify', (t) => {
  const dir = temp(t), pkg = join(dir, 'installed'); mkdirSync(pkg);
  const raw = archive([manifestEntry(),tarEntry('package/index.js','export const value = 1;')]);
  const tgz = put(dir,'test.tgz',raw);
  put(pkg,'package.json','{"name":"test-pkg","version":"1.0.0"}');
  put(pkg,'index.js','export const value = 1;');
  const args = { tarballPath: tgz, archiveSHA256: hash(raw), installedPkgDir: pkg };
  assert.equal(verifyArchiveIntegrity(args).status,'pass');
  put(pkg,'index.js','export const value = 2;');
  assert.match(verifyArchiveIntegrity(args).reason,/bytes differ/);
  put(pkg,'index.js','export const value = 1;');
  put(pkg,'unexpected.js','extra');
  assert.match(verifyArchiveIntegrity(args).reason,/not present in archive/);
  assert.match(verifyArchiveIntegrity({...args,archiveSHA256:'A'.repeat(64)}).reason,/SHA-256 changed/);
});

test('TAR checksum, truncation, path escape, duplicate path and links are rejected', () => {
  const raw = archive([manifestEntry()]);
  const broken = gunzipSync(raw); broken[0] ^= 1;
  assert.throws(() => readNpmArchive(gzipSync(broken)), /checksum/);
  assert.throws(() => readNpmArchive(gzipSync(gunzipSync(raw).subarray(0,512))), /truncated|padding|Incomplete/);
  for (const name of ['package/../escape','/package/a','package\\escape','package/C:/escape']) {
    assert.throws(() => readNpmArchive(archive([manifestEntry(),tarEntry(name,'x')])), /Unsafe/);
  }
  assert.throws(() => readNpmArchive(archive([manifestEntry(),manifestEntry()])),/Duplicate/);
  assert.throws(() => readNpmArchive(archive([manifestEntry(),tarEntry('package/link','','2')])),/Unsupported TAR entry type/);
});

test('valid UTF-8 local PAX path works; PAX escapes, bad lengths and unsupported metadata fail', () => {
  const longPath = `package/${'segment-'.repeat(15)}é.txt`;
  const parsed = readNpmArchive(archive([manifestEntry(),tarEntry('PaxHeader',pax('path',longPath),'x'),tarEntry('package/fallback','data')]));
  assert.equal(parsed.get(longPath.slice('package/'.length)).toString(),'data');
  assert.throws(() => readNpmArchive(archive([manifestEntry(),tarEntry('PaxHeader',pax('path','package/../escape'),'x'),tarEntry('package/fallback','data')])),/Unsafe/);
  assert.throws(() => readNpmArchive(archive([manifestEntry(),tarEntry('PaxHeader','99 path=package/test\n','x'),tarEntry('package/fallback','data')])),/PAX/);
  assert.throws(() => readNpmArchive(archive([manifestEntry(),tarEntry('PaxHeader',pax('linkpath','outside'),'x'),tarEntry('package/fallback','data')])),/Unsupported/);
});

test('decompression and entry bounds are enforced', () => {
  const raw = archive([manifestEntry(),tarEntry('package/data',Buffer.alloc(8192))]);
  assert.throws(() => readNpmArchive(raw,{...ARCHIVE_LIMITS,expandedBytes:1024}));
  assert.throws(() => readNpmArchive(raw,{...ARCHIVE_LIMITS,entries:1}),/entry count/);
  assert.throws(() => readNpmArchive(raw,{...ARCHIVE_LIMITS,compressedBytes:1}),/Compressed/);
});

test('identity selects the expected package, verifies actual manifest and refuses scoped ancestor links', (t) => {
  const dir = temp(t), consumer = join(dir,'consumer'); mkdirSync(consumer);
  put(consumer,'node_modules/aaa-other/package.json','{"name":"aaa-other"}');
  put(consumer,'node_modules/@packproof/labels/package.json','{"name":"@packproof/labels","version":"1.0.0"}');
  const args = {consumerDir:consumer,expectedPackageName:'@packproof/labels',installedPkgName:'aaa-other'};
  assert.equal(checkIdentity(args).status,'pass');
  put(consumer,'node_modules/@packproof/labels/package.json','{"name":"wrong"}');
  assert.equal(checkIdentity(args).status,'fail');
  const outside = join(dir,'outside');
  put(outside,'linked/package.json','{"name":"@linked/linked"}');
  symlinkSync(outside,join(consumer,'node_modules','@linked'),process.platform === 'win32' ? 'junction' : 'dir');
  assert.notEqual(checkIdentity({consumerDir:consumer,expectedPackageName:'@linked/linked'}).status,'pass');
});

test('required missing evidence and mutated/unreadable copied contract never pass', (t) => {
  assert.equal(verifyRun({}).allRequired,false);
  const dir = temp(t), copy = put(dir,'contract.mjs','console.log("a");');
  const before = hash(readFileSync(copy));
  assert.equal(checkContractHash({contractCopiedPath:copy,contractCopiedSHA256:before}).status,'pass');
  writeFileSync(copy,'console.log("b");');
  const changed = checkContractHash({contractCopiedPath:copy,contractCopiedSHA256:before});
  assert.equal(changed.status,'fail'); assert.equal(changed.beforeSHA256,before);
  assert.notEqual(changed.afterSHA256,before);
  assert.equal(checkContractHash({contractCopiedPath:copy,contractCopiedSHA256:null}).status,'fail');
  assert.notEqual(checkContractHash({contractCopiedPath:dir,contractCopiedSHA256:before}).status,'pass');
});

test('isolation rejects consumer within source and node_modules in its ancestor', (t) => {
  const dir = temp(t), fixture = join(dir,'source'), consumer = join(dir,'consumer');
  mkdirSync(fixture); mkdirSync(consumer);
  assert.equal(checkIsolation({consumerDir:fixture,fixtureDir:fixture}).status,'fail');
  mkdirSync(join(dir,'node_modules'));
  const result = checkIsolation({consumerDir:consumer,fixtureDir:fixture});
  assert.equal(result.status,'fail'); assert.match(result.reason,/Ancestor node_modules/);
});
