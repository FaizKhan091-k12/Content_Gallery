'use strict';
// One resource, full screen: books as a page-turning flipbook, everything else (Unity WebGL builds) in a frame.

(async () => {
  const $ = (id) => document.getElementById(id);
  const { ICONS, esc } = GP;
  $('back').innerHTML = ICONS.back + '<span>Library</span>';
  $('reload').innerHTML = ICONS.reload;
  $('full').innerHTML = ICONS.full;
  const stage = $('stage');
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  const id = decodeURIComponent(location.pathname.split('/').pop());
  try {
    const [{ item }, cur] = await Promise.all([GP.api('/api/items/' + encodeURIComponent(id)), GP.api('/api/curriculum')]);
    GP.setSubjects(cur.subjects);
    const type = GP.typeOf(item.type);
    document.title = item.title;
    $('title').textContent = item.title;
    $('crumb').textContent = [type, item.subject, item.grade ? `Grade ${item.grade}` : '', item.strand,
      item.unit === 99 ? 'Grammar' : item.unit ? `Unit ${item.unit}${item.unitTitle ? ': ' + item.unitTitle : ''}` : '',
      item.lesson ? `Lesson ${item.lesson}${item.lessonTitle ? ': ' + item.lessonTitle : ''}` : ''].filter(Boolean).join('  ›  ');
    // back to where the user came from, or to the lesson the resource belongs to
    const ref = document.referrer ? new URL(document.referrer) : null;
    if (ref && ref.origin === location.origin && ref.pathname === '/') $('back').href = document.referrer;
    else if (item.lessonId && cur.lessons.some((l) => l.id === item.lessonId)) $('back').href = '/#/l/' + encodeURIComponent(item.lessonId);

    $('full').addEventListener('click', () => {
      const el = $('player');
      if (document.fullscreenElement) document.exitFullscreen();
      else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    });

    if (!item.playUrl) throw new Error('This resource has not been uploaded yet.');
    else if (type === 'Book') await openBook(item);
    else openFrame(item);
    GP.api(`/api/items/${encodeURIComponent(id)}/play`, { method: 'POST' }).catch(() => {});
  } catch (e) {
    if (e.message === 'Signed out') return;
    $('title').textContent = 'Cannot open this resource';
    stage.innerHTML = `<div class="loading" style="inset:0">${esc(e.message)}</div>`;
  }

  // ================================================================ WebGL builds (flashcards, interactivities, simulations, games)
  function openFrame(item) {
    stage.innerHTML = '<iframe id="frame" title="Resource" allow="fullscreen; autoplay; gamepad" allowfullscreen></iframe><div class="loading" id="loading" style="inset:0">Loading...</div>';
    const frame = $('frame');
    frame.addEventListener('load', () => { $('loading').hidden = true; frame.focus(); });
    frame.src = item.playUrl;
    $('reload').hidden = false;
    $('reload').addEventListener('click', () => { $('loading').hidden = false; frame.src = item.playUrl; });
  }

  // ================================================================ books (PDF flipbook)
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the book reader.'));
      document.head.appendChild(s);
    });
  }

  async function openBook(item) {
    stage.innerHTML = `<div class="reader">
      <div class="flip-stage" id="fs"><div class="cover-hint" id="hint" hidden>Drag the corner, or click, to open the book</div></div>
      <div class="reader-bar" id="rbar" hidden>
        <button class="btn icon" id="prev" title="Previous page (←)">${ICONS.left}</button>
        <span>Page <input id="pg" inputmode="numeric" aria-label="Page number"> of <span id="pn"></span></span>
        <input class="range" id="range" type="range" min="1" value="1" aria-label="Go to page">
        <button class="btn icon" id="next" title="Next page (→)">${ICONS.right}</button>
        <button class="btn sm" id="resume" hidden></button>
      </div>
      <div class="msg" id="msg"><div>Opening the book...<div class="bar"><i id="mbar"></i></div></div></div></div>`;

    await Promise.all([loadScript('/assets/vendor/pdfjs/pdf.min.js'), loadScript('/assets/vendor/pageflip/page-flip.browser.js')]);
    const pdfjs = window.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdfjs/pdf.worker.min.js';
    const task = pdfjs.getDocument({ url: item.playUrl, isEvalSupported: false });
    task.onProgress = ({ loaded, total }) => { if (total) $('mbar').style.width = Math.round(loaded / total * 100) + '%'; };
    const pdf = await task.promise;
    const N = pdf.numPages;
    const firstView = (await pdf.getPage(1)).getViewport({ scale: 1 });
    const aspect = firstView.width / firstView.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const renderHeight = Math.min(2000, Math.max(900, Math.round(screen.height * dpr)));

    // ---- page images: rendered on demand around the open pages, kept as small JPEG blobs
    const cache = new Map();
    function pageUrl(n) {
      if (n < 1 || n > N) return Promise.resolve(null);
      if (!cache.has(n)) cache.set(n, renderPage(n).catch(() => null));
      return cache.get(n);
    }
    async function renderPage(n) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: renderHeight / base.height });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
      return URL.createObjectURL(blob);
    }

    // ---- one element per page; StPageFlip curls them from the corner under the mouse or finger
    const pageEls = Array.from({ length: N }, (_, k) => {
      const el = document.createElement('div');
      el.className = 'bk-page';
      if (k === 0 || (k === N - 1 && N % 2 === 0)) el.dataset.density = 'hard'; // the covers turn as stiff boards
      el.innerHTML = `<img alt="Page ${k + 1}" draggable="false"><span class="bk-num">${k + 1}</span>`;
      return el;
    });
    function fill(from, to) {
      for (let n = Math.max(1, from); n <= Math.min(N, to); n++) {
        const img = pageEls[n - 1].querySelector('img');
        if (img.getAttribute('src')) continue;
        pageUrl(n).then((url) => { if (url) { img.src = url; pageEls[n - 1].classList.add('ready'); } });
      }
      // keep memory bounded on long books: forget pages far from the open spread
      for (const [n, p] of cache) {
        if (n >= from - 20 && n <= to + 20) continue;
        cache.delete(n);
        const img = pageEls[n - 1].querySelector('img');
        img.removeAttribute('src');
        pageEls[n - 1].classList.remove('ready');
        p.then((u) => u && URL.revokeObjectURL(u));
      }
    }

    const fs = $('fs');
    let book = null;
    let current = 0; // index of the first visible page
    const saved = store.get('gp-book-' + item.id);

    /** (Re)builds the book to fit the screen: a two-page spread when there is room, one page on phones. */
    function build(startAt) {
      if (book) { book.destroy(); book = null; }
      fs.querySelectorAll(".bk").forEach((el) => el.remove());
      const holder = document.createElement('div');
      holder.className = 'bk';
      fs.prepend(holder);
      const W = fs.clientWidth - 40;
      const H = fs.clientHeight - 30;
      const spread = W / H > aspect * 1.25 && W >= 560;
      let pageH = H;
      let pageW = pageH * aspect;
      if ((spread ? 2 * pageW : pageW) > W) { pageW = spread ? W / 2 : W; pageH = pageW / aspect; }
      pageW = Math.floor(pageW);
      pageH = Math.floor(pageH);
      holder.style.width = (spread ? 2 * pageW : pageW) + 'px';
      book = new window.St.PageFlip(holder, {
        width: pageW, height: pageH, size: 'fixed',
        // a single page is used when the holder is narrower than two minimum-width pages
        minWidth: spread ? 100 : pageW + 1, usePortrait: true,
        showCover: true, drawShadow: true, maxShadowOpacity: 0.55, flippingTime: 900,
        showPageCorners: true, mobileScrollSupport: false, swipeDistance: 25, startPage: startAt,
        autoSize: false,
      });
      book.loadFromHTML(pageEls);
      book.on('flip', (e) => { current = e.data; update(); });
      book.on('changeState', (e) => fs.classList.toggle('turning', e.data !== 'read'));
      current = book.getCurrentPageIndex();
      update();
    }

    function visible() {
      if (!book) return [1];
      const n = current + 1;
      if (book.getOrientation() === 'portrait' || n === 1) return [n];
      return [n, n + 1].filter((x) => x <= N);
    }
    function update() {
      const v = visible();
      $('pg').value = v.join('-');
      $('range').value = v[0];
      $('prev').disabled = v[0] <= 1;
      $('next').disabled = v[v.length - 1] >= N;
      $('hint').hidden = v[0] !== 1;
      // a closed book sits in the middle of the screen, like one lying on a desk
      const holder = fs.querySelector('.bk');
      const spread = book && book.getOrientation() !== 'portrait';
      const closedBack = spread && current === N - 1 && N % 2 === 0;
      if (holder) holder.style.transform = spread && current === 0 ? 'translateX(-25%)' : closedBack ? 'translateX(25%)' : '';
      fill(v[0] - 2, v[v.length - 1] + 5);
      store.set('gp-book-' + item.id, v[0]);
    }
    const go = (n) => { if (book) book.turnToPage(Math.max(0, Math.min(N - 1, n - 1))); current = book.getCurrentPageIndex(); update(); };

    // ---- controls
    $('pn').textContent = N;
    $('range').max = N;
    $('next').addEventListener('click', () => book && book.flipNext());
    $('prev').addEventListener('click', () => book && book.flipPrev());
    $('range').addEventListener('change', (e) => go(+e.target.value));
    $('pg').addEventListener('change', (e) => { const n = parseInt(e.target.value, 10); if (n) go(n); });
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || !book) return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); book.flipNext(); }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); book.flipPrev(); }
      if (e.key === 'Home') go(1);
      if (e.key === 'End') go(N);
    });
    let resizeTimer;
    let lastSize = `${fs.clientWidth}x${fs.clientHeight}`;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const size = `${fs.clientWidth}x${fs.clientHeight}`;
        if (size !== lastSize) { lastSize = size; build(current); }
      }, 150);
    });
    if (saved > 2 && saved <= N) {
      $('resume').hidden = false;
      $('resume').textContent = `Continue from page ${saved}`;
      $('resume').addEventListener('click', () => { $('resume').hidden = true; go(saved); });
    }

    await Promise.all([pageUrl(1), pageUrl(2), pageUrl(3)]);
    $('msg').remove();
    $('rbar').hidden = false;
    build(0);
    const bk = fs.querySelector('.bk');
    bk.classList.add('enter');
    bk.addEventListener('animationend', () => bk.classList.remove('enter'), { once: true });
  }
})();
