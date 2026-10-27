'use strict';
// Library: everything organised like the books (Subject > Grade > Unit > Lesson), with filters and search.

(async () => {
  const $ = (id) => document.getElementById(id);
  const { esc, ICONS } = GP;

  $('search-icon').innerHTML = ICONS.search;
  $('toggle-filters').innerHTML = ICONS.menu;
  $('toggle-filters').addEventListener('click', () => $('sidebar').classList.toggle('open'));

  const [me, cur, cat] = await Promise.all([GP.api('/api/me'), GP.api('/api/curriculum'), GP.api('/api/catalog')]);
  GP.setSubjects(cur.subjects);
  GP.userMenu($('user'), me.user);
  $('site-name').textContent = me.site.siteName;
  document.title = me.site.siteName;

  const items = cat.items;
  const lessons = cur.lessons;
  const state = { subject: '', grade: 0, type: '', q: '', showEmpty: false };

  // ---- URL hash keeps the view shareable and survives reloads
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    state.subject = h.get('subject') || '';
    state.grade = +h.get('grade') || 0;
    state.type = h.get('type') || '';
    state.q = h.get('q') || '';
    state.showEmpty = h.get('all') === '1';
  }
  function writeHash() {
    const h = new URLSearchParams();
    if (state.subject) h.set('subject', state.subject);
    if (state.grade) h.set('grade', state.grade);
    if (state.type) h.set('type', state.type);
    if (state.q) h.set('q', state.q);
    if (state.showEmpty) h.set('all', '1');
    history.replaceState(null, '', '#' + h.toString());
  }

  const matchesType = (i) => !state.type || i.type === state.type;
  const matchesQuery = (i) => {
    if (!state.q) return true;
    const hay = [i.title, i.lessonTitle, i.unitTitle, i.chapter, i.subject, i.strand, i.type, i.description, ...(i.tags || []), `grade ${i.grade}`].join(' ').toLowerCase();
    return state.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  };

  // ---- sidebar
  function renderSidebar() {
    const pool = items.filter(matchesType);
    const subjects = cur.subjects.filter((s) => lessons.some((l) => l.subject === s.name) || items.some((i) => i.subject === s.name));
    $('subjects').innerHTML = [
      `<button class="navitem ${!state.subject ? 'active' : ''}" data-subject=""><span class="dot" style="background:linear-gradient(135deg,#2f80ed,#27ae60)"></span>All subjects<span class="count">${pool.length}</span></button>`,
      ...subjects.map((s) => `<button class="navitem ${state.subject === s.name ? 'active' : ''}" data-subject="${esc(s.name)}">
        <span class="dot" style="background:${esc(s.color)}"></span>${esc(s.name)}<span class="count">${pool.filter((i) => i.subject === s.name).length}</span></button>`),
    ].join('');

    const grades = [...new Set([...lessons, ...items].filter((x) => !state.subject || x.subject === state.subject).map((x) => x.grade).filter(Boolean))].sort((a, b) => a - b);
    $('grades').innerHTML = [`<button class="chip ${!state.grade ? 'active' : ''}" data-grade="0">All</button>`,
      ...grades.map((g) => `<button class="chip ${state.grade === g ? 'active' : ''}" data-grade="${g}">${g}</button>`)].join('');

    const types = cat.types.filter((t) => items.some((i) => i.type === t));
    $('types').innerHTML = [`<button class="navitem ${!state.type ? 'active' : ''}" data-type="">All types</button>`,
      ...types.map((t) => `<button class="navitem ${state.type === t ? 'active' : ''}" data-type="${esc(t)}">${GP.ICONS[GP.TYPE_ICON[t]].replace('<svg', '<svg width="18" height="18"')}${esc(t)}<span class="count">${items.filter((i) => i.type === t).length}</span></button>`)].join('');
    $('show-empty').checked = state.showEmpty;
  }

  $('sidebar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.subject !== undefined) { state.subject = b.dataset.subject; if (state.grade && !lessons.concat(items).some((x) => x.grade === state.grade && (!state.subject || x.subject === state.subject))) state.grade = 0; }
    if (b.dataset.grade !== undefined) state.grade = +b.dataset.grade;
    if (b.dataset.type !== undefined) state.type = b.dataset.type;
    $('sidebar').classList.remove('open');
    update();
  });
  $('show-empty').addEventListener('change', (e) => { state.showEmpty = e.target.checked; update(); });
  let qTimer;
  $('q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim(); update(); }, 150); });

  // ---- cards & books
  function card(i, compact) {
    return `<a class="card" href="/play/${esc(i.id)}">
      <div class="thumb">${GP.thumb(i)}<span class="play">${ICONS.play}</span></div>
      <div class="body">
        <div class="title">${esc(i.title)}</div>
        ${compact ? '' : `<div class="meta">${esc(GP.subjectShort(i.subject))} · ${esc(GP.lessonLabel(i))}</div>`}
        <div class="tags"><span class="badge">${esc(i.type)}</span>${me.user.role === 'admin' && (!i.visible || i.status !== 'ready') ? `<span class="badge warn">${i.status !== 'ready' ? esc(i.status) : 'hidden'}</span>` : ''}</div>
      </div></a>`;
  }

  const strandOrder = (s) => (s ? ['Biology', 'Chemistry', 'Physics'].indexOf(s) + 1 : 0);

  /** One book = subject + grade: units in order, each lesson with its items. */
  function book(subject, grade, bookItems) {
    const bookLessons = lessons.filter((l) => l.subject === subject && l.grade === grade);
    const unitsMap = new Map();
    const unitKey = (strand, unit) => `${strand}|${unit}`;
    for (const l of bookLessons) {
      const k = unitKey(l.strand, l.unit);
      if (!unitsMap.has(k)) unitsMap.set(k, { strand: l.strand, unit: l.unit, title: l.unitTitle, lessons: [] });
      unitsMap.get(k).lessons.push({ ...l, items: [] });
    }
    const loose = [];
    for (const i of bookItems) {
      const u = unitsMap.get(unitKey(i.strand || '', i.unit));
      const l = u && u.lessons.find((x) => x.lesson === i.lesson);
      if (l) l.items.push(i); else loose.push(i);
    }
    const units = [...unitsMap.values()].sort((a, b) => strandOrder(a.strand) - strandOrder(b.strand) || a.unit - b.unit);
    const color = GP.subjectColor(subject);
    let html = '';
    for (const u of units) {
      const shown = u.lessons.sort((a, b) => a.lesson - b.lesson).filter((l) => l.items.length || state.showEmpty);
      if (!shown.length) continue;
      const unitName = u.unit === 99 ? 'Grammar' : `${u.strand ? u.strand + ' · ' : ''}Unit ${u.unit}`;
      html += `<section class="unit"><div class="unit-title"><span class="num">${esc(unitName)}</span><span>${esc(u.title)}</span></div>
        ${shown.map((l) => `<div class="lesson">
          <div class="lesson-label"><div class="ln">Lesson ${l.lesson}</div><div class="lt">${esc(l.lessonTitle)}</div>${l.chapter ? `<div class="ch">LMS: ${esc(l.chapter)}</div>` : ''}</div>
          ${l.items.length ? `<div class="cards">${l.items.map((i) => card(i, true)).join('')}</div>` : '<div class="empty">Nothing uploaded yet</div>'}
        </div>`).join('')}</section>`;
    }
    if (loose.length) {
      html += `<section class="unit"><div class="unit-title"><span class="num">More</span><span>Not linked to a lesson</span></div>
        <div class="cards" style="padding-bottom:6px">${loose.map((i) => card(i)).join('')}</div></section>`;
    }
    if (!html) return '';
    const count = bookItems.length;
    return `<article class="book">
      <div class="book-head"><span class="book-spine" style="background:${esc(color)}"></span>
        <div class="grow"><h2>${esc(subject)} · Grade ${grade}</h2><div class="small muted">${count} item${count === 1 ? '' : 's'} · ${bookLessons.length} lessons in the book</div></div>
        <span style="color:${esc(color)}">${ICONS.book.replace('<svg', '<svg width="26" height="26"')}</span></div>
      ${html}</article>`;
  }

  function render() {
    const visible = items.filter((i) => matchesType(i) && matchesQuery(i) && (!state.subject || i.subject === state.subject) && (!state.grade || i.grade === state.grade));
    const content = $('content');
    const subjectName = state.subject || 'All subjects';
    $('heading').textContent = state.grade ? `${subjectName} · Grade ${state.grade}` : subjectName;
    $('subheading').textContent = `${visible.length} item${visible.length === 1 ? '' : 's'}${state.type ? ' · ' + state.type : ''}${state.q ? ` matching "${state.q}"` : ''}`;

    if (state.q) {
      content.innerHTML = visible.length ? `<div class="cards">${visible.map((i) => card(i)).join('')}</div>` : emptyState('No results', 'Try another word, or clear the filters.');
      return;
    }

    // books: every subject+grade that has items (or, with "show empty", every book in the filter)
    const keys = new Map();
    const add = (s, g) => { if (s && g) keys.set(`${s}|${g}`, { subject: s, grade: g }); };
    visible.forEach((i) => add(i.subject, i.grade));
    if (state.showEmpty) lessons.filter((l) => (!state.subject || l.subject === state.subject) && (!state.grade || l.grade === state.grade)).forEach((l) => add(l.subject, l.grade));
    const subjectOrder = (s) => { const i = cur.subjects.findIndex((x) => x.name === s); return i < 0 ? 99 : i; };
    const books = [...keys.values()].sort((a, b) => subjectOrder(a.subject) - subjectOrder(b.subject) || a.grade - b.grade);

    let html = books.map((b) => book(b.subject, b.grade, visible.filter((i) => i.subject === b.subject && i.grade === b.grade))).join('');
    const ungraded = visible.filter((i) => !i.grade);
    if (ungraded.length) html += `<article class="book"><div class="book-head"><div class="grow"><h2>Other</h2></div></div><div class="unit"><div class="cards" style="padding:12px 0">${ungraded.map((i) => card(i)).join('')}</div></div></article>`;
    content.innerHTML = html || (items.length
      ? emptyState('Nothing here yet', 'No content for this subject and grade. Turn on "Show lessons without content" to see the whole book.')
      : emptyState('The library is empty', me.user.role === 'admin' ? 'Open the Admin panel to upload your first game.' : 'Games will appear here once the admin uploads them.'));
  }

  function emptyState(title, text) {
    return `<div class="empty-state">${ICONS.game}<h2>${esc(title)}</h2><p>${esc(text)}</p>${me.user.role === 'admin' && !items.length ? '<a class="btn primary" href="/admin">Open Admin panel</a>' : ''}</div>`;
  }

  function update() {
    writeHash();
    renderSidebar();
    render();
  }

  readHash();
  $('q').value = state.q;
  update();
  window.addEventListener('hashchange', () => { readHash(); $('q').value = state.q; renderSidebar(); render(); });
})().catch((e) => { if (e.message !== 'Signed out') document.getElementById('content').innerHTML = `<div class="alert error">${GP.esc(e.message)}</div>`; });
