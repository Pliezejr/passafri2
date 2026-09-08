'use strict';

/* Shared helpers used by every page. */

const Api = {
  async _req(method, path, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const message = (data && data.error) || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data;
  },
  get(path) { return this._req('GET', path); },
  post(path, body) { return this._req('POST', path, body || {}); },
  patch(path, body) { return this._req('PATCH', path, body || {}); },
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusLabel(status) {
  const map = {
    unverified: 'Unverified',
    business_verified: 'Business Verified',
    verified: 'Verified',
    under_review: 'Under Review',
    rejected: 'Rejected',
    suspended: 'Suspended',
  };
  return map[status] || status;
}

function levelLabel(level) {
  const map = {
    0: 'Level 0 — Unverified',
    1: 'Level 1 — Business Verified',
    2: 'Level 2 — Representative Verified',
    3: 'Level 3 — Documents Verified',
    4: 'Level 4 — Trust Profile',
  };
  return map[level] || `Level ${level}`;
}

function stars(rating) {
  const full = Math.round(rating);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function showAlert(container, message, type = 'error') {
  container.innerHTML = '';
  if (!message) return;
  container.appendChild(el('div', { class: `alert alert-${type}` }, message));
}

async function renderNav() {
  const mount = document.getElementById('nav-links');
  if (!mount) return;
  mount.innerHTML = '';
  try {
    const me = await Api.get('/api/me');
    if (!me.authenticated) {
      mount.appendChild(el('a', { href: '/directory.html' }, 'Search'));
      mount.appendChild(el('a', { href: '/login.html' }, 'Business Login'));
      mount.appendChild(el('a', { href: '/register.html', class: 'btn small' }, 'Register your business'));
    } else if (me.role === 'business') {
      mount.appendChild(el('a', { href: '/directory.html' }, 'Search'));
      mount.appendChild(el('a', { href: '/dashboard.html' }, me.businessName || 'Dashboard'));
      mount.appendChild(el('button', { class: 'linklike', onclick: doLogout }, 'Log out'));
    } else if (me.role === 'admin') {
      mount.appendChild(el('a', { href: '/directory.html' }, 'Search'));
      mount.appendChild(el('a', { href: '/admin.html' }, 'Admin panel'));
      mount.appendChild(el('button', { class: 'linklike', onclick: doLogout }, 'Log out'));
    }
  } catch (e) {
    mount.appendChild(el('a', { href: '/login.html' }, 'Business Login'));
  }
}

async function doLogout() {
  try { await Api.post('/api/logout'); } catch (e) { /* ignore */ }
  window.location.href = '/';
}

document.addEventListener('DOMContentLoaded', renderNav);
