'use strict';
// Turns an uploaded WebGL / HTML5 build into a ready-to-play folder (the same fixes as the team's
// "Unity WebGL auto fix" tool, done automatically):
//   1. find the entry index.html (build may be zipped inside an extra folder)
//   2. decompress .gz / .br / .unityweb files and point index.html at the plain files
//   3. make Unity's default page fill the player window and hide its warning banner/footer
//   4. pre-compress large files (gzip) into a hidden cache so they download fast over the internet

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CACHE_DIR = '.gpcache';
const COMPRESSIBLE = /\.(wasm|data|js|json|html|css|symbols|unityweb|txt|xml|svg|bundle|mem)$/i;
const PRECOMPRESS_MIN = 64 * 1024;

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === CACHE_DIR) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** The shallowest index.html, preferring one next to a Unity "Build" folder. */
function findEntry(dir) {
  const files = walk(dir);
  const candidates = files.filter((f) => /(^|\/)index\.html?$/i.test(f) && !f.includes('TemplateData/'));
  if (!candidates.length) {
    const anyHtml = files.filter((f) => /\.html?$/i.test(f)).sort((a, b) => a.split('/').length - b.split('/').length);
    return anyHtml[0] || null;
  }
  candidates.sort((a, b) => {
    const unityA = fs.existsSync(path.join(dir, path.dirname(a), 'Build')) ? 0 : 1;
    const unityB = fs.existsSync(path.join(dir, path.dirname(b), 'Build')) ? 0 : 1;
    return unityA - unityB || a.split('/').length - b.split('/').length;
  });
  return candidates[0];
}

function tryDecompress(buf, kind) {
  if (kind === 'gz' || (buf[0] === 0x1f && buf[1] === 0x8b)) {
    try { return zlib.gunzipSync(buf); } catch { /* not gzip */ }
  }
  if (kind === 'br' || kind === 'unityweb') {
    try { return zlib.brotliDecompressSync(buf); } catch { /* not brotli */ }
  }
  return null;
}

/** Decompresses build files in place. Returns a map of renamed files (old relative name -> new). */
function decompressBuild(dir, log) {
  const renamed = {};
  for (const rel of walk(dir)) {
    const m = rel.match(/\.(gz|br|unityweb)$/i);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    const full = path.join(dir, rel);
    const plain = tryDecompress(fs.readFileSync(full), kind);
    if (!plain) continue; // .unityweb that is already uncompressed
    if (kind === 'unityweb') {
      fs.writeFileSync(full, plain); // keep the name: index.html / loader still refer to it
      log(`decompressed ${rel}`);
    } else {
      const target = rel.slice(0, -(kind.length + 1));
      fs.writeFileSync(path.join(dir, target), plain);
      fs.unlinkSync(full);
      renamed[rel] = target;
      log(`decompressed ${rel} -> ${target}`);
    }
  }
  return renamed;
}

const FIT_STYLE = `<style id="gp-fit">
/* Added by the Game Portal: fill the player window, hide Unity's banner/footer */
html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#000}
#unity-container{position:fixed!important;left:0!important;top:0!important;width:100%!important;height:100%!important;transform:none!important}
#unity-canvas{width:100%!important;height:100%!important;display:block}
#unity-footer,#unity-warning,#unity-fullscreen-button{display:none!important}
</style>`;

/** Points index.html at decompressed files and (for Unity pages) makes the game fill the window. */
function patchEntry(dir, entryRel, renamed, fit, log) {
  const full = path.join(dir, entryRel);
  let html = fs.readFileSync(full, 'utf8');
  const original = html;
  const entryDir = path.posix.dirname(entryRel);
  for (const [from, to] of Object.entries(renamed)) {
    // references are relative to index.html, e.g. "Build/Game.data.gz"
    const relFrom = entryDir === '.' ? from : path.posix.relative(entryDir, from);
    const relTo = entryDir === '.' ? to : path.posix.relative(entryDir, to);
    const baseFrom = path.posix.basename(relFrom);
    const baseTo = path.posix.basename(relTo);
    html = html.split(relFrom).join(relTo);
    html = html.split(baseFrom).join(baseTo); // e.g. buildUrl + "/Game.data.gz"
  }
  const isUnity = /unity-canvas|createUnityInstance|UnityLoader/i.test(html);
  if (fit && isUnity && !html.includes('id="gp-fit"')) {
    html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, FIT_STYLE + '\n</head>') : FIT_STYLE + html;
    // the default template sizes the canvas inline for desktop; let the stylesheet decide instead
    html = html.replace(/canvas\.style\.width\s*=\s*"[^"]*";?/g, '').replace(/canvas\.style\.height\s*=\s*"[^"]*";?/g, '');
  }
  if (html !== original) {
    const backup = path.join(dir, entryRel + '.original');
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, original);
    fs.writeFileSync(full, html);
    log(`patched ${entryRel}${isUnity ? ' (Unity page: fit to window)' : ''}`);
  }
  return { isUnity };
}

/** Writes gzip copies of large compressible files to .gpcache (served when the browser accepts gzip). */
async function precompress(dir, log) {
  const files = walk(dir).filter((f) => COMPRESSIBLE.test(f));
  let saved = 0;
  const gz = [];
  for (const rel of files) {
    const full = path.join(dir, rel);
    const size = fs.statSync(full).size;
    if (size < PRECOMPRESS_MIN) continue;
    const target = path.join(dir, CACHE_DIR, rel + '.gz');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const data = fs.readFileSync(full);
    const packed = await new Promise((res, rej) => zlib.gzip(data, { level: 7 }, (e, b) => (e ? rej(e) : res(b))));
    if (packed.length < size * 0.92) {
      fs.writeFileSync(target, packed);
      saved += size - packed.length;
      gz.push(rel);
    }
  }
  log(`pre-compressed large files (saves ${(saved / 1048576).toFixed(1)} MB per download)`);
  return gz;
}

function folderSize(dir) {
  let total = 0;
  for (const rel of walk(dir)) total += fs.statSync(path.join(dir, rel)).size;
  return total;
}

/** Full pipeline. Returns { entry, isUnity, size, files, log }. */
async function processBuild(dir, { fit = true } = {}) {
  const lines = [];
  const log = (m) => lines.push(m);
  const entry = findEntry(dir);
  if (!entry) throw Object.assign(new Error('No index.html found in the upload. Upload the whole WebGL build folder (the one containing index.html and Build).'), { status: 400 });
  log(`entry: ${entry}`);
  const renamed = decompressBuild(dir, log);
  const { isUnity } = patchEntry(dir, entry, renamed, fit, log);
  const gz = await precompress(dir, log);
  return { entry, isUnity, gz, size: folderSize(dir), files: walk(dir).length, log: lines };
}

module.exports = { processBuild, findEntry, walk, CACHE_DIR };
