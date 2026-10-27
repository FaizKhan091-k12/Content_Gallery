'use strict';
// Accounts, password hashing (scrypt), sessions and login throttling.

const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const MIN_PASSWORD = 8;
const MAX_FAILURES = 8;
const LOCK_MINUTES = 15;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, N, r, p, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(actual, expected);
}

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (password.length > 200) return 'Password is too long.';
  if (/^\s|\s$/.test(password)) return 'Password cannot start or end with a space.';
  return null;
}

function normalizeUsername(name) {
  return String(name || '').trim().toLowerCase();
}

/** A username is either a short name (e.g. "neha") or an email address (e.g. "neha@school.com"). */
function usernameProblem(name) {
  const short = /^[a-z0-9._-]{3,32}$/.test(name);
  const email = name.length <= 100 && /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name);
  if (!short && !email) return 'Username must be an email address, or 3-32 letters, numbers, dots, dashes or underscores.';
  return null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

class Auth {
  constructor(store) {
    this.store = store;
    this.failures = new Map(); // key -> { count, until }
  }

  users() { return this.store.get('users', []); }
  findUser(username) { return this.users().find((u) => u.username === normalizeUsername(username)); }
  findUserById(id) { return this.users().find((u) => u.id === id); }
  hasAdmin() { return this.users().some((u) => u.role === 'admin'); }

  createUser({ username, displayName, password, role, scope }) {
    username = normalizeUsername(username);
    const problem = usernameProblem(username) || passwordProblem(password);
    if (problem) throw httpError(400, problem);
    if (this.findUser(username)) throw httpError(409, 'That username is already taken.');
    const user = {
      id: crypto.randomUUID(),
      username,
      displayName: String(displayName || username).trim().slice(0, 60),
      role: role === 'admin' ? 'admin' : 'viewer',
      scope: sanitizeScope(scope),
      disabled: false,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    this.store.update('users', [], (list) => { list.push(user); });
    return user;
  }

  updateUser(id, changes) {
    let updated = null;
    this.store.update('users', [], (current) => {
      const list = JSON.parse(JSON.stringify(current)); // validate on a copy; nothing changes if we throw
      const u = list.find((x) => x.id === id);
      if (!u) throw httpError(404, 'User not found.');
      if (changes.displayName !== undefined) u.displayName = String(changes.displayName).trim().slice(0, 60) || u.username;
      if (changes.role !== undefined) u.role = changes.role === 'admin' ? 'admin' : 'viewer';
      if (changes.scope !== undefined) u.scope = sanitizeScope(changes.scope);
      if (changes.disabled !== undefined) u.disabled = !!changes.disabled;
      if (changes.password !== undefined) {
        const problem = passwordProblem(changes.password);
        if (problem) throw httpError(400, problem);
        u.passwordHash = hashPassword(changes.password);
        u.passwordChangedAt = new Date().toISOString();
      }
      if (!list.some((x) => x.role === 'admin' && !x.disabled)) throw httpError(400, 'There must always be at least one active admin.');
      updated = u;
      return list;
    });
    if (changes.password !== undefined || changes.disabled || changes.role !== undefined) this.endSessionsFor(id);
    return updated;
  }

  deleteUser(id) {
    this.store.update('users', [], (list) => {
      const next = list.filter((x) => x.id !== id);
      if (next.length === list.length) throw httpError(404, 'User not found.');
      if (!next.some((x) => x.role === 'admin' && !x.disabled)) throw httpError(400, 'You cannot delete the last admin.');
      return next;
    });
    this.endSessionsFor(id);
  }

  // ---------------------------------------------------------------- login throttling

  isLocked(key) {
    const f = this.failures.get(key);
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
  }

  noteFailure(key) {
    const f = this.failures.get(key) || { count: 0, until: 0 };
    f.count++;
    if (f.count >= MAX_FAILURES) { f.until = Date.now() + LOCK_MINUTES * 60000; f.count = 0; }
    this.failures.set(key, f);
  }

  login(username, password, ip) {
    const keys = ['ip:' + ip, 'user:' + normalizeUsername(username)];
    for (const k of keys) {
      const minutes = this.isLocked(k);
      if (minutes) throw httpError(429, `Too many attempts. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`);
    }
    const user = this.findUser(username);
    // Always run scrypt so a wrong username takes as long as a wrong password.
    const ok = verifyPassword(String(password || ''), user ? user.passwordHash : 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
    if (!user || !ok || user.disabled) {
      keys.forEach((k) => this.noteFailure(k));
      throw httpError(401, user && ok && user.disabled ? 'This account is disabled. Ask the admin.' : 'Wrong username or password.');
    }
    keys.forEach((k) => this.failures.delete(k));
    this.store.update('users', [], (list) => {
      const u = list.find((x) => x.id === user.id);
      if (u) u.lastLoginAt = new Date().toISOString();
    });
    return user;
  }

  // ---------------------------------------------------------------- sessions (only token hashes are stored)

  createSession(userId, days, meta) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.store.update('sessions', [], (list) => {
      const fresh = list.filter((s) => s.expires > now);
      fresh.push({ id: sha256(token), userId, created: now, expires: now + days * 86400000, ip: meta.ip, agent: String(meta.agent || '').slice(0, 160) });
      return fresh;
    });
    return token;
  }

  sessionUser(token) {
    if (!token) return null;
    const id = sha256(token);
    const s = this.store.get('sessions', []).find((x) => x.id === id);
    if (!s || s.expires < Date.now()) return null;
    const user = this.findUserById(s.userId);
    if (!user || user.disabled) return null;
    return user;
  }

  endSession(token) {
    if (!token) return;
    const id = sha256(token);
    this.store.update('sessions', [], (list) => list.filter((s) => s.id !== id));
  }

  endSessionsFor(userId, exceptToken) {
    const keep = exceptToken ? sha256(exceptToken) : null;
    this.store.update('sessions', [], (list) => list.filter((s) => s.userId !== userId || s.id === keep));
  }
}

/** Which grades/subjects a viewer may see. Empty lists mean "everything". */
function sanitizeScope(scope) {
  const s = scope || {};
  const grades = Array.isArray(s.grades) ? s.grades.map(Number).filter((g) => g >= 0 && g <= 12) : [];
  const subjects = Array.isArray(s.subjects) ? s.subjects.map((x) => String(x).slice(0, 40)).filter(Boolean) : [];
  return { grades: [...new Set(grades)].sort((a, b) => a - b), subjects: [...new Set(subjects)] };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

module.exports = { Auth, hashPassword, verifyPassword, passwordProblem, httpError, publicUser, normalizeUsername };
