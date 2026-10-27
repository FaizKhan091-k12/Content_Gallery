'use strict';
// Game Portal: a private, password-protected library of WebGL games and interactives organised by book
// (Subject > Grade > Unit > Lesson). Zero third-party dependencies: run with `node server/server.js`.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const { JsonStore } = require('./lib/store');
const { createBlobs, walk } = require('./lib/blobs');
const { Auth, httpError, publicUser, normalizeUsername } = require('./lib/auth');
const { loadCurriculum, lessonId } = require('./lib/curriculum');
const { extractZip, safeRelative } = require('./lib/unzip');
const { processBuild, CACHE_DIR } = require('./lib/webgl');

// ---- configuration (environment variables; see README)
//   STORAGE=r2 + R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET  -> files in Cloudflare R2
//   STORAGE=s3 + S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET    -> Backblaze B2 / any S3 service
//   GP_CACHE_MB    disk cache for game files when using a bucket (default 1024, 0 = off)
//   (default) local folder GP_STORAGE (data/ + games/ + thumbs/)
//   TRUST_PROXY=1  behind a hosting proxy (Render): use its X-Forwarded-* headers
//   SETUP_CODE     lets the first admin be created from any browser (needed on Render)
//   PORT, HOST
const ROOT = path.resolve(__dirname, '..');
const ENV = process.env;
const ON_RENDER = !!ENV.RENDER;
const TRUST_PROXY = ENV.TRUST_PROXY === '1' || ON_RENDER;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SEED_DIR = path.join(__dirname, 'seed');
const LOCAL_STORAGE = ENV.GP_STORAGE || path.join(ROOT, 'storage');
const STAGING_DIR = path.join(ENV.GP_TMP || os.tmpdir(), 'game-portal-staging');
fs.mkdirSync(STAGING_DIR, { recursive: true });

const blobs = createBlobs(ENV, LOCAL_STORAGE);
// Copying a build from a folder on the server machine only makes sense when the portal runs on your own PC.
const ALLOW_FOLDER_IMPORT = ENV.ALLOW_FOLDER_IMPORT ? ENV.ALLOW_FOLDER_IMPORT === '1' : !ON_RENDER && blobs.kind === 'local';
const store = new JsonStore(blobs);
const auth = new Auth(store);
const curriculum = () => loadCurriculum(store, SEED_DIR);

const DEFAULT_SETTINGS = { siteName: 'Game Portal', tagline: 'Books, flashcards, interactivities, simulations and games for every lesson', sessionDays: 14, port: 8642, host: '127.0.0.1' };
const settings = () => {
  const { lastAdminReset, ...s } = store.get('settings', {}); // internal marker, never sent to browsers
  return { ...DEFAULT_SETTINGS, ...s };
};

// What a resource is. Books are PDFs; everything else is a Unity WebGL (or HTML5) build.
const TYPES = ['Book', 'Flashcards', '2D Interactivity', '3D Interactivity', 'Simulation', 'Game', 'Animation'];
const LEGACY_TYPES = { Interactive: '2D Interactivity', Other: '2D Interactivity' };
const sourceOf = (type) => (type === 'Book' ? 'pdf' : 'build');
const MAX_FILE = 2 * 1024 ** 3;        // per uploaded file
const MAX_JSON = 1024 * 1024;
const MAX_THUMB = 6 * 1024 * 1024;

// ======================================================================== helpers

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.unityweb': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.symbols': 'application/octet-stream', '.pdf': 'application/pdf',
};
const mimeOf = (f) => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';

const PORTAL_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; script-src 'self'; worker-src 'self' blob:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";

function baseHeaders(req, extra = {}) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...extra,
  };
  if (isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000';
  return h;
}

function sendJson(req, res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, baseHeaders(req, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) }));
  res.end(data);
}

function redirect(req, res, to) {
  res.writeHead(302, baseHeaders(req, { Location: to, 'Cache-Control': 'no-store' }));
  res.end();
}

function notFound(req, res) {
  res.writeHead(404, baseHeaders(req, { 'Content-Type': 'text/plain; charset=utf-8' }));
  res.end('Not found');
}

function isLoopback(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/** A browser on this same computer (not via a tunnel or hosting proxy, which add forwarding headers). */
function isDirectLocal(req) {
  return !TRUST_PROXY && isLoopback(req) && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'] && !req.headers['cf-ray'];
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  if (isLoopback(req) && req.headers['cf-connecting-ip']) return String(req.headers['cf-connecting-ip']);
  return req.socket.remoteAddress || '?';
}

function isHttps(req) {
  if (TRUST_PROXY) return String(req.headers['x-forwarded-proto'] || '').startsWith('https');
  return isLoopback(req) && (req.headers['x-forwarded-proto'] === 'https' || !!req.headers['cf-visitor']?.includes('https'));
}

/** First-admin setup: from this PC, or with the SETUP_CODE configured on the host. */
function setupAllowed(req, code) {
  if (auth.hasAdmin()) return false;
  if (isDirectLocal(req)) return true;
  if (!ENV.SETUP_CODE || ENV.SETUP_CODE.length < 8 || code === undefined) return false;
  const a = Buffer.from(String(code));
  const b = Buffer.from(ENV.SETUP_CODE);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const SESSION_COOKIE = 'gp_sid';

function setSessionCookie(req, res, token, days) {
  const attrs = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.round(days * 86400)}`];
  if (isHttps(req)) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(httpError(413, 'Request too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, MAX_JSON);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw httpError(400, 'Invalid JSON.'); }
}

/**
 * Blocks cross-site requests to the API: every state-changing call must carry our custom header (a page
 * on another site cannot add it without a CORS preflight, which we never allow) and a same-host Origin.
 */
function checkCsrf(req) {
  if (req.headers['x-gp'] !== '1') throw httpError(403, 'Blocked request.');
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { throw httpError(403, 'Blocked request.'); }
    if (host !== req.headers.host) throw httpError(403, 'Blocked request.');
  }
}

function activity(user, action, detail = {}) {
  store.append('activity', { t: new Date().toISOString(), user: user ? user.username : null, action, ...detail });
}

// ======================================================================== content

const items = () => store.get('items', []);
const findItem = (id) => items().find((i) => i.id === id);

function canSee(user, item) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!item.visible || item.status !== 'ready') return false;
  const s = user.scope || {};
  if (s.grades?.length && !s.grades.includes(item.grade)) return false;
  if (s.subjects?.length && !s.subjects.includes(item.subject)) return false;
  return true;
}

function publicItem(item, user) {
  const out = { ...item };
  if (!user || user.role !== 'admin') { delete out.processLog; delete out.error; delete out.createdBy; }
  out.publishedAt = item.publishedAt || (item.version ? item.updatedAt : null);
  out.thumbUrl = item.thumb ? `/t/${item.id}?v=${encodeURIComponent(item.updatedAt)}` : null;
  out.playUrl = item.entry ? `/g/${item.id}/${item.version}/${item.entry.split('/').map(encodeURIComponent).join('/')}` : null;
  return out;
}

function slugify(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'item';
}

function cleanMeta(input, existing = {}) {
  const m = { ...existing };
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  if (input.title !== undefined) m.title = str(input.title, 120);
  if (input.type !== undefined) m.type = TYPES.includes(input.type) ? input.type : LEGACY_TYPES[input.type] || '2D Interactivity';
  if (input.subject !== undefined) m.subject = str(input.subject, 40);
  if (input.strand !== undefined) m.strand = str(input.strand, 20);
  if (input.grade !== undefined) m.grade = Math.max(0, Math.min(12, parseInt(input.grade, 10) || 0));
  if (input.unit !== undefined) m.unit = Math.max(0, parseInt(input.unit, 10) || 0);
  if (input.unitTitle !== undefined) m.unitTitle = str(input.unitTitle, 120);
  if (input.lesson !== undefined) m.lesson = Math.max(0, parseInt(input.lesson, 10) || 0);
  if (input.lessonTitle !== undefined) m.lessonTitle = str(input.lessonTitle, 160);
  if (input.chapter !== undefined) m.chapter = str(input.chapter, 160);
  if (input.description !== undefined) m.description = str(input.description, 1000);
  if (input.tags !== undefined) m.tags = (Array.isArray(input.tags) ? input.tags : String(input.tags).split(',')).map((t) => str(t, 30)).filter(Boolean).slice(0, 12);
  if (input.visible !== undefined) m.visible = !!input.visible;
  if (input.fit !== undefined) m.fit = !!input.fit;
  if (!m.title) throw httpError(400, 'Title is required.');
  if (!m.subject) throw httpError(400, 'Subject is required.');
  m.lessonId = m.unit || m.lesson ? lessonId({ subject: m.subject, strand: m.strand, grade: m.grade, unit: m.unit, lesson: m.lesson }) : '';
  return m;
}

function saveItem(item) {
  store.update('items', [], (list) => {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
  });
  return item;
}

function stagingFor(id, uploadId) {
  if (!/^[a-z0-9-]+$/.test(id) || !/^[a-zA-Z0-9_-]{6,40}$/.test(uploadId)) throw httpError(400, 'Bad upload id.');
  return path.join(STAGING_DIR, `${id}--${uploadId}`);
}

function rmrf(p) {
  // only ever inside our own temporary upload folder
  const resolved = path.resolve(p);
  if (!resolved.startsWith(path.resolve(STAGING_DIR) + path.sep)) throw new Error('Refusing to remove outside the upload folder.');
  fs.rmSync(resolved, { recursive: true, force: true });
}

/** A book upload is one PDF; it is stored as book.pdf. */
function preparePdf(stageDir) {
  const pdfs = walk(stageDir).filter((f) => /\.pdf$/i.test(f));
  if (pdfs.length !== 1) throw httpError(400, 'Upload exactly one PDF file for a book.');
  const src = path.join(stageDir, pdfs[0]);
  const head = Buffer.alloc(5);
  const fd = fs.openSync(src, 'r');
  try { fs.readSync(fd, head, 0, 5, 0); } finally { fs.closeSync(fd); }
  if (head.toString('latin1') !== '%PDF-') throw httpError(400, `"${pdfs[0]}" is not a PDF file.`);
  const final = path.join(stageDir, 'book.pdf');
  if (src !== final) fs.renameSync(src, final);
  for (const f of walk(stageDir)) if (f !== 'book.pdf') fs.rmSync(path.join(stageDir, f), { force: true });
  const size = fs.statSync(final).size;
  return { entry: 'book.pdf', isUnity: false, gz: [], size, files: 1, log: [`PDF stored (${(size / 1048576).toFixed(1)} MB)`] };
}

const gamePrefix = (id, version) => `games/${id}/v${version}`;
const processing = new Set();

/** Process a staged upload, store it, and make it the item's live build. */
async function finalizeBuild(item, stageDir, user) {
  if (processing.has(item.id)) throw httpError(409, 'This item is already being processed.');
  processing.add(item.id);
  item.status = 'processing';
  item.error = null;
  saveItem(item);
  try {
    const result = sourceOf(item.type) === 'pdf' ? preparePdf(stageDir) : await processBuild(stageDir, { fit: item.fit !== false });
    const version = (item.version || 0) + 1;
    await blobs.putDir(stageDir, gamePrefix(item.id, version));
    const oldVersion = item.version;
    Object.assign(item, {
      status: 'ready', version, entry: result.entry, isUnity: result.isUnity, gz: result.gz, size: result.size, files: result.files,
      processLog: result.log, updatedAt: new Date().toISOString(),
      publishedAt: item.publishedAt || new Date().toISOString(), // first time it went live: drives the "new" alerts
    });
    saveItem(item);
    if (oldVersion) blobs.deletePrefix(gamePrefix(item.id, oldVersion)).catch((e) => console.error('cleanup failed:', e.message));
    activity(user, 'upload', { item: item.id, title: item.title, version });
  } catch (e) {
    item.status = item.version ? 'ready' : 'error';
    item.error = e.message;
    saveItem(item);
    if (fs.existsSync(stageDir)) rmrf(stageDir);
    throw e;
  } finally {
    processing.delete(item.id);
  }
}

// ======================================================================== static files

function serveFile(req, res, file, { cache = 'no-cache', headers = {} } = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch { return notFound(req, res); }
  if (!stat.isFile()) return notFound(req, res);
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const h = baseHeaders(req, { 'Content-Type': mimeOf(file), 'Cache-Control': cache, ETag: etag, ...headers });
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); return res.end(); }
  h['Content-Length'] = stat.size;
  res.writeHead(200, h);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/**
 * Streams a stored object (game file or cover image) to the browser. URLs are versioned, so the browser can
 * cache them forever; a gzip copy is sent when one exists and the browser accepts it.
 */
async function serveBlob(req, res, key, { name, gzKey = null, cache, headers = {} }) {
  const h = baseHeaders(req, { 'Content-Type': mimeOf(name), 'Cache-Control': cache, Vary: 'Accept-Encoding', ETag: `"${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}"`, ...headers });
  if (req.headers['if-none-match'] === h.ETag) { res.writeHead(304, h); return res.end(); }
  let obj = null;
  if (gzKey && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    obj = await blobs.open(gzKey);
    if (obj) h['Content-Encoding'] = 'gzip';
  }
  if (!obj) obj = await blobs.open(key);
  if (!obj) return notFound(req, res);
  if (obj.size !== undefined) h['Content-Length'] = obj.size;
  res.writeHead(200, h);
  if (req.method === 'HEAD') { obj.stream.destroy(); return res.end(); }
  await pipeline(obj.stream, res).catch(() => { /* browser went away */ });
}

function servePublic(req, res, rel, cache = 'no-cache') {
  const safe = safeRelative(rel);
  if (!safe) return notFound(req, res);
  const isHtml = /\.html$/.test(safe);
  serveFile(req, res, path.join(PUBLIC_DIR, safe), { cache, headers: isHtml ? { 'Content-Security-Policy': PORTAL_CSP } : {} });
}

// ======================================================================== routing

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = decodeURIComponent(url.pathname);
  const token = cookies(req)[SESSION_COOKIE];
  const user = auth.sessionUser(token);
  const method = req.method;

  if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('ok'); }

  // ---------- public assets & pages
  // no-cache = revalidate with the ETag each time (cheap 304s), so portal updates show up immediately
  if (p.startsWith('/assets/')) return servePublic(req, res, p.slice(1), 'no-cache');
  if (p === '/favicon.ico' || p === '/favicon.svg') return servePublic(req, res, 'assets/favicon.svg', 'public, max-age=86400');

  if (p === '/setup') {
    if (auth.hasAdmin()) return redirect(req, res, '/login');
    // first-run setup: from this PC, or anywhere with the SETUP_CODE configured on the host
    if (!isDirectLocal(req) && !ENV.SETUP_CODE) return notFound(req, res);
    return servePublic(req, res, 'setup.html');
  }
  if (p === '/login') {
    if (!auth.hasAdmin()) return redirect(req, res, '/setup');
    if (user) return redirect(req, res, '/');
    return servePublic(req, res, 'login.html');
  }

  // ---------- API
  if (p.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') checkCsrf(req);
    return api(req, res, p, url, user, token);
  }

  // ---------- everything below needs a login
  if (!auth.hasAdmin()) return redirect(req, res, isDirectLocal(req) || ENV.SETUP_CODE ? '/setup' : '/login');
  if (!user) {
    if (p.startsWith('/g/') || p.startsWith('/t/')) return notFound(req, res);
    return redirect(req, res, '/login?next=' + encodeURIComponent(p + url.search));
  }

  if (p === '/' || p === '/library') return servePublic(req, res, 'app.html');
  if (p === '/admin') return user.role === 'admin' ? servePublic(req, res, 'admin.html') : redirect(req, res, '/');
  if (/^\/play\/[a-z0-9-]+$/.test(p)) return servePublic(req, res, 'play.html');

  // game files: /g/<id>/<version>/<path>
  let m = p.match(/^\/g\/([a-z0-9-]+)\/(\d+)\/(.+)$/);
  if (m) {
    const item = findItem(m[1]);
    if (!item || !canSee(user, item) || String(item.version) !== m[2]) return notFound(req, res);
    const rel = safeRelative(m[3]);
    if (!rel || rel.startsWith(CACHE_DIR) || rel.endsWith('.original')) return notFound(req, res);
    const prefix = gamePrefix(item.id, item.version);
    return serveBlob(req, res, `${prefix}/${rel}`, {
      name: rel,
      gzKey: (item.gz || []).includes(rel) ? `${prefix}/${CACHE_DIR}/${rel}.gz` : null,
      cache: 'private, max-age=31536000, immutable', // versioned URL: a new upload gets a new version
      headers: { 'Content-Security-Policy': "frame-ancestors 'self'" },
    });
  }
  m = p.match(/^\/t\/([a-z0-9-]+)$/);
  if (m) {
    const item = findItem(m[1]);
    if (!item || !item.thumb || !canSee(user, item)) return notFound(req, res);
    return serveBlob(req, res, `thumbs/${item.thumb}`, { name: item.thumb, cache: 'private, max-age=31536000, immutable' });
  }
  return notFound(req, res);
}

async function api(req, res, p, url, user, token) {
  const method = req.method;
  const json = (status, body) => sendJson(req, res, status, body);

  // ---------- first-run setup (only while there is no admin; this PC, or with the host's SETUP_CODE)
  if (p === '/api/setup' && method === 'POST') {
    const b = await readJson(req);
    if (!setupAllowed(req, b.setupCode)) {
      const ip = clientIp(req);
      if (auth.isLocked('setup:' + ip)) throw httpError(429, 'Too many attempts. Try again later.');
      auth.noteFailure('setup:' + ip);
      throw httpError(403, auth.hasAdmin() ? 'Setup is not available.' : 'Wrong setup code.');
    }
    // ADMIN_USERNAME pins who the first admin is (e.g. the owner's email), so nobody else can claim the portal
    const owner = ENV.ADMIN_USERNAME ? normalizeUsername(ENV.ADMIN_USERNAME) : null;
    if (owner && normalizeUsername(b.username) !== owner) throw httpError(400, `The admin account for this portal must be ${owner}.`);
    const admin = auth.createUser({ username: b.username, displayName: b.displayName, password: b.password, role: 'admin' });
    if (b.siteName) store.update('settings', {}, (s) => { s.siteName = String(b.siteName).trim().slice(0, 60) || DEFAULT_SETTINGS.siteName; });
    const t = auth.createSession(admin.id, settings().sessionDays, { ip: clientIp(req), agent: req.headers['user-agent'] });
    setSessionCookie(req, res, t, settings().sessionDays);
    activity(admin, 'setup');
    return json(200, { ok: true });
  }

  if (p === '/api/login' && method === 'POST') {
    const b = await readJson(req);
    const u = auth.login(b.username, b.password, clientIp(req));
    const days = settings().sessionDays;
    const t = auth.createSession(u.id, days, { ip: clientIp(req), agent: req.headers['user-agent'] });
    setSessionCookie(req, res, t, days);
    activity(u, 'login', { ip: clientIp(req) });
    return json(200, { ok: true, user: publicUser(u) });
  }

  if (p === '/api/site' && method === 'GET') {
    const s = settings();
    const setupOpen = !auth.hasAdmin();
    return json(200, {
      siteName: s.siteName, tagline: s.tagline, needsSetup: setupOpen, setupNeedsCode: !isDirectLocal(req),
      adminUsername: setupOpen && ENV.ADMIN_USERNAME ? normalizeUsername(ENV.ADMIN_USERNAME) : undefined,
    });
  }

  // ---------- signed-in users
  if (!user) throw httpError(401, 'Please sign in.');

  if (p === '/api/logout' && method === 'POST') {
    auth.endSession(token);
    clearSessionCookie(req, res);
    activity(user, 'logout');
    return json(200, { ok: true });
  }
  if (p === '/api/me' && method === 'GET') {
    return json(200, { user: publicUser(user), lastSeenNew: store.get('seen', {})[user.id] || null,
      site: { ...settings(), canImportFolder: ALLOW_FOLDER_IMPORT, storage: blobs.kind } });
  }
  // "what's new" was looked at: resources published before now are no longer new for this person
  if (p === '/api/me/seen' && method === 'POST') {
    const at = new Date().toISOString();
    store.update('seen', {}, (m) => { m[user.id] = at; });
    return json(200, { lastSeenNew: at });
  }
  if (p === '/api/me/password' && method === 'POST') {
    const b = await readJson(req);
    try { auth.login(user.username, b.current, clientIp(req)); } catch (e) { throw httpError(e.status === 429 ? 429 : 400, e.status === 429 ? e.message : 'Current password is wrong.'); }
    auth.updateUser(user.id, { password: b.next });
    const t = auth.createSession(user.id, settings().sessionDays, { ip: clientIp(req), agent: req.headers['user-agent'] });
    setSessionCookie(req, res, t, settings().sessionDays);
    activity(user, 'password-changed');
    return json(200, { ok: true });
  }
  if (p === '/api/curriculum' && method === 'GET') {
    const c = curriculum();
    const s = user.role === 'admin' ? {} : user.scope || {};
    const lessons = c.lessons.filter((l) => (!s.grades?.length || s.grades.includes(l.grade)) && (!s.subjects?.length || s.subjects.includes(l.subject)));
    return json(200, { ...c, lessons, suggestions: user.role === 'admin' ? c.suggestions : [] });
  }
  if (p === '/api/catalog' && method === 'GET') {
    return json(200, { items: items().filter((i) => canSee(user, i)).map((i) => publicItem(i, user)), types: TYPES });
  }
  let m = p.match(/^\/api\/items\/([a-z0-9-]+)$/);
  if (m && method === 'GET') {
    const item = findItem(m[1]);
    if (!item || !canSee(user, item)) throw httpError(404, 'Not found.');
    return json(200, { item: publicItem(item, user) });
  }
  m = p.match(/^\/api\/items\/([a-z0-9-]+)\/play$/);
  if (m && method === 'POST') {
    const item = findItem(m[1]);
    if (!item || !canSee(user, item)) throw httpError(404, 'Not found.');
    store.update('items', [], (list) => {
      const it = list.find((x) => x.id === item.id);
      it.plays = (it.plays || 0) + 1;
      it.lastPlayedAt = new Date().toISOString();
    });
    activity(user, 'play', { item: item.id, title: item.title });
    return json(200, { ok: true });
  }

  // ---------- admin only
  if (!p.startsWith('/api/admin/')) throw httpError(404, 'Not found.');
  if (user.role !== 'admin') throw httpError(403, 'Admins only.');
  return adminApi(req, res, p, url, user, token);
}

async function adminApi(req, res, p, url, user, token) {
  const method = req.method;
  const json = (status, body) => sendJson(req, res, status, body);
  let m;

  // ---------- people
  if (p === '/api/admin/users' && method === 'GET') {
    const sessions = store.get('sessions', []);
    const now = Date.now();
    return json(200, {
      users: auth.users().map((u) => ({ ...publicUser(u), activeSessions: sessions.filter((s) => s.userId === u.id && s.expires > now).length })),
    });
  }
  if (p === '/api/admin/users' && method === 'POST') {
    const b = await readJson(req);
    const u = auth.createUser(b);
    activity(user, 'user-created', { target: u.username, role: u.role });
    return json(200, { user: publicUser(u) });
  }
  m = p.match(/^\/api\/admin\/users\/([0-9a-f-]{36})$/);
  if (m && method === 'PATCH') {
    const b = await readJson(req);
    if (m[1] === user.id && (b.disabled || b.role === 'viewer')) throw httpError(400, 'You cannot disable or demote your own account.');
    const u = auth.updateUser(m[1], b);
    if (m[1] === user.id && b.password !== undefined) {
      const t = auth.createSession(user.id, settings().sessionDays, { ip: clientIp(req), agent: req.headers['user-agent'] });
      setSessionCookie(req, res, t, settings().sessionDays);
    }
    activity(user, 'user-updated', { target: u.username, fields: Object.keys(b).filter((k) => k !== 'password').concat(b.password ? ['password'] : []) });
    return json(200, { user: publicUser(u) });
  }
  if (m && method === 'DELETE') {
    if (m[1] === user.id) throw httpError(400, 'You cannot delete your own account.');
    const target = auth.findUserById(m[1]);
    auth.deleteUser(m[1]);
    activity(user, 'user-deleted', { target: target?.username });
    return json(200, { ok: true });
  }
  m = p.match(/^\/api\/admin\/users\/([0-9a-f-]{36})\/signout$/);
  if (m && method === 'POST') {
    auth.endSessionsFor(m[1], m[1] === user.id ? token : null);
    activity(user, 'user-signed-out', { target: auth.findUserById(m[1])?.username });
    return json(200, { ok: true });
  }

  // ---------- content
  if (p === '/api/admin/items' && method === 'POST') {
    const b = await readJson(req);
    const meta = cleanMeta(b, { type: 'Game', visible: true, fit: true, tags: [] });
    const id = `${slugify(meta.title)}-${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();
    const item = saveItem({ id, ...meta, status: 'draft', version: 0, entry: null, size: 0, files: 0, thumb: null, plays: 0, createdAt: now, updatedAt: now, createdBy: user.username });
    activity(user, 'item-created', { item: id, title: item.title });
    return json(200, { item: publicItem(item, user) });
  }
  m = p.match(/^\/api\/admin\/items\/([a-z0-9-]+)$/);
  if (m) {
    const item = findItem(m[1]);
    if (!item) throw httpError(404, 'Not found.');
    if (method === 'PATCH') {
      const b = await readJson(req);
      const next = { ...item, ...cleanMeta(b, item), updatedAt: new Date().toISOString() };
      saveItem(next);
      return json(200, { item: publicItem(next, user) });
    }
    if (method === 'DELETE') {
      if (processing.has(item.id)) throw httpError(409, 'Wait until processing finishes.');
      store.update('items', [], (list) => list.filter((x) => x.id !== item.id));
      await blobs.deletePrefix(`games/${item.id}`);
      if (item.thumb) await blobs.remove(`thumbs/${item.thumb}`);
      activity(user, 'item-deleted', { item: item.id, title: item.title });
      return json(200, { ok: true });
    }
  }

  // upload one file of a build folder: PUT /api/admin/items/<id>/files?upload=<uploadId>&path=<relative path>
  m = p.match(/^\/api\/admin\/items\/([a-z0-9-]+)\/files$/);
  if (m && method === 'PUT') {
    const item = findItem(m[1]);
    if (!item) throw httpError(404, 'Not found.');
    const rel = safeRelative(String(url.searchParams.get('path') || '').replace(/\\/g, '/'));
    if (!rel) throw httpError(400, 'Bad file path.');
    const target = path.join(stagingFor(item.id, String(url.searchParams.get('upload') || '')), rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const declared = parseInt(req.headers['content-length'] || '0', 10);
    if (declared > MAX_FILE) throw httpError(413, 'File too large.');
    await pipeline(req, fs.createWriteStream(target));
    return json(200, { ok: true });
  }

  // upload a .zip of the build: PUT /api/admin/items/<id>/zip?upload=<uploadId>
  m = p.match(/^\/api\/admin\/items\/([a-z0-9-]+)\/zip$/);
  if (m && method === 'PUT') {
    const item = findItem(m[1]);
    if (!item) throw httpError(404, 'Not found.');
    const stage = stagingFor(item.id, String(url.searchParams.get('upload') || ''));
    fs.mkdirSync(stage, { recursive: true });
    const zipFile = path.join(STAGING_DIR, path.basename(stage) + '.zip');
    await pipeline(req, fs.createWriteStream(zipFile));
    try { extractZip(zipFile, stage); } finally { fs.rmSync(zipFile, { force: true }); }
    return json(200, { ok: true });
  }

  // copy a build folder that is already on this PC (bulk import of existing builds)
  m = p.match(/^\/api\/admin\/items\/([a-z0-9-]+)\/import-folder$/);
  if (m && method === 'POST') {
    if (!ALLOW_FOLDER_IMPORT) throw httpError(400, 'Copying from a folder only works when the portal runs on your own PC. Use "Choose folder" or "Choose .zip".');
    const item = findItem(m[1]);
    if (!item) throw httpError(404, 'Not found.');
    const b = await readJson(req);
    const src = path.resolve(String(b.path || '').replace(/^"|"$/g, ''));
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw httpError(400, 'That folder does not exist on this PC.');
    const uploadId = crypto.randomBytes(8).toString('hex');
    const stage = stagingFor(item.id, uploadId);
    fs.cpSync(src, stage, { recursive: true });
    await finalizeBuild(item, stage, user);
    return json(200, { item: publicItem(findItem(item.id), user) });
  }

  // process staged files into the live build
  m = p.match(/^\/api\/admin\/items\/([a-z0-9-]+)\/finalize$/);
  if (m && method === 'POST') {
    const item = findItem(m[1]);
    if (!item) throw httpError(404, 'Not found.');
    const b = await readJson(req);
    const stage = stagingFor(item.id, String(b.upload || ''));
    if (!fs.existsSync(stage)) throw httpError(400, 'Nothing was uploaded.');
    await finalizeBuild(item, stage, user);
    return json(200, { item: publicItem(findItem(item.id), user) });
  }

  // thumbnail image: PUT /api/admin/items/<id>/thumbnail (raw image body)
  m = p.match(/^\/api\/admin\/items\/([a-z0-9-]+)\/thumbnail$/);
  if (m && (method === 'PUT' || method === 'DELETE')) {
    const found = findItem(m[1]);
    if (!found) throw httpError(404, 'Not found.');
    const item = { ...found };
    let newThumb = null;
    if (method === 'PUT') {
      const buf = await readBody(req, MAX_THUMB);
      const ext = buf[0] === 0x89 && buf[1] === 0x50 ? 'png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg'
        : buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP' ? 'webp' : null;
      if (!ext) throw httpError(400, 'Thumbnail must be a PNG, JPG or WebP image.');
      newThumb = `${item.id}-${Date.now()}.${ext}`;
      await blobs.putBuffer(`thumbs/${newThumb}`, buf, mimeOf(newThumb));
    }
    if (item.thumb) await blobs.remove(`thumbs/${item.thumb}`);
    item.thumb = newThumb;
    item.updatedAt = new Date().toISOString();
    saveItem(item);
    return json(200, { item: publicItem(item, user) });
  }

  // ---------- activity, settings, books
  if (p === '/api/admin/activity' && method === 'GET') {
    const limit = Math.min(2000, parseInt(url.searchParams.get('limit') || '300', 10) || 300);
    return json(200, { entries: store.tail('activity', limit) });
  }
  if (p === '/api/admin/settings' && method === 'GET') return json(200, { settings: settings() });
  if (p === '/api/admin/settings' && method === 'PATCH') {
    const b = await readJson(req);
    store.update('settings', {}, (s) => {
      if (b.siteName !== undefined) s.siteName = String(b.siteName).trim().slice(0, 60) || DEFAULT_SETTINGS.siteName;
      if (b.tagline !== undefined) s.tagline = String(b.tagline).trim().slice(0, 120);
      if (b.sessionDays !== undefined) s.sessionDays = Math.max(1, Math.min(90, parseInt(b.sessionDays, 10) || 14));
    });
    activity(user, 'settings-changed');
    return json(200, { settings: settings() });
  }
  if (p === '/api/admin/lessons' && method === 'POST') {
    // add a lesson (or a whole new subject/book) that is not in the seeded sheets
    const b = await readJson(req);
    const l = {
      subject: String(b.subject || '').trim().slice(0, 40), strand: String(b.strand || '').trim().slice(0, 20),
      grade: parseInt(b.grade, 10) || 0, unit: parseInt(b.unit, 10) || 0, unitTitle: String(b.unitTitle || '').trim().slice(0, 120),
      lesson: parseInt(b.lesson, 10) || 0, lessonTitle: String(b.lessonTitle || '').trim().slice(0, 160), chapter: String(b.chapter || '').trim().slice(0, 160),
      custom: true,
    };
    if (!l.subject || !l.grade || !l.unit || !l.lesson || !l.lessonTitle) throw httpError(400, 'Subject, grade, unit, lesson number and lesson title are required.');
    l.id = lessonId(l);
    store.update('curriculum', null, (c) => {
      if (c.lessons.some((x) => x.id === l.id)) throw httpError(409, 'That lesson already exists.');
      c.lessons.push(l);
      if (!c.subjects.some((s) => s.name === l.subject)) c.subjects.push({ name: l.subject, short: l.subject, color: '#5f6c7b' });
    });
    activity(user, 'lesson-added', { lesson: l.id });
    return json(200, { lesson: l });
  }
  m = p.match(/^\/api\/admin\/lessons\/([a-z0-9-]+)$/);
  if (m && method === 'DELETE') {
    store.update('curriculum', null, (c) => {
      const l = c.lessons.find((x) => x.id === m[1]);
      if (!l) throw httpError(404, 'Lesson not found.');
      if (!l.custom) throw httpError(400, 'Lessons from the book sheets cannot be removed here.');
      c.lessons = c.lessons.filter((x) => x.id !== m[1]);
    });
    return json(200, { ok: true });
  }

  throw httpError(404, 'Not found.');
}

// ======================================================================== start

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(new Date().toISOString(), req.method, req.url, e);
    if (!res.headersSent) sendJson(req, res, status, { error: status >= 500 ? 'Something went wrong on the server.' : e.message });
    else res.destroy();
  }
});
server.requestTimeout = 0;          // big uploads over slow links
server.headersTimeout = 60000;

async function main() {
  // Clean upload folders left by interrupted uploads (older than a day).
  for (const d of fs.readdirSync(STAGING_DIR)) {
    const full = path.join(STAGING_DIR, d);
    if (Date.now() - fs.statSync(full).mtimeMs > 86400000) rmrf(full);
  }

  if (blobs.check) {
    try { await blobs.check(); } catch (e) {
      console.error(`Cannot reach the ${blobs.label}: ${e.message}. Check the ${ENV.STORAGE.toUpperCase()}_* settings.`);
      process.exit(1);
    }
  }
  await store.init(['users', 'sessions', 'items', 'curriculum', 'settings', 'activity', 'seen']);
  curriculum(); // seeds the books on first run

  // Forgotten admin password on a host without a terminal (Render free): set ADMIN_RESET_USER and
  // ADMIN_RESET_PASSWORD in the host's settings, restart once, sign in, then delete both variables.
  if (ENV.ADMIN_RESET_USER && ENV.ADMIN_RESET_PASSWORD) {
    const u = auth.findUser(ENV.ADMIN_RESET_USER);
    // apply each reset value only once, so a forgotten variable cannot undo later password changes
    const marker = crypto.createHash('sha256').update(`${ENV.ADMIN_RESET_USER}\n${ENV.ADMIN_RESET_PASSWORD}`).digest('hex');
    if (store.get('settings', {}).lastAdminReset === marker) console.warn('ADMIN_RESET_* was already applied; remove those variables from the settings.');
    else if (!u || u.role !== 'admin') console.error(`ADMIN_RESET_USER "${ENV.ADMIN_RESET_USER}" is not an admin; nothing changed.`);
    else {
      store.update('settings', {}, (s) => { s.lastAdminReset = marker; });
      try {
        auth.updateUser(u.id, { password: ENV.ADMIN_RESET_PASSWORD, disabled: false });
        await store.flush();
        console.warn(`Password for admin "${u.username}" was reset from ADMIN_RESET_PASSWORD. Remove ADMIN_RESET_USER and ADMIN_RESET_PASSWORD from the settings now.`);
      } catch (e) { console.error('Admin reset failed: ' + e.message); }
    }
  }
  // an upload that was processing when the server stopped will never finish: mark it so it can be retried
  store.update('items', [], (list) => {
    for (const i of list) if (i.status === 'processing') { i.status = i.version ? 'ready' : 'error'; i.error = 'Interrupted - please upload again.'; }
  });

  const port = parseInt(ENV.PORT || settings().port, 10);
  const host = ENV.HOST || (ON_RENDER ? '0.0.0.0' : settings().host);
  server.listen(port, host, () => {
    console.log(`${settings().siteName} running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (storage: ${blobs.kind})`);
    if (!auth.hasAdmin()) {
      console.log(ENV.SETUP_CODE
        ? 'First run: open /setup in a browser and enter the SETUP_CODE to create the admin account.'
        : `First run: open http://localhost:${port}/setup on this PC to create the admin account.`);
    }
  });
}

// Render (and Ctrl+C) stop the server with a signal: finish saving first.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    server.close();
    try { await store.flush(); } catch (e) { console.error('Save on shutdown failed:', e.message); }
    process.exit(0);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
