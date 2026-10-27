'use strict';
// Shared helpers for every page: API calls, icons, escaping, toasts, cover art, user menu.

const GP = (() => {
  async function api(path, { method = 'GET', body, raw, onProgress } = {}) {
    if (raw !== undefined) return upload(path, method, raw, onProgress);
    const res = await fetch(path, {
      method,
      headers: { 'X-GP': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/me/password')) {
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('Signed out');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  /** Raw-body upload with progress (XMLHttpRequest reports upload progress, fetch does not). */
  function upload(path, method, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, path);
      xhr.setRequestHeader('X-GP', '1');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* empty */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Network error during upload.'));
      xhr.send(blob);
    });
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONS = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    reload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5.5C7 4.5 10 4.5 12 6.5v13c-2-2-5-2-8-1z"/><path d="M20 5.5c-3-1-6-1-8 1v13c2-2 5-2 8-1z"/></svg>',
    game: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r="1" fill="currentColor"/><circle cx="18" cy="13.5" r="1" fill="currentColor"/></svg>',
    cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>',
    hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5a1.5 1.5 0 0 1 3 0v5"/><path d="M12 10V4a1.5 1.5 0 0 1 3 0v6"/><path d="M15 10V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 13.6A1.5 1.5 0 0 1 6 12l3 3"/></svg>',
    flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="7" y="3.5" width="13" height="16" rx="2" transform="rotate(8 13.5 11.5)"/><rect x="3.5" y="5" width="13" height="16" rx="2"/><path d="M7 11h6M7 14.5h4" stroke-linecap="round"/></svg>',
    bookOpen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M2.5 5.5C6 4.3 9.5 4.6 12 6.8c2.5-2.2 6-2.5 9.5-1.3v13c-3.5-1.2-7-.9-9.5 1.3-2.5-2.2-6-2.5-9.5-1.3z"/><path d="M12 6.8v12.9"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3.5c4.5 0 6.5 10 11 10H21M3 17h3.5c1.8 0 3-1.5 4.2-3.3M13.3 10.3C14.5 8.5 15.7 7 17.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 20a6.5 6.5 0 0 0-3-5.5"/></svg>',
  };

  // The kinds of resources, in the order the library shows them.
  const TYPE_INFO = {
    Book: { plural: 'Books', verb: 'Read', icon: 'bookOpen', color: '#8a5a2e', blurb: 'The textbook itself, page by page, with real page turns.' },
    Flashcards: { plural: 'Flashcards', verb: 'Study', icon: 'cards', color: '#b4532a', blurb: 'Quick recall of key words, facts and formulas.' },
    '2D Interactivity': { plural: '2D Interactivities', verb: 'Try it', icon: 'hand', color: '#5b3fa6', blurb: 'Hands-on activities that explain one idea at a time.' },
    '3D Interactivity': { plural: '3D Interactivities', verb: 'Explore', icon: 'cube', color: '#3d4fb0', blurb: 'Models you can turn, take apart and look inside.' },
    Simulation: { plural: 'Simulations', verb: 'Explore', icon: 'flask', color: '#17766c', blurb: 'Change the variables and watch the idea play out.' },
    Game: { plural: 'Games', verb: 'Play', icon: 'game', color: '#2453a6', blurb: 'Practice through play, with instant feedback.' },
    Animation: { plural: 'Animations', verb: 'Watch', icon: 'film', color: '#a3365f', blurb: 'Short animated explanations of a concept.' },
  };
  const TYPES = Object.keys(TYPE_INFO);
  const LEGACY_TYPE = { Interactive: '2D Interactivity', Other: '2D Interactivity' };
  const typeOf = (t) => (TYPE_INFO[t] ? t : LEGACY_TYPE[t] || '2D Interactivity');
  // always in the menu; the rest only once something of that kind exists
  const MAIN_TYPES = ['Book', 'Flashcards', '2D Interactivity', 'Simulation', 'Game'];
  const typeInfo = (t) => TYPE_INFO[typeOf(t)];
  const TYPE_ICON = Object.fromEntries(Object.entries(TYPE_INFO).map(([k, v]) => [k, v.icon]));
  const typeIcon = (t, size) => ICONS[typeInfo(t).icon].replace('<svg', size ? `<svg width="${size}" height="${size}"` : '<svg');

  // Library colours and blurbs per subject (the book data only stores names).
  const SUBJECT_STYLE = {
    Mathematics: { color: '#2b4c9b', glyph: '∑', blurb: 'Numbers, patterns, shapes and data, built up lesson by lesson from counting to algebra.' },
    Science: { color: '#2f7a4f', icon: 'flask', blurb: 'Living things, matter, energy and the Earth, explored through simulations and hands-on activities.' },
    Hindi: { color: '#c0601d', glyph: 'अ', blurb: 'कहानियाँ, कविताएँ और व्याकरण: reading, writing and grammar for every grade.' },
    English: { color: '#7b3f8c', glyph: 'Aa', blurb: 'Reading, writing, speaking and listening.' },
    'Global Perspectives': { color: '#1f7389', glyph: 'GP', blurb: 'Research, collaboration and reflection on the world around us.' },
  };
  const subjectStyle = (name) => SUBJECT_STYLE[name] || { color: (subjects.find((s) => s.name === name) || {}).color || '#5f6c7b', glyph: String(name || '?')[0], blurb: '' };

  let subjects = [];
  const setSubjects = (list) => { subjects = list || []; };
  const subjectColor = (name) => subjectStyle(name).color;
  const subjectShort = (name) => (subjects.find((s) => s.name === name) || {}).short || name;

  /** Generated cover art for items without a thumbnail: subject-coloured gradient + type icon. */
  function art(item) {
    const c = subjectColor(item.subject);
    const t = typeInfo(item.type);
    if (typeOf(item.type) === 'Book') {
      return `<div class="art book-cover" style="background:linear-gradient(160deg, ${c}, color-mix(in srgb, ${c} 50%, #10131c))">
        <span class="bc-kicker">Textbook</span>
        <span class="bc-subject">${esc(item.subject || '')}</span>
        ${item.grade ? `<span class="bc-grade">Grade ${item.grade}</span>` : ''}
        ${item.unit && item.unit !== 99 ? `<span class="bc-unit">Unit ${item.unit}</span>` : ''}</div>`;
    }
    return `<div class="art" style="background:linear-gradient(150deg, color-mix(in srgb, ${t.color} 70%, ${c}), color-mix(in srgb, ${c} 60%, #10131c))">${ICONS[t.icon]}</div>`;
  }

  function thumb(item) {
    return item.thumbUrl ? `<img src="${esc(item.thumbUrl)}" alt="" loading="lazy">` : art(item);
  }

  function toast(msg, ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function bytes(n) {
    if (!n) return '-';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
  }

  function when(iso) {
    if (!iso) return 'never';
    const d = new Date(iso);
    const diff = (Date.now() - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
    return d.toLocaleDateString();
  }

  /** Modal dialog. Returns { el, close }. `build(body)` fills the body; buttons: [{label, kind, onClick}]. */
  function dialog(title, html, buttons = []) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-head"><h2>${esc(title)}</h2><button class="btn ghost sm" data-x aria-label="Close">${ICONS.close}</button></div>
      <div class="dialog-body">${html}</div>
      <div class="dialog-foot"></div></div>`;
    const foot = overlay.querySelector('.dialog-foot');
    const close = () => overlay.remove();
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.kind || '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => b.onClick ? b.onClick(close, btn) : close());
      foot.appendChild(btn);
    }
    if (!buttons.length) foot.remove();
    overlay.querySelector('[data-x]').addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
    document.body.appendChild(overlay);
    return { el: overlay, close };
  }

  function changePassword() {
    const d = dialog('Change your password', `
      <label class="field">Current password<input class="input" type="password" name="current" autocomplete="current-password"></label>
      <label class="field">New password (at least 8 characters)<input class="input" type="password" name="next" autocomplete="new-password"></label>
      <label class="field">Repeat new password<input class="input" type="password" name="again" autocomplete="new-password"></label>
      <div class="alert error" hidden></div>`, [
      { label: 'Cancel' },
      { label: 'Change password', kind: 'primary', onClick: async (close, btn) => {
        const v = (n) => d.el.querySelector(`[name=${n}]`).value;
        const err = d.el.querySelector('.alert');
        err.hidden = true;
        if (v('next') !== v('again')) { err.textContent = 'The new passwords do not match.'; err.hidden = false; return; }
        btn.disabled = true;
        try {
          await api('/api/me/password', { method: 'POST', body: { current: v('current'), next: v('next') } });
          close();
          toast('Password changed. Other devices were signed out.');
        } catch (e) { err.textContent = e.message; err.hidden = false; }
        btn.disabled = false;
      } },
    ]);
  }

  /** Top-right avatar menu. */
  function userMenu(mount, user) {
    const initials = (user.displayName || user.username).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    mount.innerHTML = `<div class="usermenu">
      <button class="avatar" aria-haspopup="true" title="${esc(user.displayName)}">${esc(initials)}</button>
      <div class="menu" hidden>
        <div class="who"><div><b>${esc(user.displayName)}</b></div><div class="small muted">@${esc(user.username)} · ${user.role === 'admin' ? 'Admin' : 'Viewer'}</div></div>
        <a href="/">Library</a>
        ${user.role === 'admin' ? '<a href="/admin">Admin panel</a>' : ''}
        <button data-pw>Change password</button>
        <button data-out>Sign out</button>
      </div></div>`;
    const menu = mount.querySelector('.menu');
    mount.querySelector('.avatar').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('click', () => { menu.hidden = true; });
    mount.querySelector('[data-pw]').addEventListener('click', changePassword);
    mount.querySelector('[data-out]').addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' }).catch(() => {});
      location.href = '/login';
    });
  }

  function lessonLabel(item) {
    const parts = [];
    if (item.grade) parts.push(`Grade ${item.grade}`);
    if (item.strand) parts.push(item.strand);
    if (item.unit && item.unit !== 99) parts.push(`Unit ${item.unit}`);
    if (item.unit === 99) parts.push('Vyakaran');
    if (item.lesson) parts.push(`Lesson ${item.lesson}`);
    return parts.join(' · ');
  }

  return { api, esc, ICONS, TYPE_ICON, TYPE_INFO, TYPES, MAIN_TYPES, typeOf, typeInfo, typeIcon, subjectStyle, setSubjects, subjectColor, subjectShort, art, thumb, toast, bytes, when, dialog, userMenu, lessonLabel, changePassword };
})();
