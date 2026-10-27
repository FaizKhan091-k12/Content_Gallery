'use strict';
// Applies the reader's light/dark choice before the page is drawn (light unless they picked dark).
(function () {
  let theme = 'light';
  try { theme = localStorage.getItem('gp-theme') === 'dark' ? 'dark' : 'light'; } catch { /* storage blocked */ }
  document.documentElement.dataset.theme = theme;
})();
