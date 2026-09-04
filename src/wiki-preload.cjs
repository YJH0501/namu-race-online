'use strict';

const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    form[action*="/Search" i],
    input[type="search"],
    input[placeholder*="검색"],
    button[aria-label*="검색"] { display: none !important; }
  `;
  document.documentElement.append(style);
});

function isSamePageAnchor(href) {
  try {
    const current = new URL(window.location.href);
    const next = new URL(href, current);
    return next.origin === current.origin && next.pathname === current.pathname && next.search === current.search && Boolean(next.hash);
  } catch {
    return false;
  }
}

window.addEventListener('click', (event) => {
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!anchor || isSamePageAnchor(anchor.href)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  ipcRenderer.send('wiki-link-clicked-from-page', anchor.href);
}, true);

window.addEventListener('submit', (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  ipcRenderer.send('wiki-search-blocked-from-page');
}, true);

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send('wiki-search-blocked-from-page');
  }
}, true);
