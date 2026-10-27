'use strict';
// Minimal ZIP reader (stored + deflate entries, ZIP64 sizes) so builds can be uploaded as a single .zip
// without any third-party package. Reads the central directory, so archives with data descriptors work.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function findEnd(buf) {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('Not a valid .zip file (end record missing).');
}

function zip64Extra(extra, need) {
  // need: which fields were 0xFFFFFFFF, in order: size, compressed size, local header offset
  let i = 0;
  while (i + 4 <= extra.length) {
    const id = extra.readUInt16LE(i);
    const len = extra.readUInt16LE(i + 2);
    if (id === 0x0001) {
      let p = i + 4;
      const out = {};
      for (const key of need) { out[key] = Number(extra.readBigUInt64LE(p)); p += 8; }
      return out;
    }
    i += 4 + len;
  }
  return {};
}

/** Lists entries: { name, method, compressedSize, size, offset, isDir }. */
function listEntries(buf) {
  const end = findEnd(buf);
  let count = buf.readUInt16LE(end + 10);
  let cdOffset = buf.readUInt32LE(end + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const locator = end - 20;
    if (buf.readUInt32LE(locator) === 0x07064b50) {
      const z64 = Number(buf.readBigUInt64LE(locator + 8));
      count = Number(buf.readBigUInt64LE(z64 + 32));
      cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
    }
  }
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged .zip (central directory).');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    let compressedSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let offset = buf.readUInt32LE(p + 42);
    const nameBuf = buf.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800 ? nameBuf.toString('utf8') : nameBuf.toString('latin1')).replace(/\\/g, '/');
    const need = [];
    if (size === 0xffffffff) need.push('size');
    if (compressedSize === 0xffffffff) need.push('compressedSize');
    if (offset === 0xffffffff) need.push('offset');
    if (need.length) {
      const z = zip64Extra(buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen), need);
      size = z.size ?? size; compressedSize = z.compressedSize ?? compressedSize; offset = z.offset ?? offset;
    }
    entries.push({ name, method, compressedSize, size, offset, isDir: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function entryData(buf, e) {
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error('Damaged .zip (local header).');
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return raw;
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`Unsupported compression in .zip (method ${e.method}). Re-zip with standard "Deflate".`);
}

/** Safe relative path (no absolute paths, no "..", no drive letters). */
function safeRelative(name) {
  const parts = name.split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..' || /[<>:"|?*\x00-\x1f]/.test(s))) return null;
  return parts.join('/');
}

/** Extracts a zip file into destDir. Returns the number of files written. */
function extractZip(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  let files = 0;
  for (const e of listEntries(buf)) {
    if (e.isDir || e.name.startsWith('__MACOSX/')) continue;
    const rel = safeRelative(e.name);
    if (!rel) throw new Error(`Unsafe path in .zip: ${e.name}`);
    const target = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entryData(buf, e));
    files++;
  }
  return files;
}

module.exports = { extractZip, safeRelative };
