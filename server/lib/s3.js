'use strict';
// Minimal S3 client for Cloudflare R2 (AWS Signature V4), using only Node built-ins (crypto + fetch).
// Supports the calls the portal needs: PUT (streamed from a file), GET (streamed), HEAD, DELETE, LIST.

const crypto = require('crypto');
const fs = require('fs');
const { Readable } = require('stream');

const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const EMPTY_HASH = sha256hex('');

/** RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* alone). */
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/**
 * Signs a request in place: adds x-amz-date (and keeps any x-amz-content-sha256 the caller set) and returns the
 * Authorization header. `url` is a URL object; `headers` is a plain object of lower-case names.
 */
function signV4({ method, url, headers, payloadHash, accessKeyId, secretAccessKey, region, service, date = new Date() }) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  headers['x-amz-date'] = amzDate;
  headers.host = url.host;

  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalUri = url.pathname.split('/').map((seg) => enc(decodeURIComponent(seg))).join('/') || '/';
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [enc(k), enc(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('&');

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, dateStamp), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

class S3Client {
  /** endpoint e.g. https://<accountid>.r2.cloudflarestorage.com */
  constructor({ endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto' }) {
    this.endpoint = endpoint.replace(/\/+$/, '');
    this.bucket = bucket;
    this.creds = { accessKeyId, secretAccessKey, region, service: 's3' };
  }

  url(key, query) {
    const u = new URL(key ? `${this.endpoint}/${this.bucket}/${key.split('/').map(enc).join('/')}` : `${this.endpoint}/${this.bucket}`);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, v);
    return u;
  }

  async request(method, key, { query, headers = {}, body, payloadHash = EMPTY_HASH, okStatuses = [200, 204, 206, 304] } = {}) {
    const url = this.url(key, query);
    const h = { ...headers, 'x-amz-content-sha256': payloadHash };
    h.authorization = signV4({ method, url, headers: h, payloadHash, ...this.creds });
    delete h.host; // fetch sets Host itself
    const res = await fetch(url, { method, headers: h, body, duplex: body ? 'half' : undefined });
    if (!okStatuses.includes(res.status)) {
      const text = await res.text().catch(() => '');
      const code = (text.match(/<Code>([^<]+)<\/Code>/) || [])[1];
      const err = new Error(`R2 ${method} ${key}: ${res.status}${code ? ' ' + code : ''}`);
      err.status = res.status;
      err.code = code;
      throw err;
    }
    return res;
  }

  /** Upload a local file (streamed, not loaded into memory). */
  async putFile(key, filePath, contentType = 'application/octet-stream') {
    const size = fs.statSync(filePath).size;
    const res = await this.request('PUT', key, {
      headers: { 'content-type': contentType, 'content-length': String(size) },
      body: size ? Readable.toWeb(fs.createReadStream(filePath)) : Buffer.alloc(0),
      payloadHash: 'UNSIGNED-PAYLOAD', // allowed over HTTPS; avoids hashing big files twice
    });
    await res.arrayBuffer();
  }

  async putBuffer(key, buf, contentType = 'application/octet-stream') {
    const res = await this.request('PUT', key, { headers: { 'content-type': contentType, 'content-length': String(buf.length) }, body: buf, payloadHash: sha256hex(buf) });
    await res.arrayBuffer();
  }

  /** Returns the fetch Response (body is a web stream) or null when the object does not exist. */
  async get(key, headers = {}) {
    try {
      return await this.request('GET', key, { headers });
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async getBuffer(key) {
    const res = await this.get(key);
    return res ? Buffer.from(await res.arrayBuffer()) : null;
  }

  async delete(key) {
    const res = await this.request('DELETE', key, { okStatuses: [200, 204, 404] });
    await res.arrayBuffer();
  }

  /** All keys under a prefix. */
  async list(prefix) {
    const keys = [];
    let token;
    do {
      const res = await this.request('GET', '', { query: { 'list-type': '2', prefix, 'continuation-token': token } });
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
      token = (xml.match(/<IsTruncated>true<\/IsTruncated>/) && (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) || [])[1]) || undefined;
    } while (token);
    return keys;
  }

  async deletePrefix(prefix) {
    const keys = await this.list(prefix);
    for (let i = 0; i < keys.length; i += 8) await Promise.all(keys.slice(i, i + 8).map((k) => this.delete(k)));
    return keys.length;
  }
}

module.exports = { S3Client, signV4, sha256hex };
