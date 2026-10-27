'use strict';
(async () => {
  try {
    const site = await GP.api('/api/site');
    document.getElementById('site-name').textContent = site.siteName;
    document.getElementById('tagline').textContent = site.tagline || 'Sign in to play';
    document.title = 'Sign in · ' + site.siteName;
  } catch { /* keep defaults */ }

  const form = document.getElementById('login');
  const err = document.getElementById('error');
  form.username.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await GP.api('/api/login', { method: 'POST', body: { username: form.username.value, password: form.password.value } });
      const next = new URLSearchParams(location.search).get('next');
      // only same-site paths, never an absolute URL
      location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      form.password.select();
    }
    btn.disabled = false;
  });
})();
