'use strict';
// Where the portal keeps its files: uploaded builds, cover images and the JSON data (accounts, catalogue...).
//   LocalBlobs - a folder on this computer (development, or running the portal on a PC)
//   R2Blobs    - a Cloudflare R2 bucket (Render and other hosts with a temporary disk)

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
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

class R2Blobs {
  constructor({ accountId, accessKeyId, secretAccessKey, bucket, endpoint }) {
    this.s3 = new S3Client({ endpoint: endpoint || `https://${accountId}.r2.cloudflarestorage.com`, bucket, accessKeyId, secretAccessKey });
    this.kind = 'r2';
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
    const res = await this.s3.get(key);
    if (!res) return null;
    return { stream: Readable.fromWeb(res.body), size: parseInt(res.headers.get('content-length') || '0', 10) || undefined };
  }

  async deletePrefix(prefix) {
    await this.s3.deletePrefix(prefix.endsWith('/') ? prefix : prefix + '/');
  }

  async remove(key) {
    await this.s3.delete(key);
  }

  /** Quick check at startup so a wrong key or bucket name shows a clear message. */
  async check() {
    await this.s3.list('data/');
  }
}

function createBlobs(env, localDir) {
  if ((env.STORAGE || '').toLowerCase() === 'r2') {
    const need = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
    const missing = need.filter((k) => !env[k]);
    if (missing.length) throw new Error(`STORAGE=r2 needs these environment variables: ${missing.join(', ')}`);
    return new R2Blobs({ accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET, endpoint: env.R2_ENDPOINT });
  }
  return new LocalBlobs(localDir);
}

module.exports = { createBlobs, LocalBlobs, R2Blobs, walk };
