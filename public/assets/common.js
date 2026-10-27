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
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 20a6.5 6.5 0 0 0-3-5.5"/></svg>',
  };

  const TYPE_ICON = { Game: 'game', '2D Interactivity': 'hand', '3D Interactivity': 'cube', Simulation: 'flask', Animation: 'film', Other: 'spark' };

  let subjects = [];
  const setSubjects = (list) => { subjects = list || []; };
  const subjectColor = (name) => (subjects.find((s) => s.name === name) || {}).color || '#5f6c7b';
  const subjectShort = (name) => (subjects.find((s) => s.name === name) || {}).short || name;

  /** Generated cover art for items without a thumbnail: subject-coloured gradient + type icon. */
  function art(item) {
    const c = subjectColor(item.subject);
    const icon = ICONS[TYPE_ICON[item.type] || 'spark'];
    return `<div class="art" style="background:linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 55%, #0b1630))">${icon}</div>`;
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

  return { api, esc, ICONS, TYPE_ICON, setSubjects, subjectColor, subjectShort, art, thumb, toast, bytes, when, dialog, userMenu, lessonLabel, changePassword };
})();
