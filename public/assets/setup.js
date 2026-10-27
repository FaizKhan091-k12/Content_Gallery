'use strict';
(async () => {
  const form = document.getElementById('setup');
  const err = document.getElementById('error');
  let needsCode = false;
  try {
    const site = await GP.api('/api/site');
    needsCode = site.setupNeedsCode;
    if (site.adminUsername) { // the host fixed who the admin is
      form.username.value = site.adminUsername;
      form.username.readOnly = true;
    }
  } catch { /* show the form anyway */ }
  document.getElementById('code-field').hidden = !needsCode;
  (needsCode ? form.setupCode : form.displayName).focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (form.password.value !== form.again.value) {
      err.textContent = 'The passwords do not match.';
      err.hidden = false;
      return;
    }
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await GP.api('/api/setup', { method: 'POST', body: {
        setupCode: needsCode ? form.setupCode.value.trim() : undefined,
        siteName: form.siteName.value, displayName: form.displayName.value, username: form.username.value, password: form.password.value,
      } });
      location.href = '/admin';
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
    btn.disabled = false;
  });
})();
