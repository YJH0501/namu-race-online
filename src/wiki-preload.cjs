'use strict';

const { ipcRenderer } = require('electron');

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
}, true);
