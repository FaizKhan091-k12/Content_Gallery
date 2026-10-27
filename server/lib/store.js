'use strict';
// The portal's small database: a handful of JSON documents (users, sessions, items, curriculum, settings,
// activity) kept in memory and saved to the storage backend (a local folder or Cloudflare R2) after each change.
// Saves for one document are queued in order, so the stored copy always matches the latest change.

const ACTIVITY_LIMIT = 5000;

class JsonStore {
  constructor(blobs) {
    this.blobs = blobs;
    this.cache = new Map();
    this.queues = new Map();
    this.dirty = new Set();
    this.activityTimer = null;
  }

  key(name) { return `data/${name}.json`; }

  /** Loads the given documents from storage. Call once at startup. */
  async init(names) {
    await Promise.all(names.map(async (n) => {
      const v = await this.blobs.readJson(this.key(n));
      if (v !== null) this.cache.set(n, v);
    }));
  }

  get(name, fallback) {
    if (!this.cache.has(name)) this.cache.set(name, fallback);
    return this.cache.get(name);
  }

  set(name, value) {
    this.cache.set(name, value);
    this.persist(name);
  }

  /** Read-modify-write: fn gets the current value and returns (or mutates) it. Throwing leaves it unchanged. */
  update(name, fallback, fn) {
    const current = this.get(name, fallback);
    const next = fn(current);
    this.set(name, next === undefined ? current : next);
    return this.get(name, fallback);
  }

  persist(name) {
    if (this.dirty.has(name)) return; // a save is already waiting and will pick up this change
    this.dirty.add(name);
    const prev = this.queues.get(name) || Promise.resolve();
    const job = prev.then(async () => {
      this.dirty.delete(name);
      try {
        await this.blobs.writeJson(this.key(name), this.cache.get(name));
      } catch (e) {
        console.error(new Date().toISOString(), `Could not save ${name}:`, e.message);
        setTimeout(() => this.persist(name), 5000); // try again
      }
    });
    this.queues.set(name, job);
    return job;
  }

  /** Waits until every pending save has finished (used on shutdown and by tests). */
  async flush() {
    if (this.activityTimer) { clearTimeout(this.activityTimer); this.activityTimer = null; this.persist('activity'); }
    await Promise.all([...this.queues.values()]);
  }

  // ---- activity log: newest first, capped, saved at most every few seconds
  append(name, entry) {
    const list = this.get(name, []);
    list.unshift(entry);
    if (list.length > ACTIVITY_LIMIT) list.length = ACTIVITY_LIMIT;
    if (!this.activityTimer) {
      this.activityTimer = setTimeout(() => { this.activityTimer = null; this.persist(name); }, 4000);
    }
  }

  tail(name, limit) {
    return this.get(name, []).slice(0, limit);
  }
}

module.exports = { JsonStore };
