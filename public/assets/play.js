'use strict';
(async () => {
  const $ = (id) => document.getElementById(id);
  const { ICONS } = GP;
  $('back').innerHTML = ICONS.back + '<span>Library</span>';
  $('reload').innerHTML = ICONS.reload;
  $('full').innerHTML = ICONS.full;

  const id = location.pathname.split('/').pop();
  try {
    const [{ item }, cur] = await Promise.all([GP.api('/api/items/' + encodeURIComponent(id)), GP.api('/api/curriculum')]);
    GP.setSubjects(cur.subjects);
    if (!item.playUrl) throw new Error('This item has no build uploaded yet.');
    document.title = item.title;
    $('title').textContent = item.title;
    const crumb = [item.subject, item.grade ? `Grade ${item.grade}` : '', item.strand,
      item.unit === 99 ? 'Grammar' : item.unit ? `Unit ${item.unit}${item.unitTitle ? ': ' + item.unitTitle : ''}` : '',
      item.lesson ? `Lesson ${item.lesson}${item.lessonTitle ? ': ' + item.lessonTitle : ''}` : ''].filter(Boolean).join('  ›  ');
    $('crumb').textContent = crumb;
    if (document.referrer && new URL(document.referrer).origin === location.origin && new URL(document.referrer).pathname === '/') {
      $('back').href = document.referrer; // keep the library filters
    }

    const frame = $('frame');
    frame.addEventListener('load', () => { $('loading').hidden = true; frame.focus(); });
    frame.src = item.playUrl;
    $('reload').addEventListener('click', () => { $('loading').hidden = false; frame.src = item.playUrl; });
    $('full').addEventListener('click', () => {
      const el = $('player');
      if (document.fullscreenElement) document.exitFullscreen();
      else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    });
    GP.api(`/api/items/${encodeURIComponent(id)}/play`, { method: 'POST' }).catch(() => {});
  } catch (e) {
    if (e.message === 'Signed out') return;
    $('title').textContent = 'Cannot open this item';
    $('loading').textContent = e.message;
  }
})();
