'use strict';
// Library: the whole curriculum (Subject > Grade > Unit > Lesson) with every resource attached to its lesson.
// Routes live in the URL hash so every page can be bookmarked and shared:
//   #/                     home            #/s/<subject>/<grade>  one grade of a subject (the "course")
//   #/s/<subject>          subject         #/l/<lessonId>         one lesson and its resources
//   #/t/<type>             one format      #/search/<words>       search

(async () => {
  const $ = (id) => document.getElementById(id);
  const { esc, ICONS } = GP;

  $('search-icon').innerHTML = ICONS.search;
  const [me, cur, cat] = await Promise.all([GP.api('/api/me'), GP.api('/api/curriculum'), GP.api('/api/catalog')]);
  GP.setSubjects(cur.subjects);
  GP.userMenu($('user'), me.user);
  const site = me.site;
  const isAdmin = me.user.role === 'admin';
  $('site-name').textContent = site.siteName;

  // ---------------------------------------------------------------- data
  const items = cat.items.map((i) => ({ ...i, type: GP.typeOf(i.type) }));
  const strandOrder = (s) => (s ? ['Biology', 'Chemistry', 'Physics'].indexOf(s) + 1 : 0);
  const lessons = [...cur.lessons].sort((a, b) => strandOrder(a.strand) - strandOrder(b.strand) || a.unit - b.unit || a.lesson - b.lesson);
  const lessonById = new Map(lessons.map((l) => [l.id, l]));
  const itemsByLesson = new Map();
  for (const i of items) {
    if (!i.lessonId || !lessonById.has(i.lessonId)) continue;
    if (!itemsByLesson.has(i.lessonId)) itemsByLesson.set(i.lessonId, []);
    itemsByLesson.get(i.lessonId).push(i);
  }
  const typeRank = (t) => GP.TYPES.indexOf(t);
  for (const list of itemsByLesson.values()) list.sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.title.localeCompare(b.title));
  const resourcesOf = (l) => itemsByLesson.get(l.id) || [];
  const subjectOrder = (s) => { const i = cur.subjects.findIndex((x) => x.name === s); return i < 0 ? 99 : i; };
  const subjects = cur.subjects.filter((s) => lessons.some((l) => l.subject === s.name) || items.some((i) => i.subject === s.name));
  const gradesOf = (subject) => [...new Set([...lessons, ...items].filter((x) => x.subject === subject && x.grade).map((x) => x.grade))].sort((a, b) => a - b);
  const courseLessons = (subject, grade) => lessons.filter((l) => l.subject === subject && l.grade === grade);
  const courseItems = (subject, grade) => items.filter((i) => i.subject === subject && i.grade === grade);
  const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
  const unitLabel = (l) => (l.unit === 99 ? 'Grammar · व्याकरण' : `${l.strand ? l.strand + ' · ' : ''}Unit ${l.unit}`);
  const typesPresent = () => GP.TYPES.filter((t) => GP.MAIN_TYPES.includes(t) || items.some((i) => i.type === t));

  // ---------------------------------------------------------------- links
  const enc = encodeURIComponent;
  const hSubject = (s) => `#/s/${enc(s)}`;
  const hCourse = (s, g, type) => `#/s/${enc(s)}/${g}${type ? '?type=' + enc(type) : ''}`;
  const hLesson = (id) => `#/l/${enc(id)}`;
  const hType = (t, q = '') => `#/t/${enc(t)}${q}`;
  const hItem = (i) => `/play/${enc(i.id)}`;

  // ---------------------------------------------------------------- building blocks
  function flag(i) {
    if (!isAdmin) return '';
    if (i.status !== 'ready') return `<span class="badge warn flag">${esc(i.status === 'draft' ? 'Draft' : i.status)}</span>`;
    return i.visible ? '' : '<span class="badge flag">Hidden</span>';
  }

  function resCard(i, { showPlace = true } = {}) {
    const t = GP.typeInfo(i.type);
    return `<a class="res-card fade-in" href="${hItem(i)}" style="--tc:${t.color}">
      <div class="thumb">${GP.thumb(i)}<span class="go">${esc(t.verb)} ${ICONS.arrow}</span>${flag(i)}</div>
      <div class="body">
        <span class="kind">${GP.typeIcon(i.type)}${esc(i.type)}</span>
        <div class="title">${esc(i.title)}</div>
        ${showPlace ? `<div class="meta">${esc(GP.subjectShort(i.subject))}${i.grade ? ' · ' + esc(GP.lessonLabel(i)) : ''}</div>` : ''}
        ${i.description ? `<div class="desc">${esc(i.description)}</div>` : ''}
      </div></a>`;
  }

  function pill(i) {
    const t = GP.typeInfo(i.type);
    return `<a class="pill" href="${hItem(i)}" style="--tc:${t.color}" title="${esc(t.verb + ': ' + i.title)}">
      <span class="i">${GP.typeIcon(i.type)}</span><span class="t">${esc(i.title)}</span><span class="k">${esc(i.type)}</span>${isAdmin && (!i.visible || i.status !== 'ready') ? '<span class="badge warn">hidden</span>' : ''}</a>`;
  }

  const crumbs = (parts) => `<nav class="crumbs">${parts.map(([label, href], n) =>
    (n ? '<span class="sep">/</span>' : '') + (href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`)).join('')}</nav>`;

  function emptyState(title, text) {
    return `<div class="empty-state">${ICONS.bookOpen}<h2>${esc(title)}</h2><p>${esc(text)}</p>
      ${isAdmin && !items.length ? '<p style="margin-top:16px"><a class="btn primary" href="/admin">Upload the first resource</a></p>' : ''}</div>`;
  }

  // ---------------------------------------------------------------- pages
  function home() {
    const grades = new Set(lessons.map((l) => l.grade));
    const covers = subjects.slice(0, 3).map((s, n) => {
      const g = gradesOf(s.name);
      const grade = g[Math.min(g.length - 1, [2, 5, 1][n] || 0)] || '';
      const c = GP.subjectColor(s.name);
      return `<div class="stack s${n + 1}" style="background:linear-gradient(160deg, ${c}, color-mix(in srgb, ${c} 45%, #10131c))"><small>${esc(s.name)}</small><b>Grade ${esc(grade)}</b></div>`;
    }).join('');
    const recent = [...items].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 8);

    return `
      <section class="hero fade-in">
        <div>
          <div class="eyebrow">${esc(site.siteName)}</div>
          <h1>Every lesson, <em>brought to life.</em></h1>
          <p class="lede">${esc(site.tagline || '')}. Everything is organised exactly like the textbooks: pick a subject and grade, open a unit, and every lesson lists its book pages, flashcards, interactivities, simulations and games.</p>
          <form class="hero-search" id="hero-search"><span>${ICONS.search}</span>
            <input class="input" name="q" type="search" placeholder="Try “fractions”, “photosynthesis” or “संज्ञा”" autocomplete="off" aria-label="Search the library"></form>
          <div class="stat-line">
            <div><b>${subjects.length}</b><span>Subjects</span></div>
            <div><b>${grades.size}</b><span>Grades</span></div>
            <div><b>${lessons.length}</b><span>Lessons</span></div>
            <div><b>${items.length}</b><span>Resources</span></div>
          </div>
        </div>
        <div class="hero-art" aria-hidden="true">${covers}</div>
      </section>

      <section class="section">
        <div class="section-head"><div class="grow"><h2>Browse by subject</h2><p>Choose a subject, then a grade, to see every unit and lesson in the book.</p></div></div>
        <div class="subject-grid">${subjects.map(subjectCard).join('')}</div>
      </section>

      <section class="section">
        <div class="section-head"><div class="grow"><h2>Browse by format</h2><p>Looking for a particular kind of resource? Start here.</p></div></div>
        <div class="format-grid">${typesPresent().map((t) => {
          const info = GP.TYPE_INFO[t];
          return `<a class="format-tile" href="${hType(t)}" style="--tc:${info.color}"><span class="ico">${ICONS[info.icon]}</span>
            <h3>${esc(info.plural)} <span>${items.filter((i) => i.type === t).length}</span></h3><p>${esc(info.blurb)}</p></a>`;
        }).join('')}</div>
      </section>

      ${recent.length ? `<section class="section">
        <div class="section-head"><div class="grow"><h2>Recently added</h2><p>The newest resources across all subjects.</p></div></div>
        <div class="res-grid">${recent.map((i) => resCard(i)).join('')}</div></section>` : ''}

      <section class="section">
        <div class="section-head"><div class="grow"><h2>How the library is organised</h2></div></div>
        <div class="format-grid">
          <div class="format-tile" style="--tc:var(--accent)"><span class="ico">${ICONS.book}</span><h3>Subject &amp; grade</h3><p>Each subject is split into grades, just like the printed books on the shelf.</p></div>
          <div class="format-tile" style="--tc:var(--accent)"><span class="ico">${ICONS.menu}</span><h3>Units &amp; lessons</h3><p>Inside a grade, units and lessons follow the textbook order, with the LMS chapter name alongside.</p></div>
          <div class="format-tile" style="--tc:var(--accent)"><span class="ico">${ICONS.spark}</span><h3>Resources</h3><p>Each lesson collects everything made for it: the book pages, flashcards, interactivities, simulations and games.</p></div>
        </div>
      </section>`;
  }

  function subjectCard(s) {
    const st = GP.subjectStyle(s.name);
    const ls = lessons.filter((l) => l.subject === s.name);
    const n = items.filter((i) => i.subject === s.name).length;
    return `<div class="subject-card fade-in" style="--c:${st.color}">
      <a class="top" href="${hSubject(s.name)}" style="color:inherit;text-decoration:none"><span class="glyph">${st.icon ? ICONS[st.icon] : esc(st.glyph)}</span><h3>${esc(s.name)}</h3></a>
      <p>${esc(st.blurb)}</p>
      <div class="meta"><span>${plural(ls.length, 'lesson')}</span><span>${plural(n, 'resource')}</span></div>
      <div class="grade-chips">${gradesOf(s.name).map((g) => `<a href="${hCourse(s.name, g)}" class="${courseItems(s.name, g).length ? 'has' : ''}" title="${esc(s.name)} · Grade ${g}">${g}</a>`).join('')}</div>
    </div>`;
  }

  function subjectPage(subject) {
    if (!subjects.some((s) => s.name === subject)) return notFound();
    const st = GP.subjectStyle(subject);
    const ls = lessons.filter((l) => l.subject === subject);
    const its = items.filter((i) => i.subject === subject);
    const units = new Set(ls.map((l) => `${l.grade}|${l.strand}|${l.unit}`));
    const vols = gradesOf(subject).map((g) => {
      const cl = courseLessons(subject, g);
      const ci = courseItems(subject, g);
      const covered = cl.filter((l) => resourcesOf(l).length).length;
      const u = new Set(cl.map((l) => `${l.strand}|${l.unit}`)).size;
      return `<a class="volume fade-in" href="${hCourse(subject, g)}" style="--c:${st.color}">
        <div class="cover" style="background:linear-gradient(160deg, ${st.color}, color-mix(in srgb, ${st.color} 42%, #10131c))">
          <small>${esc(subject)}</small><div><div class="g">${g}</div><div class="s">Grade ${g}</div></div></div>
        <div class="info"><span>${plural(u, 'unit')} · ${plural(cl.length, 'lesson')} · ${plural(ci.length, 'resource')}</span>
          <span class="meter" title="${covered} of ${cl.length} lessons have resources"><i style="width:${cl.length ? Math.round(covered / cl.length * 100) : 0}%"></i></span></div></a>`;
    }).join('');
    return `${crumbs([['Library', '#/'], [subject]])}
      <header class="course-head" style="--c:${st.color}">
        <div class="eyebrow" style="color:${st.color}">Subject</div>
        <h1>${esc(subject)}</h1>
        <p class="lede">${esc(st.blurb)}</p>
        <div class="facts"><span><b>${gradesOf(subject).length}</b> grades</span><span><b>${units.size}</b> units</span><span><b>${ls.length}</b> lessons</span><span><b>${its.length}</b> resources</span></div>
      </header>
      <div class="section-head"><div class="grow"><h2>Choose a grade</h2><p>The bar under each book shows how many of its lessons already have resources.</p></div></div>
      <div class="volume-grid">${vols}</div>`;
  }

  function coursePage(subject, grade, typeFilter) {
    const st = GP.subjectStyle(subject);
    const cl = courseLessons(subject, grade);
    const ci = courseItems(subject, grade);
    if (!cl.length && !ci.length) return notFound();
    const show = (i) => !typeFilter || i.type === typeFilter;
    const covered = cl.filter((l) => resourcesOf(l).length).length;

    // units in book order (Science 6-8 is grouped by strand)
    const units = [];
    for (const l of cl) {
      let u = units.find((x) => x.strand === l.strand && x.unit === l.unit);
      if (!u) units.push(u = { strand: l.strand, unit: l.unit, title: l.unitTitle, lessons: [] });
      u.lessons.push(l);
    }
    const anchor = (s) => 'a-' + s.replace(/[^a-z0-9]+/gi, '-');
    let lastStrand = null;
    const toc = units.map((u) => {
      const strandHead = u.strand && u.strand !== lastStrand ? `<div class="strand">${esc(u.strand)}</div>` : '';
      lastStrand = u.strand;
      const n = u.lessons.reduce((s, l) => s + resourcesOf(l).filter(show).length, 0);
      return `${strandHead}<a href="#" data-jump="${anchor(u.strand + u.unit)}"><b>${u.unit === 99 ? '✎' : u.unit}</b><span>${esc(u.title)}</span>${n ? `<span class="n">${n}</span>` : ''}</a>`;
    }).join('');

    const body = units.map((u) => `
      <section class="unit-block" id="${anchor(u.strand + u.unit)}" style="--c:${st.color}">
        <header><span class="u">${esc(unitLabel(u))}</span><h2>${esc(u.title)}</h2></header>
        <div class="lessons">${u.lessons.map((l) => {
          const rs = resourcesOf(l).filter(show);
          return `<div class="lesson-row ${rs.length ? 'has' : ''}">
            <span class="num">${l.lesson}</span>
            <div><h3><a href="${hLesson(l.id)}">${esc(l.lessonTitle)}</a></h3>
              ${l.chapter && l.chapter !== l.lessonTitle ? `<div class="ch">LMS chapter: ${esc(l.chapter)}</div>` : ''}
              ${rs.length ? `<div class="pills">${rs.map(pill).join('')}</div>` : `<div class="soon">${typeFilter ? `No ${esc(GP.TYPE_INFO[typeFilter].plural.toLowerCase())} for this lesson yet` : 'Resources coming soon'}</div>`}
            </div></div>`;
        }).join('')}</div>
      </section>`).join('');

    const loose = ci.filter((i) => show(i) && (!i.lessonId || !lessonById.has(i.lessonId)));
    const typeCounts = GP.TYPES.map((t) => [t, ci.filter((i) => i.type === t).length]).filter(([, n]) => n);
    const otherGrades = gradesOf(subject).filter((g) => g !== grade);

    return `${crumbs([['Library', '#/'], [subject, hSubject(subject)], [`Grade ${grade}`]])}
      <header class="course-head">
        <div class="eyebrow" style="color:${st.color}">${esc(subject)}</div>
        <h1>Grade ${grade}</h1>
        <div class="facts"><span><b>${units.length}</b> units</span><span><b>${cl.length}</b> lessons</span><span><b>${ci.length}</b> resources</span><span><b>${covered}</b> of ${cl.length} lessons ready</span></div>
        ${typeCounts.length ? `<div class="filterbar" id="type-filter">
          <a class="chip ${!typeFilter ? 'active' : ''}" href="${hCourse(subject, grade)}">Everything <span class="n">${ci.length}</span></a>
          ${typeCounts.map(([t, n]) => `<a class="chip ${typeFilter === t ? 'active' : ''}" href="${hCourse(subject, grade, t)}">${GP.typeIcon(t)}${esc(GP.TYPE_INFO[t].plural)} <span class="n">${n}</span></a>`).join('')}
        </div>` : ''}
        ${otherGrades.length ? `<div class="grade-chips" style="--c:${st.color};margin-top:4px"><span class="small faint" style="align-self:center;margin-right:4px">Other grades</span>${otherGrades.map((g) => `<a href="${hCourse(subject, g)}">${g}</a>`).join('')}</div>` : ''}
      </header>
      <div class="course-layout">
        <aside class="toc"><h4>Contents</h4>${toc}</aside>
        <div>${body}
          ${loose.length ? `<section class="unit-block"><header><span class="u">More</span><h2>Other ${esc(subject)} resources for Grade ${grade}</h2></header><div class="res-grid">${loose.map((i) => resCard(i, { showPlace: false })).join('')}</div></section>` : ''}
        </div>
      </div>`;
  }

  function lessonPage(id) {
    const l = lessonById.get(id);
    if (!l) return notFound();
    const st = GP.subjectStyle(l.subject);
    const rs = resourcesOf(l);
    const course = courseLessons(l.subject, l.grade);
    const idx = course.findIndex((x) => x.id === l.id);
    const prev = course[idx - 1];
    const next = course[idx + 1];
    const siblings = course.filter((x) => x.strand === l.strand && x.unit === l.unit);
    const formats = GP.TYPES.filter((t) => rs.some((i) => i.type === t));

    return `${crumbs([['Library', '#/'], [l.subject, hSubject(l.subject)], [`Grade ${l.grade}`, hCourse(l.subject, l.grade)], [unitLabel(l)]])}
      <header class="lesson-hero fade-in">
        <div class="eyebrow" style="color:${st.color}">${esc(unitLabel(l))} · ${esc(l.unitTitle)} · Lesson ${l.lesson}</div>
        <h1>${esc(l.lessonTitle)}</h1>
        ${l.chapter && l.chapter !== l.lessonTitle ? `<div class="ch">LMS chapter: ${esc(l.chapter)}</div>` : ''}
        <div class="facts small muted">${esc(l.subject)} · Grade ${l.grade} · ${rs.length ? plural(rs.length, 'resource') : 'no resources yet'}</div>
      </header>
      ${rs.length ? `<div class="filterbar" style="margin:-8px 0 20px">${formats.map((t) => `<span class="chip" style="cursor:default">${GP.typeIcon(t)}${esc(GP.TYPE_INFO[t].plural)} <span class="n">${rs.filter((i) => i.type === t).length}</span></span>`).join('')}</div>
        <div class="res-grid">${rs.map((i) => resCard(i, { showPlace: false })).join('')}</div>` : `<div class="lesson-empty"><h3>Resources are on the way</h3><p>Nothing has been published for this lesson yet. Other lessons in this unit are listed below.</p></div>`}
      ${siblings.length > 1 ? `<section class="section"><div class="section-head"><div class="grow"><h2>${esc(l.unitTitle)}</h2><p>All lessons in this unit</p></div></div>
        <div class="result-lessons">${siblings.map((x) => `<a href="${hLesson(x.id)}" style="${x.id === l.id ? 'background:var(--surface)' : ''}">
          <span><small>Lesson ${x.lesson}</small><br>${esc(x.lessonTitle)}</span><span class="small faint" style="align-self:center">${resourcesOf(x).length ? plural(resourcesOf(x).length, 'resource') : ''}</span></a>`).join('')}</div></section>` : ''}
      <nav class="lesson-nav">
        ${prev ? `<a href="${hLesson(prev.id)}"><small>← Previous lesson</small><span>${esc(prev.lessonTitle)}</span></a>` : '<span></span>'}
        ${next ? `<a class="next" href="${hLesson(next.id)}"><small>Next lesson →</small><span>${esc(next.lessonTitle)}</span></a>` : ''}
      </nav>`;
  }

  function typePage(type, params) {
    if (!GP.TYPE_INFO[type]) return notFound();
    const info = GP.TYPE_INFO[type];
    const subject = params.get('subject') || '';
    const grade = +params.get('grade') || 0;
    const all = items.filter((i) => i.type === type);
    const list = all.filter((i) => (!subject || i.subject === subject) && (!grade || i.grade === grade));
    const groups = new Map();
    for (const i of list.sort((a, b) => subjectOrder(a.subject) - subjectOrder(b.subject) || a.grade - b.grade || (a.unit || 0) - (b.unit || 0) || (a.lesson || 0) - (b.lesson || 0))) {
      const k = `${i.subject}|${i.grade}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    }
    const subjOpts = [...new Set(all.map((i) => i.subject))].sort((a, b) => subjectOrder(a) - subjectOrder(b));
    const gradeOpts = [...new Set(all.filter((i) => !subject || i.subject === subject).map((i) => i.grade).filter(Boolean))].sort((a, b) => a - b);
    return `${crumbs([['Library', '#/'], [info.plural]])}
      <header class="course-head" style="--tc:${info.color}">
        <div class="eyebrow" style="color:${info.color}">Format</div>
        <h1>${esc(info.plural)}</h1>
        <p class="lede">${esc(info.blurb)}</p>
        ${all.length ? `<div class="selects" id="type-filters">
          <select class="input" name="subject" aria-label="Subject"><option value="">All subjects</option>${subjOpts.map((s) => `<option ${s === subject ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          <select class="input" name="grade" aria-label="Grade"><option value="">All grades</option>${gradeOpts.map((g) => `<option value="${g}" ${g === grade ? 'selected' : ''}>Grade ${g}</option>`).join('')}</select>
        </div>` : ''}
      </header>
      ${[...groups.entries()].map(([k, list2]) => {
        const [s, g] = k.split('|');
        return `<section class="section" style="margin-top:30px"><div class="section-head"><div class="grow"><h2>${esc(s)}${+g ? ' · Grade ' + g : ''}</h2></div>
          ${+g ? `<a class="btn sm" href="${hCourse(s, +g, type)}">See it in the book ${ICONS.arrow}</a>` : ''}</div>
          <div class="res-grid">${list2.map((i) => resCard(i)).join('')}</div></section>`;
      }).join('') || emptyState(`No ${info.plural.toLowerCase()} yet`, all.length ? 'Nothing matches these filters.' : `${info.plural} will appear here as soon as they are published.`)}`;
  }

  function searchPage(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (text) => { const t = text.toLowerCase(); return words.every((w) => t.includes(w)); };
    const ls = lessons.filter((l) => hit([l.lessonTitle, l.unitTitle, l.chapter, l.subject, l.strand, `grade ${l.grade}`, `unit ${l.unit}`, `lesson ${l.lesson}`].join(' '))).slice(0, 60);
    const rs = items.filter((i) => hit([i.title, i.lessonTitle, i.unitTitle, i.chapter, i.subject, i.strand, i.type, GP.typeInfo(i.type).plural, i.description, ...(i.tags || []), `grade ${i.grade}`].join(' ')));
    return `${crumbs([['Library', '#/'], ['Search']])}
      <header class="course-head"><div class="eyebrow">Search</div><h1>“${esc(q)}”</h1>
        <div class="facts"><span><b>${rs.length}</b> resources</span><span><b>${ls.length}</b> lessons</span></div></header>
      ${rs.length ? `<div class="section-head"><div class="grow"><h2>Resources</h2></div></div><div class="res-grid" style="margin-bottom:40px">${rs.map((i) => resCard(i)).join('')}</div>` : ''}
      ${ls.length ? `<div class="section-head"><div class="grow"><h2>Lessons</h2></div></div><div class="result-lessons">${ls.map((l) => `<a href="${hLesson(l.id)}">
        <span><small>${esc(l.subject)} · Grade ${l.grade} · ${esc(unitLabel(l))} · Lesson ${l.lesson}</small><br>${esc(l.lessonTitle)}</span>
        <span class="small faint" style="align-self:center">${resourcesOf(l).length ? plural(resourcesOf(l).length, 'resource') : ''}</span></a>`).join('')}</div>` : ''}
      ${!rs.length && !ls.length ? emptyState('No matches', 'Try fewer or different words, for example a chapter name or a topic.') : ''}`;
  }

  const notFound = () => emptyState('Page not found', 'That page does not exist. Use the links above to find your way.');

  // ---------------------------------------------------------------- router
  function navHtml(active) {
    const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'active' : ''}">${esc(label)}</a>`;
    return [link('#/', 'Home', 'home'), ...typesPresent().map((t) => link(hType(t), GP.TYPE_INFO[t].plural, t)),
      ...(isAdmin ? ['<a href="/admin">Admin</a>'] : [])].join('');
  }

  function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, query = ''] = raw.split('?');
    const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const params = new URLSearchParams(query);
    let html, active = '', title = site.siteName;
    if (!parts.length) { html = home(); active = 'home'; }
    else if (parts[0] === 's' && parts[2]) { html = coursePage(parts[1], +parts[2], params.get('type') || ''); title = `${parts[1]} · Grade ${parts[2]}`; }
    else if (parts[0] === 's') { html = subjectPage(parts[1]); title = parts[1]; }
    else if (parts[0] === 'l') { html = lessonPage(parts[1]); title = (lessonById.get(parts[1]) || {}).lessonTitle || title; }
    else if (parts[0] === 't') { html = typePage(parts[1], params); active = parts[1]; title = (GP.TYPE_INFO[parts[1]] || {}).plural || title; }
    else if (parts[0] === 'search') { html = searchPage(parts.slice(1).join('/')); title = 'Search'; }
    else html = notFound();

    $('nav').innerHTML = navHtml(active);
    $('subnav').innerHTML = navHtml(active);
    $('view').innerHTML = html;
    document.title = title === site.siteName ? title : `${title} · ${site.siteName}`;
    if (parts[0] !== 'search') $('q').value = '';
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // ---------------------------------------------------------------- events
  const goSearch = (q) => { q = q.trim(); location.hash = q ? '#/search/' + enc(q) : '#/'; };
  let qTimer;
  $('q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { if (e.target.value.trim().length >= 2) goSearch(e.target.value); }, 350); });
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(qTimer); goSearch(e.target.value); } });
  $('view').addEventListener('submit', (e) => {
    if (e.target.id !== 'hero-search') return;
    e.preventDefault();
    goSearch(e.target.q.value);
  });
  $('view').addEventListener('click', (e) => {
    const j = e.target.closest('[data-jump]');
    if (!j) return;
    e.preventDefault();
    document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('view').addEventListener('change', (e) => {
    const box = e.target.closest('#type-filters');
    if (!box) return;
    const type = decodeURIComponent(location.hash.split('/')[2].split('?')[0]);
    const s = box.querySelector('[name=subject]').value;
    const g = box.querySelector('[name=grade]').value;
    const q = new URLSearchParams();
    if (s) q.set('subject', s);
    if (g && e.target.name !== 'subject') q.set('grade', g);
    location.hash = hType(type, q.toString() ? '?' + q : '');
  });

  $('footer').innerHTML = `<b class="serif" style="color:var(--ink);font-size:15px">${esc(site.siteName)}</b><br>${esc(site.tagline || '')}. Organised by subject, grade, unit and lesson.`;
  window.addEventListener('hashchange', route);
  route();
})().catch((e) => { if (e.message !== 'Signed out') document.getElementById('view').innerHTML = `<div class="alert error">${GP.esc(e.message)}</div>`; });
