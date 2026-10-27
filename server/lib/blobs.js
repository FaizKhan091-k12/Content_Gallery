'use strict';
// Where the portal keeps its files: uploaded builds, cover images and the JSON data (accounts, catalogue...).
//   LocalBlobs  - a folder on this computer (development, or running the portal on a PC)
//   BucketBlobs - a cloud bucket: Cloudflare R2, Backblaze B2 or any S3-compatible service
//                 (Render and other hosts with a temporary disk)

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { S3Client } = require('./s3');

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

class LocalBlobs {
  constructor(baseDir) {
    this.base = path.resolve(baseDir);
    fs.mkdirSync(this.base, { recursive: true });
    this.kind = 'local';
  }

  file(key) {
    const full = path.resolve(this.base, key);
    if (!full.startsWith(this.base + path.sep)) throw new Error('Bad storage key.');
    return full;
  }

  async readJson(key) {
    try { return JSON.parse(fs.readFileSync(this.file(key), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }

  async writeJson(key, value) {
    const target = this.file(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, target);
  }

  async putBuffer(key, buf) {
    const target = this.file(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
  }

  /** Moves a processed build folder into storage under `prefix`. */
  async putDir(localDir, prefix) {
    const target = this.file(prefix);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try { fs.renameSync(localDir, target); } catch { fs.cpSync(localDir, target, { recursive: true }); fs.rmSync(localDir, { recursive: true, force: true }); }
  }

  /** { stream, size } or null */
  async open(key) {
    let full;
    try { full = this.file(key); } catch { return null; }
    let st;
    try { st = fs.statSync(full); } catch { return null; }
    if (!st.isFile()) return null;
    return { stream: fs.createReadStream(full), size: st.size };
  }

  async deletePrefix(prefix) {
    fs.rmSync(this.file(prefix), { recursive: true, force: true });
  }

  async remove(key) {
    fs.rmSync(this.file(key), { force: true });
  }
}

/**
 * Copies of game files on the server's own (temporary) disk, so each file is downloaded from the bucket
 * once per server start instead of once per player. Builds and covers are stored under versioned names,
 * so a cached copy never goes stale. The least recently used files go first when the cache is full.
 */
class DiskCache {
  constructor(dir, maxBytes) {
    this.dir = dir;
    this.max = maxBytes;
    this.sizes = new Map(); // key -> bytes, least recently used first
    this.total = 0;
    this.seq = 0;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }

  file(key) {
    return path.join(this.dir, crypto.createHash('sha1').update(key).digest('hex'));
  }

  get(key) {
    const size = this.sizes.get(key);
    if (size === undefined) return null;
    this.sizes.delete(key);
    this.sizes.set(key, size);
    return { stream: fs.createReadStream(this.file(key)), size };
  }

  /** Passes the bucket download through unchanged and keeps a copy if it arrives complete. */
  fill(key, source, size) {
    if (!size || size > this.max / 4) return source;
    const tmp = `${this.file(key)}.${++this.seq}.part`;
    const out = fs.createWriteStream(tmp);
    let bytes = 0;
    let failed = false;
    out.on('error', () => { failed = true; });
    const tee = new Transform({
      transform(chunk, _enc, done) {
        bytes += chunk.length;
        if (!failed) out.write(chunk);
        done(null, chunk);
      },
      flush: (done) => {
        out.end(() => {
          if (!failed && bytes === size) this.add(key, tmp, size);
          else fs.rm(tmp, { force: true }, () => {});
        });
        done();
      },
    });
    // the player went away mid-download: drop the partial copy
    tee.on('close', () => {
      if (!tee.writableFinished) { out.destroy(); fs.rm(tmp, { force: true }, () => {}); }
    });
    source.on('error', (e) => tee.destroy(e));
    return source.pipe(tee);
  }

  add(key, tmp, size) {
    try { fs.renameSync(tmp, this.file(key)); } catch { fs.rm(tmp, { force: true }, () => {}); return; }
    if (!this.sizes.has(key)) this.total += size;
    this.sizes.delete(key);
    this.sizes.set(key, size);
    for (const [k, n] of this.sizes) {
      if (this.total <= this.max) break;
      this.drop(k, n);
    }
  }

  drop(key, size = this.sizes.get(key)) {
    if (size === undefined) return;
    this.sizes.delete(key);
    this.total -= size;
    fs.rm(this.file(key), { force: true }, () => {});
  }

  dropPrefix(prefix) {
    for (const k of [...this.sizes.keys()]) if (k.startsWith(prefix)) this.drop(k);
  }
}

class BucketBlobs {
  /** label is only for messages, e.g. 'Cloudflare R2'. cacheDir/cacheBytes: see DiskCache (0 bytes = no cache). */
  constructor({ endpoint, region, bucket, accessKeyId, secretAccessKey, label, cacheDir, cacheBytes }) {
    this.s3 = new S3Client({ endpoint, region, bucket, accessKeyId, secretAccessKey });
    this.kind = 'bucket';
    this.label = `${label} bucket "${bucket}"`;
    this.cache = cacheBytes > 0 ? new DiskCache(cacheDir, cacheBytes) : null;
  }

  async readJson(key) {
    const buf = await this.s3.getBuffer(key);
    return buf ? JSON.parse(buf.toString('utf8')) : null;
  }

  async writeJson(key, value) {
    await this.s3.putBuffer(key, Buffer.from(JSON.stringify(value)), 'application/json');
  }

  async putBuffer(key, buf, type) {
    await this.s3.putBuffer(key, buf, type);
  }

  /** Uploads every file of a processed build folder (4 at a time), then removes the local copy. */
  async putDir(localDir, prefix) {
    const files = walk(localDir);
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const rel = files[next++];
        await this.s3.putFile(`${prefix}/${rel}`, path.join(localDir, rel));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    fs.rmSync(localDir, { recursive: true, force: true });
  }

  async open(key) {
    const cached = this.cache && this.cache.get(key);
    if (cached) return cached;
    const res = await this.s3.get(key);
    if (!res) return null;
    const size = parseInt(res.headers.get('content-length') || '0', 10) || undefined;
    const stream = Readable.fromWeb(res.body);
    return { stream: this.cache ? this.cache.fill(key, stream, size) : stream, size };
  }

  async deletePrefix(prefix) {
    const dir = prefix.endsWith('/') ? prefix : prefix + '/';
    if (this.cache) this.cache.dropPrefix(dir);
    await this.s3.deletePrefix(dir);
  }

  async remove(key) {
    if (this.cache) this.cache.drop(key);
    await this.s3.delete(key);
  }

  /** Quick check at startup so a wrong key or bucket name shows a clear message. */
  async check() {
    await this.s3.list('data/');
  }
}

function requireEnv(env, mode, names) {
  const missing = names.filter((k) => !env[k]);
  if (missing.length) throw new Error(`STORAGE=${mode} needs these environment variables: ${missing.join(', ')}`);
}

function createBlobs(env, localDir) {
  const mode = (env.STORAGE || '').toLowerCase();
  const cache = {
    cacheDir: path.join(env.GP_TMP || os.tmpdir(), 'game-portal-cache'),
    cacheBytes: (env.GP_CACHE_MB !== undefined ? Number(env.GP_CACHE_MB) : 1024) * 1024 * 1024,
  };
  if (mode === 'r2') {
    requireEnv(env, mode, ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']);
    return new BucketBlobs({
      endpoint: env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, region: 'auto', label: 'Cloudflare R2',
      bucket: env.R2_BUCKET, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, ...cache,
    });
  }
  if (mode === 's3') {
    requireEnv(env, mode, ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET']);
    const endpoint = /^https?:\/\//.test(env.S3_ENDPOINT) ? env.S3_ENDPOINT : `https://${env.S3_ENDPOINT}`;
    // Backblaze B2 and AWS endpoints name their region: https://s3.us-east-005.backblazeb2.com
    const region = env.S3_REGION || (/^https?:\/\/s3[.-]([a-z0-9-]+)\./.exec(endpoint) || [])[1] || 'us-east-1';
    return new BucketBlobs({
      endpoint, region, label: 'storage',
      bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, ...cache,
    });
  }
  return new LocalBlobs(localDir);
}

module.exports = { createBlobs, LocalBlobs, BucketBlobs, walk };
