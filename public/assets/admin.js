'use strict';
// Admin panel: content uploads, people & access, activity, books (curriculum) and settings.

(async () => {
  const $ = (id) => document.getElementById(id);
  const { api, esc, ICONS } = GP;

  const meResp = await api('/api/me');
  const me = meResp.user;
  const canImportFolder = !!meResp.site.canImportFolder;
  let cur = await api('/api/curriculum');
  GP.setSubjects(cur.subjects);
  GP.userMenu($('user'), me);
  const site = (await api('/api/admin/settings')).settings;
  $('site-name').textContent = site.siteName;
  document.title = 'Admin · ' + site.siteName;

  // ---------------------------------------------------------------- tabs
  const loaders = { content: loadContent, people: loadPeople, activity: loadActivity, books: loadBooks, settings: loadSettings };
  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    Object.keys(loaders).forEach((k) => { $('tab-' + k).hidden = k !== name; });
    history.replaceState(null, '', '#' + name);
    loaders[name]();
  }
  $('tabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) showTab(t.dataset.tab); });

  const opt = (value, label, selected) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
  const grades = () => [...new Set([1, 2, 3, 4, 5, 6, 7, 8, ...cur.lessons.map((l) => l.grade)])].filter(Boolean).sort((a, b) => a - b);

  // ================================================================ CONTENT
  let catalog = [];
  let types = [];

  async function loadContent() {
    const [c, users] = await Promise.all([api('/api/catalog'), api('/api/admin/users')]);
    catalog = c.items;
    types = c.types;
    const plays = catalog.reduce((s, i) => s + (i.plays || 0), 0);
    const size = catalog.reduce((s, i) => s + (i.size || 0), 0);
    const sorted = [...catalog].sort((a, b) => (a.subject || '').localeCompare(b.subject || '') || a.grade - b.grade || (a.strand || '').localeCompare(b.strand || '') || a.unit - b.unit || a.lesson - b.lesson);
    $('tab-content').innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">${catalog.length}</div><div class="k">Items</div></div>
        <div class="stat"><div class="v">${plays}</div><div class="k">Opens</div></div>
        <div class="stat"><div class="v">${users.users.length}</div><div class="k">People with access</div></div>
        <div class="stat"><div class="v">${GP.bytes(size)}</div><div class="k">Storage used</div></div>
      </div>
      <div class="panel">
        <div class="row" style="margin-bottom:12px"><h2 class="grow" style="margin:0">Resources</h2>
          <input class="input" id="content-filter" placeholder="Filter..." style="max-width:220px;height:36px">
          <button class="btn primary" id="new-item">${ICONS.plus} Add a resource</button></div>
        <div class="table-wrap"><table class="grid" id="content-table">
          <thead><tr><th></th><th>Title</th><th>Place in the book</th><th>Type</th><th>Status</th><th>Opens</th><th>Size</th><th>Updated</th><th></th></tr></thead>
          <tbody>${sorted.map(contentRow).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:30px">Nothing yet. Click "Add a resource" to publish a book (PDF) or a Unity WebGL build: flashcards, an interactivity, a simulation or a game.</td></tr>'}</tbody>
        </table></div>
      </div>`;
    $('new-item').addEventListener('click', () => itemDialog(null));
    $('content-filter').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#content-table tbody tr[data-id]').forEach((tr) => { tr.hidden = q && !tr.textContent.toLowerCase().includes(q); });
    });
    $('content-table').addEventListener('click', onContentAction);
  }

  function statusBadge(i) {
    if (i.status === 'ready') return i.visible ? '<span class="badge ok">Live</span>' : '<span class="badge">Hidden</span>';
    if (i.status === 'processing') return '<span class="badge brand">Processing</span>';
    if (i.status === 'error') return `<span class="badge danger" title="${esc(i.error)}">Error</span>`;
    const t = GP.typeOf(i.type);
    return `<span class="badge warn">${t === 'Book' ? 'No PDF yet' : 'No build yet'}</span>`;
  }

  function contentRow(i) {
    const thumb = i.thumbUrl ? `<img class="mini-thumb" src="${esc(i.thumbUrl)}" alt="">` : `<div class="mini-thumb" style="overflow:hidden">${GP.art(i).replace('class="art"', 'class="art" style="width:64px;height:36px;display:grid;place-items:center;color:#fff"').replace('<svg', '<svg width="18" height="18"')}</div>`;
    return `<tr data-id="${esc(i.id)}">
      <td>${thumb}</td>
      <td><b>${esc(i.title)}</b>${i.error ? `<div class="small" style="color:var(--danger)">${esc(i.error)}</div>` : ''}</td>
      <td class="small">${esc(i.subject)}<div class="muted">${esc(GP.lessonLabel(i))}</div></td>
      <td><span class="badge" style="color:${GP.typeInfo(i.type).color}">${GP.typeIcon(i.type)}${esc(GP.typeOf(i.type))}</span></td>
      <td>${statusBadge(i)}</td>
      <td>${i.plays || 0}</td>
      <td class="small">${GP.bytes(i.size)}</td>
      <td class="small muted">${GP.when(i.updatedAt)}</td>
      <td style="white-space:nowrap">
        ${i.status === 'ready' ? `<a class="btn sm" href="/play/${esc(i.id)}" target="_blank" rel="noopener">Open</a>` : ''}
        <button class="btn sm" data-act="edit">Edit</button>
        <button class="btn sm danger" data-act="delete">Delete</button>
      </td></tr>`;
  }

  async function onContentAction(e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const item = catalog.find((i) => i.id === b.closest('tr').dataset.id);
    if (b.dataset.act === 'edit') {
      itemDialog(item);
    }
    if (b.dataset.act === 'delete') {
      GP.dialog('Delete this resource?', `<p>"<b>${esc(item.title)}</b>" and its uploaded files will be removed from the portal permanently. This cannot be undone.</p>`, [
        { label: 'Cancel' },
        { label: 'Delete', kind: 'danger', onClick: async (close) => {
          try { await api('/api/admin/items/' + item.id, { method: 'DELETE' }); close(); GP.toast('Deleted.'); loadContent(); } catch (ex) { GP.toast(ex.message); }
        } },
      ]);
    }
  }

  /** Lesson options for a subject + grade, grouped by unit (book order). */
  function lessonOptions(subject, grade, selectedId) {
    const ls = cur.lessons.filter((l) => l.subject === subject && l.grade === +grade);
    const order = (s) => (s ? ['Biology', 'Chemistry', 'Physics'].indexOf(s) + 1 : 0);
    ls.sort((a, b) => order(a.strand) - order(b.strand) || a.unit - b.unit || a.lesson - b.lesson);
    let html = opt('', '- Not linked to a lesson -', !selectedId);
    let group = null;
    for (const l of ls) {
      const g = `${l.strand ? l.strand + ' · ' : ''}${l.unit === 99 ? 'Grammar' : 'Unit ' + l.unit}: ${l.unitTitle}`;
      if (g !== group) { if (group) html += '</optgroup>'; html += `<optgroup label="${esc(g)}">`; group = g; }
      html += opt(l.id, `Lesson ${l.lesson}: ${l.lessonTitle}`, l.id === selectedId);
    }
    if (group) html += '</optgroup>';
    return html + opt('__custom', 'Type unit & lesson by hand...', selectedId === '__custom');
  }

  function suggestTitle(l) {
    const s = cur.suggestions.find((x) => x.grade === l.grade && x.subject === l.subject && x.unit === l.unit && x.lesson === l.lesson && (!x.strand || x.strand === l.strand));
    return s ? s.title : '';
  }

  /** Upload / edit dialog. */
  function itemDialog(item) {
    const editing = !!item;
    const it = item || { type: 'Book', subject: 'Mathematics', grade: 1, visible: true, fit: true, tags: [] };
    const SOURCE_NOTE = { pdf: 'PDF file', build: 'Unity WebGL build' };
    const sourceOf = (t) => (t === 'Book' ? 'pdf' : 'build');
    const knownLesson = it.lessonId && cur.lessons.some((l) => l.id === it.lessonId) ? it.lessonId : (it.unit || it.lesson ? '__custom' : '');
    const d = GP.dialog(editing ? 'Edit: ' + it.title : 'Add a resource', `
      <div class="field"><span>What is it?</span><div class="type-pick">${GP.TYPES.map((t) => `<label style="--tc:${GP.TYPE_INFO[t].color}">
        <input type="radio" name="type" value="${t}" ${t === GP.typeOf(it.type) ? 'checked' : ''}><b>${GP.typeIcon(t)}${esc(t)}</b><span>${SOURCE_NOTE[sourceOf(t)]}</span></label>`).join('')}</div></div>
      <div class="form-grid">
        <label class="field">Subject<select class="input" name="subject">${cur.subjects.map((s) => opt(s.name, s.name, s.name === it.subject)).join('')}</select></label>
        <label class="field">Grade<select class="input" name="grade">${grades().map((g) => opt(g, 'Grade ' + g, g === it.grade)).join('')}</select></label>
        <label class="field">Lesson (from the book)<select class="input" name="lessonId"></select><span class="small faint" id="lesson-hint" style="font-weight:400"></span></label>
        <div class="full form-grid" id="custom-lesson" hidden style="background:var(--surface-2);padding:12px;border-radius:12px">
          <label class="field">Strand (Science 6-8)<select class="input" name="strand">${['', 'Biology', 'Chemistry', 'Physics'].map((s) => opt(s, s || 'None', s === (it.strand || ''))).join('')}</select></label>
          <label class="field">Unit number<input class="input" name="unit" type="number" min="0" value="${esc(it.unit || '')}"></label>
          <label class="field full">Unit title<input class="input" name="unitTitle" value="${esc(it.unitTitle || '')}"></label>
          <label class="field">Lesson number<input class="input" name="lesson" type="number" min="0" value="${esc(it.lesson || '')}"></label>
          <label class="field">LMS chapter name<input class="input" name="chapter" value="${esc(it.chapter || '')}"></label>
          <label class="field full">Lesson title<input class="input" name="lessonTitle" value="${esc(it.lessonTitle || '')}"></label>
        </div>
        <label class="field full">Title<input class="input" name="title" value="${esc(it.title || '')}" placeholder="e.g. Fill It Up!"></label>
        <label class="field full">Short description (optional)<textarea class="input" name="description" rows="2">${esc(it.description || '')}</textarea></label>
        <label class="field">Tags (comma separated)<input class="input" name="tags" value="${esc((it.tags || []).join(', '))}"></label>
        <label class="field">Cover image (optional)<input class="input" name="thumb" type="file" accept="image/png,image/jpeg,image/webp" style="padding-top:8px"></label>
        <label class="check"><input type="checkbox" name="visible" ${it.visible !== false ? 'checked' : ''}> Visible in the library</label>
        <label class="check" data-src="build"><input type="checkbox" name="fit" ${it.fit !== false ? 'checked' : ''}> Fit Unity builds to the window</label>
      </div>
      <div class="dropzone" id="drop-pdf" data-src="pdf">
        <div>${ICONS.bookOpen.replace('<svg', '<svg width="34" height="34"')}</div>
        <div><b>${editing && it.version ? 'Replace the PDF (optional)' : 'Add the book PDF'}</b><br><span class="small">Readers turn its pages like a real book. One PDF per book or chapter.</span></div>
        <label class="btn sm">Choose PDF<input type="file" name="pdf" accept=".pdf,application/pdf" hidden></label>
        <div class="small" id="pdf-summary"></div>
      </div>
      <div class="dropzone" id="drop" data-src="build">
        <div>${ICONS.upload.replace('<svg', '<svg width="34" height="34"')}</div>
        <div><b>${editing && it.version ? 'Replace the build (optional)' : 'Add the Unity WebGL build'}</b><br><span class="small">Choose the build folder (the one with index.html and Build), or a .zip of it. Compressed builds (.gz/.br/.unityweb) are fixed automatically.</span></div>
        <div class="row" style="flex-wrap:wrap;justify-content:center">
          <label class="btn sm">Choose folder<input type="file" name="folder" webkitdirectory multiple hidden></label>
          <label class="btn sm">Choose .zip<input type="file" name="zip" accept=".zip,application/zip" hidden></label>
          ${canImportFolder ? '<button class="btn sm" type="button" data-pc>Folder on this PC...</button>' : ''}
        </div>
        <div class="row" id="pc-path-row" hidden style="width:100%"><input class="input" name="pcPath" placeholder="e.g. D:\\Faiz Projects Grade Wise\\Grade 1\\...\\Build\\WebGL" style="height:36px"><button class="btn sm" type="button" data-pc-use>Use</button></div>
        <div class="small" id="build-summary"></div>
      </div>
      <div id="progress-wrap" hidden><div class="small muted" id="progress-text" style="margin-bottom:6px"></div><div class="progress"><div id="progress-bar"></div></div></div>
      <div class="alert error" id="form-error" hidden></div>
      ${editing && it.processLog ? `<details><summary class="small muted">Last processing log</summary><pre class="log">${esc(it.processLog.join('\n'))}</pre></details>` : ''}`, [
      { label: 'Cancel' },
      { label: editing ? 'Save' : 'Upload', kind: 'primary', onClick: (close, btn) => save(close, btn) },
    ]);
    const f = (n) => d.el.querySelector(`[name="${n}"]`);
    let build = null; // { kind: 'folder'|'zip'|'path', files|file|path }
    let pdfFile = null;
    const typeVal = () => d.el.querySelector('[name="type"]:checked').value;
    function syncSource() {
      const src = sourceOf(typeVal());
      d.el.querySelectorAll('[data-src]').forEach((el) => { el.hidden = el.dataset.src !== src; });
    }
    d.el.querySelector('.type-pick').addEventListener('change', syncSource);
    syncSource();

    const pdfSummary = d.el.querySelector('#pdf-summary');
    const pickPdf = (file) => {
      if (!file || !/\.pdf$/i.test(file.name)) return GP.toast('Choose a .pdf file.');
      pdfFile = file;
      pdfSummary.textContent = `${file.name} · ${GP.bytes(file.size)}`;
    };
    f('pdf').addEventListener('change', (e) => pickPdf(e.target.files[0]));
    const dropPdf = d.el.querySelector('#drop-pdf');
    ['dragover', 'dragenter'].forEach((ev) => dropPdf.addEventListener(ev, (e) => { e.preventDefault(); dropPdf.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => dropPdf.addEventListener(ev, () => dropPdf.classList.remove('drag')));
    dropPdf.addEventListener('drop', (e) => { e.preventDefault(); pickPdf(e.dataTransfer.files[0]); });

    function refreshLessons() {
      f('lessonId').innerHTML = lessonOptions(f('subject').value, f('grade').value, knownLessonFor());
      onLessonChange(false);
    }
    let firstRender = true;
    function knownLessonFor() {
      if (firstRender && it.subject === f('subject').value && it.grade === +f('grade').value) return knownLesson;
      return '';
    }
    function onLessonChange(userPicked) {
      const id = f('lessonId').value;
      $('custom-lesson').hidden = id !== '__custom';
      const l = cur.lessons.find((x) => x.id === id);
      d.el.querySelector('#lesson-hint').textContent = l
        ? `${l.strand ? l.strand + ' · ' : ''}${l.unit === 99 ? 'Grammar' : 'Unit ' + l.unit}: ${l.unitTitle}${l.chapter ? ' · LMS: ' + l.chapter : ''}` : '';
      if (userPicked && l && !f('title').value.trim()) f('title').value = suggestTitle(l);
      if (userPicked && l) f('title').placeholder = suggestTitle(l) || 'Title';
    }
    f('subject').addEventListener('change', () => { firstRender = false; refreshLessons(); });
    f('grade').addEventListener('change', () => { firstRender = false; refreshLessons(); });
    f('lessonId').addEventListener('change', () => onLessonChange(true));
    refreshLessons();
    firstRender = false;

    const summary = d.el.querySelector('#build-summary');
    f('folder').addEventListener('change', (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      build = { kind: 'folder', files };
      const size = files.reduce((s, x) => s + x.size, 0);
      const hasIndex = files.some((x) => /(^|\/)index\.html?$/i.test(x.webkitRelativePath));
      summary.innerHTML = `${files.length} files · ${GP.bytes(size)} ${hasIndex ? '<span class="badge ok">index.html found</span>' : '<span class="badge danger">no index.html in this folder</span>'}`;
    });
    f('zip').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      build = { kind: 'zip', file };
      summary.textContent = `${file.name} · ${GP.bytes(file.size)}`;
    });
    d.el.querySelector('[data-pc]')?.addEventListener('click', () => {
      d.el.querySelector('#pc-path-row').hidden = false;
      f('pcPath').focus();
    });
    d.el.querySelector('[data-pc-use]').addEventListener('click', () => {
      const p = f('pcPath').value.trim().replace(/^"|"$/g, '');
      if (p) { build = { kind: 'path', path: p }; summary.textContent = 'Will copy the build from: ' + p; }
    });
    const drop = d.el.querySelector('#drop');
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('drag')));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && /\.zip$/i.test(file.name)) { build = { kind: 'zip', file }; summary.textContent = `${file.name} · ${GP.bytes(file.size)}`; }
      else GP.toast('Drop a .zip here, or use "Choose folder" for a build folder.');
    });

    function meta() {
      const lessonIdVal = f('lessonId').value;
      const l = cur.lessons.find((x) => x.id === lessonIdVal);
      const base = {
        type: typeVal(), subject: f('subject').value, grade: +f('grade').value, title: f('title').value.trim() || f('title').placeholder,
        description: f('description').value, tags: f('tags').value, visible: f('visible').checked, fit: f('fit').checked,
      };
      if (l) return { ...base, strand: l.strand, unit: l.unit, unitTitle: l.unitTitle, lesson: l.lesson, lessonTitle: l.lessonTitle, chapter: l.chapter };
      if (lessonIdVal === '__custom') return { ...base, strand: f('strand').value, unit: f('unit').value, unitTitle: f('unitTitle').value, lesson: f('lesson').value, lessonTitle: f('lessonTitle').value, chapter: f('chapter').value };
      return { ...base, strand: '', unit: 0, unitTitle: '', lesson: 0, lessonTitle: '', chapter: '' };
    }

    const err = d.el.querySelector('#form-error');
    const progressWrap = d.el.querySelector('#progress-wrap');
    const progressText = d.el.querySelector('#progress-text');
    const progressBar = d.el.querySelector('#progress-bar');
    const setProgress = (text, frac) => { progressWrap.hidden = false; progressText.textContent = text; progressBar.style.width = Math.round(frac * 100) + '%'; };

    async function save(close, btn) {
      err.hidden = true;
      const m = meta();
      const fail = (msg) => { err.textContent = msg; err.hidden = false; };
      if (!m.title || m.title === 'Title') return fail('Please give it a title.');
      const src = sourceOf(m.type);
      const hasFiles = editing && it.version && sourceOf(GP.typeOf(it.type)) === src;
      if (src === 'pdf' && !pdfFile && !hasFiles) return fail('Choose the PDF for this book.');
      if (src === 'build' && !build && !hasFiles) return fail('Add the build: choose the build folder or a .zip.');
      btn.disabled = true;
      try {
        let saved = editing ? (await api('/api/admin/items/' + it.id, { method: 'PATCH', body: m })).item : (await api('/api/admin/items', { method: 'POST', body: m })).item;
        const thumb = f('thumb').files[0];
        if (thumb) saved = (await api(`/api/admin/items/${saved.id}/thumbnail`, { method: 'PUT', raw: thumb })).item;
        if (src === 'pdf' && pdfFile) await uploadPdf(saved.id);
        if (src === 'build' && build) await uploadBuild(saved.id);
        close();
        GP.toast(editing ? 'Saved.' : 'Published! It is live in the library.');
        loadContent();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        loadContent();
      }
      btn.disabled = false;
    }

    async function uploadPdf(id) {
      const uploadId = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('');
      await api(`/api/admin/items/${id}/files?upload=${uploadId}&path=book.pdf`, { method: 'PUT', raw: pdfFile,
        onProgress: (a, t) => setProgress(`Uploading ${pdfFile.name}: ${GP.bytes(a)} of ${GP.bytes(t)}`, a / t * 0.95) });
      setProgress('Saving the book...', 0.97);
      await api(`/api/admin/items/${id}/finalize`, { method: 'POST', body: { upload: uploadId } });
      setProgress('Done', 1);
    }

    async function uploadBuild(id) {
      const uploadId = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('');
      if (build.kind === 'path') {
        setProgress('Copying and processing the build on the server...', 0.5);
        await api(`/api/admin/items/${id}/import-folder`, { method: 'POST', body: { path: build.path } });
        setProgress('Done', 1);
        return;
      }
      if (build.kind === 'zip') {
        await api(`/api/admin/items/${id}/zip?upload=${uploadId}`, { method: 'PUT', raw: build.file,
          onProgress: (a, t) => setProgress(`Uploading ${build.file.name}: ${GP.bytes(a)} of ${GP.bytes(t)}`, a / t * 0.9) });
      } else {
        // drop the selected folder's own name so paths start at its contents
        const files = build.files.filter((x) => !/(^|\/)(\.git|\.DS_Store|Thumbs\.db)/.test(x.webkitRelativePath));
        const total = files.reduce((s, x) => s + x.size, 0) || 1;
        const done = new Map();
        const report = () => {
          const sent = [...done.values()].reduce((s, v) => s + v, 0);
          setProgress(`Uploading ${files.length} files: ${GP.bytes(sent)} of ${GP.bytes(total)}`, sent / total * 0.9);
        };
        let next = 0;
        const worker = async () => {
          while (next < files.length) {
            const file = files[next++];
            const rel = file.webkitRelativePath.split('/').slice(1).join('/') || file.name;
            await api(`/api/admin/items/${id}/files?upload=${uploadId}&path=${encodeURIComponent(rel)}`, { method: 'PUT', raw: file,
              onProgress: (a) => { done.set(file, a); report(); } });
            done.set(file, file.size);
            report();
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
      }
      setProgress('Processing the build (decompressing, fixing, optimising)...', 0.95);
      await api(`/api/admin/items/${id}/finalize`, { method: 'POST', body: { upload: uploadId } });
      setProgress('Done', 1);
    }
  }

  // ================================================================ PEOPLE
  async function loadPeople() {
    const { users } = await api('/api/admin/users');
    const scopeText = (s) => {
      const parts = [];
      if (s?.subjects?.length) parts.push(s.subjects.join(', '));
      if (s?.grades?.length) parts.push((s.grades.length > 1 ? 'Grades ' : 'Grade ') + s.grades.join(', '));
      return parts.join(' · ') || 'Everything';
    };
    $('tab-people').innerHTML = `
      <div class="panel">
        <div class="row" style="margin-bottom:12px"><h2 class="grow" style="margin:0">People with access</h2><button class="btn primary" id="add-user">${ICONS.plus} Add person</button></div>
        <p class="small muted" style="margin-top:0">Each person gets their own username and password. Share the website link with them, then their login. You can limit someone to certain grades or subjects, reset their password, sign them out, or disable them at any time.</p>
        <div class="table-wrap"><table class="grid" id="user-table">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Can see</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>${users.map((u) => `<tr data-id="${esc(u.id)}">
            <td><b>${esc(u.displayName)}</b>${u.id === me.id ? ' <span class="badge brand">You</span>' : ''}</td>
            <td>@${esc(u.username)}</td>
            <td>${u.role === 'admin' ? '<span class="badge brand">Admin</span>' : '<span class="badge">Viewer</span>'}</td>
            <td class="small">${u.role === 'admin' ? 'Everything' : esc(scopeText(u.scope))}</td>
            <td>${u.disabled ? '<span class="badge danger">Disabled</span>' : '<span class="badge ok">Active</span>'}${u.activeSessions ? ` <span class="small muted">${u.activeSessions} device${u.activeSessions > 1 ? 's' : ''}</span>` : ''}</td>
            <td class="small muted">${GP.when(u.lastLoginAt)}</td>
            <td style="white-space:nowrap">
              <button class="btn sm" data-act="edit">Edit</button>
              <button class="btn sm" data-act="password">Reset password</button>
              ${u.id !== me.id ? `<button class="btn sm" data-act="signout">Sign out</button><button class="btn sm danger" data-act="delete">Remove</button>` : ''}
            </td></tr>`).join('')}</tbody></table></div>
      </div>`;
    $('add-user').addEventListener('click', () => userDialog(null));
    $('user-table').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const u = users.find((x) => x.id === b.closest('tr').dataset.id);
      if (b.dataset.act === 'edit') userDialog(u);
      if (b.dataset.act === 'password') passwordDialog(u);
      if (b.dataset.act === 'signout') {
        await api(`/api/admin/users/${u.id}/signout`, { method: 'POST' });
        GP.toast(`${u.displayName} was signed out on all devices.`);
        loadPeople();
      }
      if (b.dataset.act === 'delete') {
        GP.dialog('Remove this person?', `<p><b>${esc(u.displayName)}</b> (@${esc(u.username)}) will lose access immediately. You can add them again later.</p>`, [
          { label: 'Cancel' },
          { label: 'Remove', kind: 'danger', onClick: async (close) => {
            try { await api('/api/admin/users/' + u.id, { method: 'DELETE' }); close(); GP.toast('Removed.'); loadPeople(); } catch (ex) { GP.toast(ex.message); }
          } },
        ]);
      }
    });
  }

  function makePassword() {
    // readable, no look-alike characters (0/O, 1/l/I)
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const pick = () => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length];
    return Array.from({ length: 3 }, () => Array.from({ length: 4 }, pick).join('')).join('-');
  }

  function scopeFields(scope) {
    const s = scope || { grades: [], subjects: [] };
    return `<div class="full"><div class="small muted" style="margin-bottom:6px;font-weight:600">Can see (leave all unticked = everything)</div>
      <div class="row" style="flex-wrap:wrap;gap:6px 14px;margin-bottom:8px">${cur.subjects.map((x) => `<label class="check"><input type="checkbox" name="scope-subject" value="${esc(x.name)}" ${s.subjects?.includes(x.name) ? 'checked' : ''}>${esc(x.name)}</label>`).join('')}</div>
      <div class="row" style="flex-wrap:wrap;gap:6px 14px">${grades().map((g) => `<label class="check"><input type="checkbox" name="scope-grade" value="${g}" ${s.grades?.includes(g) ? 'checked' : ''}>Grade ${g}</label>`).join('')}</div></div>`;
  }
  const readScope = (el) => ({
    subjects: [...el.querySelectorAll('[name=scope-subject]:checked')].map((x) => x.value),
    grades: [...el.querySelectorAll('[name=scope-grade]:checked')].map((x) => +x.value),
  });

  function userDialog(u) {
    const editing = !!u;
    const d = GP.dialog(editing ? 'Edit ' + u.displayName : 'Add a person', `
      <div class="form-grid">
        <label class="field">Name<input class="input" name="displayName" value="${esc(u?.displayName || '')}" placeholder="e.g. Neha Chauhan"></label>
        <label class="field">Login (email or username)<input class="input" name="username" value="${esc(u?.username || '')}" ${editing ? 'disabled' : ''} autocapitalize="none" spellcheck="false" placeholder="e.g. neha@k12onlineschools.com"></label>
        ${editing ? '' : `<label class="field full">Password<div class="row"><input class="input" name="password" value="${makePassword()}" autocomplete="off" spellcheck="false"><button class="btn sm" type="button" data-gen>New</button></div>
          <span class="small faint" style="font-weight:400">Copy this and send it to them privately. They can change it after signing in.</span></label>`}
        <label class="field">Role<select class="input" name="role">${opt('viewer', 'Viewer (can play)', u?.role !== 'admin')}${opt('admin', 'Admin (full control)', u?.role === 'admin')}</select></label>
        ${editing ? `<label class="check" style="align-self:end"><input type="checkbox" name="disabled" ${u.disabled ? 'checked' : ''} ${u.id === me.id ? 'disabled' : ''}> Disabled (cannot sign in)</label>` : '<div></div>'}
        ${scopeFields(u?.scope)}
      </div>
      <div class="alert error" hidden></div>`, [
      { label: 'Cancel' },
      { label: editing ? 'Save' : 'Add person', kind: 'primary', onClick: async (close, btn) => {
        const f = (n) => d.el.querySelector(`[name=${n}]`);
        const err = d.el.querySelector('.alert');
        err.hidden = true;
        btn.disabled = true;
        try {
          if (editing) {
            await api('/api/admin/users/' + u.id, { method: 'PATCH', body: { displayName: f('displayName').value, role: f('role').value, disabled: f('disabled').checked, scope: readScope(d.el) } });
            GP.toast('Saved.');
          } else {
            const body = { displayName: f('displayName').value, username: f('username').value, password: f('password').value, role: f('role').value, scope: readScope(d.el) };
            await api('/api/admin/users', { method: 'POST', body });
            close();
            GP.dialog('Person added', `<p>Send these to <b>${esc(body.displayName || body.username)}</b>:</p>
              <pre class="log" style="font-size:14px">Website:  ${esc(location.origin)}\nUsername: ${esc(body.username.trim().toLowerCase())}\nPassword: ${esc(body.password)}</pre>`, [{ label: 'Done', kind: 'primary' }]);
            loadPeople();
            return;
          }
          close();
          loadPeople();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
        btn.disabled = false;
      } },
    ]);
    d.el.querySelector('[data-gen]')?.addEventListener('click', () => { d.el.querySelector('[name=password]').value = makePassword(); });
  }

  function passwordDialog(u) {
    const d = GP.dialog('Reset password for ' + u.displayName, `
      <label class="field">New password<div class="row"><input class="input" name="password" value="${makePassword()}" autocomplete="off" spellcheck="false"><button class="btn sm" type="button" data-gen>New</button></div></label>
      <p class="small muted" style="margin:0">They will be signed out everywhere and must use the new password.</p>
      <div class="alert error" hidden></div>`, [
      { label: 'Cancel' },
      { label: 'Set password', kind: 'primary', onClick: async (close) => {
        const pw = d.el.querySelector('[name=password]').value;
        try {
          await api('/api/admin/users/' + u.id, { method: 'PATCH', body: { password: pw } });
          close();
          GP.dialog('Password changed', `<p>New password for <b>${esc(u.displayName)}</b> (@${esc(u.username)}):</p><pre class="log" style="font-size:14px">${esc(pw)}</pre>`, [{ label: 'Done', kind: 'primary' }]);
        } catch (ex) { const e = d.el.querySelector('.alert'); e.textContent = ex.message; e.hidden = false; }
      } },
    ]);
    d.el.querySelector('[data-gen]').addEventListener('click', () => { d.el.querySelector('[name=password]').value = makePassword(); });
  }

  // ================================================================ ACTIVITY
  const ACTION_TEXT = {
    login: 'signed in', logout: 'signed out', play: 'played', upload: 'uploaded a build of', setup: 'set up the portal',
    'item-created': 'added', 'item-deleted': 'deleted', 'user-created': 'added person', 'user-updated': 'changed person',
    'user-deleted': 'removed person', 'user-signed-out': 'signed out person', 'password-changed': 'changed their password',
    'settings-changed': 'changed settings', 'lesson-added': 'added a lesson',
  };
  async function loadActivity() {
    const { entries } = await api('/api/admin/activity?limit=500');
    const plays = entries.filter((e) => e.action === 'play');
    const top = Object.entries(plays.reduce((m, e) => { m[e.title] = (m[e.title] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
    $('tab-activity').innerHTML = `
      ${top.length ? `<div class="panel"><h2>Most played (recent)</h2>${top.map(([t, n]) => `<div class="row" style="padding:4px 0"><span class="grow">${esc(t)}</span><b>${n}</b></div>`).join('')}</div>` : ''}
      <div class="panel"><div class="row" style="margin-bottom:12px"><h2 class="grow" style="margin:0">Recent activity</h2><input class="input" id="act-filter" placeholder="Filter by name, game..." style="max-width:240px;height:36px"></div>
      <div class="table-wrap"><table class="grid" id="act-table"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
      ${entries.map((e) => `<tr><td class="small muted" title="${esc(new Date(e.t).toLocaleString())}">${esc(new Date(e.t).toLocaleString())}</td>
        <td>${e.user ? '@' + esc(e.user) : '<span class="faint">-</span>'}</td>
        <td>${esc(ACTION_TEXT[e.action] || e.action)} ${e.title ? `<b>${esc(e.title)}</b>` : ''}${e.target ? ` <b>@${esc(e.target)}</b>` : ''}${e.ip ? ` <span class="small faint">from ${esc(e.ip)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No activity yet.</td></tr>'}
      </tbody></table></div></div>`;
    $('act-filter').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#act-table tbody tr').forEach((tr) => { tr.hidden = q && !tr.textContent.toLowerCase().includes(q); });
    });
  }

  // ================================================================ BOOKS
  async function loadBooks() {
    cur = await api('/api/curriculum');
    const { items } = await api('/api/catalog');
    const subjects = cur.subjects.map((s) => s.name);
    const state = loadBooks.state || (loadBooks.state = { subject: 'Mathematics', grade: 1 });
    const ls = cur.lessons.filter((l) => l.subject === state.subject && l.grade === state.grade);
    const order = (s) => (s ? ['Biology', 'Chemistry', 'Physics'].indexOf(s) + 1 : 0);
    ls.sort((a, b) => order(a.strand) - order(b.strand) || a.unit - b.unit || a.lesson - b.lesson);
    const covered = ls.filter((l) => items.some((i) => i.lessonId === l.id)).length;
    let group = null;
    const rows = ls.map((l) => {
      const g = `${l.strand ? l.strand + ' · ' : ''}${l.unit === 99 ? 'Grammar' : 'Unit ' + l.unit}: ${l.unitTitle}`;
      const head = g !== group ? `<tr><td colspan="4" style="background:var(--surface-2);font-weight:700">${esc(g)}</td></tr>` : '';
      group = g;
      const its = items.filter((i) => i.lessonId === l.id);
      return head + `<tr><td style="width:90px">Lesson ${l.lesson}</td><td><b>${esc(l.lessonTitle)}</b><div class="small muted">${esc(l.chapter || '')}</div></td>
        <td>${its.map((i) => `<span class="badge ${i.status === 'ready' ? 'ok' : 'warn'}">${esc(i.title)}</span>`).join(' ') || '<span class="faint small">none</span>'}</td>
        <td style="text-align:right">${l.custom ? `<button class="btn sm danger" data-del="${esc(l.id)}">Remove</button>` : ''}</td></tr>`;
    }).join('');
    $('tab-books').innerHTML = `
      <div class="panel">
        <div class="row" style="flex-wrap:wrap;margin-bottom:10px">
          <h2 class="grow" style="margin:0">Books</h2>
          <select class="input" id="book-subject" style="width:auto;height:36px">${subjects.map((s) => opt(s, s, s === state.subject)).join('')}</select>
          <select class="input" id="book-grade" style="width:auto;height:36px">${grades().map((g) => opt(g, 'Grade ' + g, g === state.grade)).join('')}</select>
          <button class="btn sm primary" id="add-lesson">${ICONS.plus} Add lesson</button>
        </div>
        <p class="small muted" style="margin-top:0">${ls.length} lessons · ${covered} with content. Seeded from your Google Sheets (${esc(cur.source || '')}).</p>
        <div class="table-wrap"><table class="grid" id="book-table"><tbody>${rows || '<tr><td class="muted">No lessons for this book yet. Use "Add lesson" to build it.</td></tr>'}</tbody></table></div>
      </div>`;
    $('book-subject').addEventListener('change', (e) => { state.subject = e.target.value; loadBooks(); });
    $('book-grade').addEventListener('change', (e) => { state.grade = +e.target.value; loadBooks(); });
    $('add-lesson').addEventListener('click', () => lessonDialog(state));
    $('book-table').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      try { await api('/api/admin/lessons/' + b.dataset.del, { method: 'DELETE' }); loadBooks(); } catch (ex) { GP.toast(ex.message); }
    });
  }

  function lessonDialog(state) {
    const d = GP.dialog('Add a lesson', `
      <p class="small muted" style="margin:0">Use this for books that are not in the sheets yet (e.g. English, Global Perspectives) or missing lessons. Type a new subject name to start a new book.</p>
      <div class="form-grid">
        <label class="field">Subject<input class="input" name="subject" list="subject-list" value="${esc(state.subject)}"><datalist id="subject-list">${cur.subjects.map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist></label>
        <label class="field">Grade<input class="input" name="grade" type="number" min="1" max="12" value="${state.grade}"></label>
        <label class="field">Strand (optional)<select class="input" name="strand">${['', 'Biology', 'Chemistry', 'Physics'].map((s) => opt(s, s || 'None')).join('')}</select></label>
        <label class="field">Unit number<input class="input" name="unit" type="number" min="1"></label>
        <label class="field full">Unit title<input class="input" name="unitTitle"></label>
        <label class="field">Lesson number<input class="input" name="lesson" type="number" min="1"></label>
        <label class="field">LMS chapter name<input class="input" name="chapter"></label>
        <label class="field full">Lesson title<input class="input" name="lessonTitle"></label>
      </div><div class="alert error" hidden></div>`, [
      { label: 'Cancel' },
      { label: 'Add lesson', kind: 'primary', onClick: async (close) => {
        const body = Object.fromEntries(['subject', 'grade', 'strand', 'unit', 'unitTitle', 'lesson', 'lessonTitle', 'chapter'].map((n) => [n, d.el.querySelector(`[name=${n}]`).value]));
        try {
          await api('/api/admin/lessons', { method: 'POST', body });
          close();
          state.subject = body.subject; state.grade = +body.grade;
          loadBooks();
        } catch (ex) { const e = d.el.querySelector('.alert'); e.textContent = ex.message; e.hidden = false; }
      } },
    ]);
  }

  // ================================================================ SETTINGS
  async function loadSettings() {
    const s = (await api('/api/admin/settings')).settings;
    $('tab-settings').innerHTML = `
      <div class="panel" style="max-width:680px">
        <h2>Website</h2>
        <div class="form-grid">
          <label class="field">Website name<input class="input" name="siteName" value="${esc(s.siteName)}"></label>
          <label class="field">Stay signed in for (days)<input class="input" name="sessionDays" type="number" min="1" max="90" value="${esc(s.sessionDays)}"></label>
          <label class="field full">Tagline (shown on the sign-in page)<input class="input" name="tagline" value="${esc(s.tagline || '')}"></label>
        </div>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="save-settings">Save</button><span class="small muted" id="settings-msg"></span></div>
      </div>
      <div class="panel" style="max-width:680px">
        <h2>Your admin account</h2>
        <p class="small muted" style="margin-top:0">Signed in as <b>@${esc(me.username)}</b>. Changing your password signs out your other devices.</p>
        <button class="btn" id="my-password">Change my password</button>
      </div>
      <div class="panel" style="max-width:680px">
        <h2>Sharing the website</h2>
        <p class="small muted" style="margin:0">Give people the website address and their own login from the People tab. Nobody can see anything without signing in, and every game file is protected too.</p>
        <pre class="log" style="margin-top:10px">This address: ${esc(location.origin)}</pre>
      </div>`;
    $('save-settings').addEventListener('click', async () => {
      const body = Object.fromEntries(['siteName', 'tagline', 'sessionDays'].map((n) => [n, $('tab-settings').querySelector(`[name=${n}]`).value]));
      try {
        const r = await api('/api/admin/settings', { method: 'PATCH', body });
        $('settings-msg').textContent = 'Saved.';
        $('site-name').textContent = r.settings.siteName;
      } catch (ex) { $('settings-msg').textContent = ex.message; }
    });
    $('my-password').addEventListener('click', GP.changePassword);
  }

  showTab(loaders[location.hash.slice(1)] ? location.hash.slice(1) : 'content');
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (loaders[t]) showTab(t); });
})().catch((e) => { if (e.message !== 'Signed out') document.querySelector('main').insertAdjacentHTML('afterbegin', `<div class="alert error">${GP.esc(e.message)}</div>`); });
