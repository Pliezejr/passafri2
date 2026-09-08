'use strict';
/* global Api, el, escapeHtml, stars, statusLabel, levelLabel, formatDate */
/**
 * AfriPass mobile app shell.
 *
 * A hash-routed single-page app that talks to the same REST API as the
 * desktop pages (see /js/app.js for the shared Api/el/escapeHtml/stars/
 * statusLabel/levelLabel helpers, loaded before this file). No build step,
 * no framework — deliberately plain so it's easy to eventually port into
 * React Native/Expo if you want App Store/Play Store distribution (see
 * README's "Mobile app" section).
 */

const content = document.getElementById('app-content');
const topbarTitle = document.getElementById('topbar-title');
const topbarBack = document.getElementById('topbar-back');
const topbarAction = document.getElementById('topbar-action');
const tabbar = document.getElementById('app-tabbar');

let meCache = null; // last /api/me result, refreshed on every account-relevant navigation
let backStack = []; // hash history for the in-app back button

// ---------------------------------------------------------------------
// Tiny router
// ---------------------------------------------------------------------

function parseHash() {
  const raw = (window.location.hash || '#/home').slice(1); // drop '#'
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart || '');
  return { segments, query };
}

function navigate(hash, { replace = false } = {}) {
  if (replace) {
    const url = window.location.pathname + window.location.search + hash;
    window.history.replaceState(null, '', url);
    route();
  } else {
    window.location.hash = hash;
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  setupInstallPrompt();
  setupOfflineBanner();
  route();
});

async function route() {
  const { segments } = parseHash();
  const top = segments[0] || 'home';
  setActiveTab(top);

  content.setAttribute('aria-busy', 'true');
  showLoading();
  try {
    if (top === 'home') await viewHome();
    else if (top === 'scan') await viewScan();
    else if (top === 'verify') await viewVerify(segments[1]);
    else if (top === 'account') await viewAccount(segments[1]);
    else if (top === 'admin') await viewAdmin(segments[1], segments[2]);
    else await viewHome();
  } catch (err) {
    renderError(err.message || 'Something went wrong.');
  }
  content.removeAttribute('aria-busy');
  window.scrollTo(0, 0);
}

function setActiveTab(top) {
  const bucket = top === 'admin' ? 'admin' : top === 'account' ? 'account' : top === 'scan' ? 'scan' : 'home';
  tabbar.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === bucket);
  });
}

function setTopbar({ title, showBack = false, action = null }) {
  topbarTitle.textContent = title;
  topbarBack.classList.toggle('hidden', !showBack);
  topbarAction.innerHTML = '';
  if (action) topbarAction.appendChild(action);
}

topbarBack.addEventListener('click', () => {
  if (backStack.length > 0) {
    navigate(backStack.pop(), { replace: true });
  } else {
    navigate('#/home');
  }
});

function pushBack(fromHash) {
  backStack.push(fromHash);
}

// ---------------------------------------------------------------------
// Shared render helpers
// ---------------------------------------------------------------------

function showLoading() {
  content.innerHTML = '';
  content.appendChild(
    el('div', { class: 'app-loading' }, [
      el('div', { class: 'app-spinner' }),
      el('div', {}, 'Loading…'),
    ])
  );
}

function renderError(message) {
  content.innerHTML = '';
  content.appendChild(el('div', { class: 'alert alert-error' }, message));
  content.appendChild(
    el('button', { class: 'btn btn-outline', onclick: () => navigate('#/home') }, 'Go home')
  );
}

function setContent(nodes) {
  content.innerHTML = '';
  (Array.isArray(nodes) ? nodes : [nodes]).forEach((n) => content.appendChild(n));
}

async function getMe(force = false) {
  if (meCache && !force) return meCache;
  meCache = await Api.get('/api/me');
  return meCache;
}

function trustBadge(business) {
  return el('span', { class: `badge-status status-${business.status}` }, statusLabel(business.status));
}

function documentStatusBadge(status) {
  // Mirrors the desktop dashboard's mapping onto the CSS's status-* palette
  // (there's no dedicated "pending"/"approved" color, so we borrow the
  // closest existing one).
  const mapped = status === 'approved' ? 'verified' : status === 'rejected' ? 'rejected' : 'under_review';
  return el('span', { class: `badge-status status-${mapped}` }, status);
}

function pillBadge(text) {
  return el('span', { class: 'pill' }, text);
}

// ---------------------------------------------------------------------
// Home / search
// ---------------------------------------------------------------------

async function viewHome() {
  setTopbar({ title: 'AfriPass' });
  const wrap = el('div', {}, []);

  wrap.appendChild(renderInstallBanner());

  wrap.appendChild(
    el('div', { class: 'card', style: 'margin-bottom:16px;' }, [
      el('h2', {}, 'Verify a business'),
      el('p', { class: 'muted small' }, 'Enter an AfriPass ID, or scan a QR code.'),
      el('div', { class: 'row' }, [
        el('input', { id: 'quick-id', placeholder: 'AFR-GH-7F92A31C', style: 'flex:1;' }),
        el(
          'button',
          {
            class: 'btn btn-primary',
            onclick: () => {
              const id = document.getElementById('quick-id').value.trim().toUpperCase();
              if (id) navigate(`#/verify/${encodeURIComponent(id)}`);
            },
          },
          'Go'
        ),
      ]),
      el(
        'button',
        { class: 'btn btn-outline', style: 'margin-top:10px; width:100%;', onclick: () => navigate('#/scan') },
        '📷 Scan QR code'
      ),
    ])
  );

  wrap.appendChild(
    el('div', { class: 'card' }, [
      el('h3', {}, 'Search businesses'),
      el('div', { class: 'stack', id: 'search-form' }, [
        el('input', { id: 'search-q', placeholder: 'Business name' }),
        el('div', { class: 'grid-2' }, [
          el('input', { id: 'search-country', placeholder: 'Country (optional)' }),
          el('input', { id: 'search-industry', placeholder: 'Industry (optional)' }),
        ]),
        el('button', { class: 'btn btn-gold', onclick: runSearch }, 'Search'),
      ]),
      el('div', { id: 'search-results', style: 'margin-top:14px;' }),
    ])
  );

  setContent(wrap);
}

async function runSearch() {
  const q = document.getElementById('search-q').value.trim();
  const country = document.getElementById('search-country').value.trim();
  const industry = document.getElementById('search-industry').value.trim();
  const results = document.getElementById('search-results');
  results.innerHTML = '';
  results.appendChild(el('div', { class: 'muted small' }, 'Searching…'));

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (country) params.set('country', country);
  if (industry) params.set('industry', industry);

  try {
    const list = await Api.get(`/api/search?${params.toString()}`);
    results.innerHTML = '';
    if (list.length === 0) {
      results.appendChild(el('div', { class: 'empty-state' }, 'No businesses found.'));
      return;
    }
    list.forEach((b) => {
      results.appendChild(
        el(
          'div',
          { class: 'result-item', onclick: () => navigate(`#/verify/${encodeURIComponent(b.passportId)}`) },
          [
            el('div', {}, [
              el('div', { style: 'font-weight:700;' }, b.name),
              el('div', { class: 'muted small' }, `${b.city ? b.city + ', ' : ''}${b.country} · ${b.industry || '—'}`),
            ]),
            el('div', { style: 'text-align:right;' }, [
              el('div', { class: `badge-status status-${b.status}` }, statusLabel(b.status)),
              el('div', { class: 'small muted', style: 'margin-top:4px;' }, `Score ${b.trustScore}`),
            ]),
          ]
        )
      );
    });
  } catch (err) {
    results.innerHTML = '';
    results.appendChild(el('div', { class: 'alert alert-error' }, err.message));
  }
}

// ---------------------------------------------------------------------
// QR scan (native BarcodeDetector where available; manual entry always works)
// ---------------------------------------------------------------------

async function viewScan() {
  setTopbar({ title: 'Scan QR code', showBack: true });
  pushBack('#/home');

  const wrap = el('div', {}, []);
  const supported = 'BarcodeDetector' in window;

  if (!supported) {
    wrap.appendChild(
      el('div', { class: 'alert alert-info' }, "Your browser doesn't support in-app QR scanning here — use your phone's camera app to scan, or type the ID below.")
    );
  } else {
    wrap.appendChild(
      el('div', { class: 'scan-target', id: 'scan-target' }, [el('div', { class: 'frame' })])
    );
    wrap.appendChild(el('p', { class: 'muted small', style: 'text-align:center;' }, 'Point your camera at an AfriPass QR code.'));
  }

  wrap.appendChild(
    el('div', { class: 'card', style: 'margin-top:16px;' }, [
      el('h3', {}, 'Or enter manually'),
      el('div', { class: 'row' }, [
        el('input', { id: 'manual-id', placeholder: 'AFR-GH-7F92A31C', style: 'flex:1;' }),
        el(
          'button',
          {
            class: 'btn btn-primary',
            onclick: () => {
              const id = document.getElementById('manual-id').value.trim().toUpperCase();
              if (id) navigate(`#/verify/${encodeURIComponent(id)}`);
            },
          },
          'Go'
        ),
      ]),
    ])
  );

  setContent(wrap);

  if (supported) startCameraScan();
}

let activeStream = null;

async function startCameraScan() {
  const target = document.getElementById('scan-target');
  if (!target) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    activeStream = stream;
    const video = el('video', { autoplay: 'true', playsinline: 'true', muted: 'true' });
    target.insertBefore(video, target.firstChild);
    video.srcObject = stream;
    await video.play();

    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!activeStream || !document.body.contains(video)) return; // view navigated away
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0) {
          const text = codes[0].rawValue || '';
          const match = text.match(/AFR-[A-Z]{2,3}-[A-Z0-9]{6,10}/i);
          const id = (match ? match[0] : text).toUpperCase();
          stopCameraScan();
          navigate(`#/verify/${encodeURIComponent(id)}`);
          return;
        }
      } catch (e) {
        /* transient detection errors are fine, keep trying */
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (err) {
    target.appendChild(el('div', { class: 'alert alert-error', style: 'margin-top:10px;' }, 'Camera unavailable — use manual entry below.'));
  }
}

function stopCameraScan() {
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }
}

// ---------------------------------------------------------------------
// Public passport view
// ---------------------------------------------------------------------

async function viewVerify(passportId) {
  if (!passportId) return navigate('#/home', { replace: true });
  setTopbar({ title: 'Passport', showBack: true });
  pushBack('#/home');
  stopCameraScan();

  let biz;
  try {
    biz = await Api.get(`/api/public/business/${encodeURIComponent(passportId)}`);
  } catch (err) {
    return renderError(err.message);
  }

  const b = biz;
  const wrap = el('div', {}, []);

  wrap.appendChild(
    el('div', { class: 'card', style: 'text-align:center;' }, [
      el('div', { class: 'muted small' }, 'AFRIPASS BUSINESS PASSPORT'),
      el('h1', { style: 'margin:6px 0 2px;' }, b.name),
      el('div', { class: 'mono muted' }, b.passportId),
      el('div', { style: 'margin:12px 0;' }, [trustBadge(b)]),
      el('div', { class: 'trust-score' }, [`${b.trustScore}`, el('small', {}, ' / 100')]),
      el('div', { class: 'level-track' }, [0, 1, 2, 3].map((i) =>
        el('div', { class: `level-dot${i < b.verificationLevel ? ' filled' : ''}` })
      )),
      el('div', { class: 'small muted' }, levelLabel(b.verificationLevel)),
    ])
  );

  wrap.appendChild(
    el('div', { class: 'card', style: 'margin-top:14px;' }, [
      el('h3', {}, 'Business information'),
      el('table', {}, [
        el('tr', {}, [el('th', {}, 'Country'), el('td', {}, b.country || '—')]),
        el('tr', {}, [el('th', {}, 'Region'), el('td', {}, b.region || '—')]),
        el('tr', {}, [el('th', {}, 'City'), el('td', {}, b.city || '—')]),
        el('tr', {}, [el('th', {}, 'Industry'), el('td', {}, b.industry || '—')]),
        el('tr', {}, [el('th', {}, 'Type'), el('td', {}, b.businessType || '—')]),
      ]),
    ])
  );

  wrap.appendChild(
    el('div', { class: 'card', style: 'margin-top:14px;' }, [
      el('h3', {}, 'Trust score breakdown'),
      el('ul', { class: 'checklist' }, [
        el('li', {}, [el('span', {}, 'Business verification'), el('span', {}, `+${b.trustScoreBreakdown.businessVerification}`)]),
        el('li', {}, [el('span', {}, 'Documents verified'), el('span', {}, `+${b.trustScoreBreakdown.documents}`)]),
        el('li', {}, [el('span', {}, 'Verified references'), el('span', {}, `+${b.trustScoreBreakdown.references}`)]),
        el('li', {}, [el('span', {}, 'Reviews'), el('span', {}, `+${b.trustScoreBreakdown.reviews}`)]),
      ]),
      el('p', { class: 'small muted', style: 'margin-top:8px;' }, "AfriPass's trust score is an informational indicator and is not a guarantee of financial performance, solvency or future conduct."),
    ])
  );

  wrap.appendChild(
    el('div', { class: 'card', style: 'margin-top:14px;' }, [
      el('h3', {}, `Verified references (${b.verifiedReferenceCount})`),
      b.verifiedReferenceCount === 0
        ? el('p', { class: 'muted small' }, 'No verified references yet.')
        : el('p', { class: 'muted small' }, `${b.verifiedReferenceCount} verified business relationship(s).`),
    ])
  );

  const reviewsCard = el('div', { class: 'card', style: 'margin-top:14px;' }, [
    el('h3', {}, `Reviews (${b.reviews.length})`),
  ]);
  if (b.reviews.length === 0) {
    reviewsCard.appendChild(el('p', { class: 'muted small' }, 'No reviews yet.'));
  } else {
    b.reviews.forEach((r) => {
      reviewsCard.appendChild(
        el('div', { style: 'padding:10px 0; border-bottom:1px solid var(--border);' }, [
          el('div', { class: 'stars' }, stars(r.rating)),
          el('div', {}, escapeHtml(r.comment)),
          el('div', { class: 'small muted' }, `${r.authorName} · ${formatDate(r.createdAt)}${r.verifiedTransaction ? ' · Verified transaction ✓' : ''}`),
        ])
      );
    });
  }
  reviewsCard.appendChild(el('button', { class: 'btn btn-outline', style: 'width:100%; margin-top:10px;', onclick: () => openReviewForm(b.passportId, wrap) }, 'Leave a review'));
  wrap.appendChild(reviewsCard);

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(`${window.location.origin}/verify/${b.passportId}`)}`;
  const qrImg = el('img', { src: qrUrl, alt: `QR code for ${b.passportId}`, loading: 'lazy' });
  const qrFallback = el('div', {
    class: 'hidden',
    style: 'width:180px; height:180px; display:flex; align-items:center; justify-content:center; background:var(--bg); border:1px dashed var(--border); border-radius:8px; text-align:center; padding:10px; box-sizing:border-box;',
  }, 'QR code unavailable — share the ID below instead.');
  qrImg.addEventListener('error', () => {
    qrImg.classList.add('hidden');
    qrFallback.classList.remove('hidden');
  });
  wrap.appendChild(
    el('div', { class: 'qr-passport', style: 'margin-top:14px;' }, [
      qrImg,
      qrFallback,
      el('div', { class: 'mono small' }, b.passportId),
      el('div', { class: 'muted small' }, 'Scan to verify this business'),
    ])
  );

  setContent(wrap);
}

function openReviewForm(passportId, wrap) {
  const existing = document.getElementById('review-form-card');
  if (existing) { existing.scrollIntoView({ behavior: 'smooth' }); return; }

  const card = el('div', { id: 'review-form-card', class: 'card', style: 'margin-top:14px;' }, [
    el('h3', {}, 'Leave a review'),
    el('div', { id: 'review-alert' }),
    el('input', { id: 'rev-author', placeholder: 'Your name' }),
    el('select', { id: 'rev-rating' }, [5, 4, 3, 2, 1].map((n) => el('option', { value: n }, `${n} star${n > 1 ? 's' : ''}`))),
    el('textarea', { id: 'rev-comment', placeholder: 'How was your experience?' }),
    el('button', {
      class: 'btn btn-primary',
      style: 'width:100%; margin-top:10px;',
      onclick: async () => {
        const alertBox = document.getElementById('review-alert');
        alertBox.innerHTML = '';
        const authorName = document.getElementById('rev-author').value.trim();
        const rating = Number(document.getElementById('rev-rating').value);
        const comment = document.getElementById('rev-comment').value.trim();
        if (!authorName || !comment) {
          alertBox.appendChild(el('div', { class: 'alert alert-error' }, 'Please fill in your name and a comment.'));
          return;
        }
        try {
          await Api.post(`/api/business/${encodeURIComponent(passportId)}/reviews`, { authorName, rating, comment });
          await viewVerify(passportId);
        } catch (err) {
          alertBox.appendChild(el('div', { class: 'alert alert-error' }, err.message));
        }
      },
    }, 'Submit review'),
  ]);
  wrap.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth' });
}

// ---------------------------------------------------------------------
// Account tab: adaptive — logged out (login/register) vs business dashboard
// ---------------------------------------------------------------------

async function viewAccount(sub) {
  const me = await getMe(true);

  if (!me.authenticated) {
    return viewAccountAuth(sub || 'login');
  }
  if (me.role === 'admin') {
    navigate('#/admin', { replace: true });
    return;
  }
  return viewDashboard(sub || 'passport');
}

function viewAccountAuth(mode) {
  setTopbar({ title: mode === 'register' ? 'Register your business' : 'Business login' });

  const wrap = el('div', {}, []);
  wrap.appendChild(
    el('div', { class: 'segmented' }, [
      el('button', { class: mode === 'login' ? 'active' : '', onclick: () => navigate('#/account/login', { replace: true }) }, 'Log in'),
      el('button', { class: mode === 'register' ? 'active' : '', onclick: () => navigate('#/account/register', { replace: true }) }, 'Register'),
    ])
  );

  const alertBox = el('div', { id: 'auth-alert' });
  wrap.appendChild(alertBox);

  if (mode === 'register') {
    const fields = {};
    ['businessName', 'email', 'password', 'country', 'region', 'city', 'industry', 'businessType'].forEach((f) => {
      fields[f] = el('input', { id: `reg-${f}`, type: f === 'password' ? 'password' : 'text' });
    });
    wrap.appendChild(
      el('div', { class: 'card stack' }, [
        labeled('Business name', fields.businessName),
        labeled('Email', fields.email),
        labeled('Password (min. 8 characters)', fields.password),
        labeled('Country', fields.country),
        el('div', { class: 'grid-2' }, [labeled('Region', fields.region), labeled('City', fields.city)]),
        el('div', { class: 'grid-2' }, [labeled('Industry', fields.industry), labeled('Business type', fields.businessType)]),
        el('button', {
          class: 'btn btn-gold',
          style: 'width:100%; margin-top:8px;',
          onclick: async () => {
            const alertEl = document.getElementById('auth-alert');
            alertEl.innerHTML = '';
            const payload = {};
            Object.entries(fields).forEach(([k, node]) => (payload[k] = node.value.trim()));
            try {
              await Api.post('/api/register', {
                email: payload.email,
                password: payload.password,
                businessName: payload.businessName,
                country: payload.country,
                region: payload.region,
                city: payload.city,
                industry: payload.industry,
                businessType: payload.businessType,
              });
              meCache = null;
              navigate('#/account', { replace: true });
            } catch (err) {
              alertEl.appendChild(el('div', { class: 'alert alert-error' }, err.message));
            }
          },
        }, 'Create account'),
      ])
    );
  } else {
    const emailInput = el('input', { id: 'login-email', type: 'email' });
    const passwordInput = el('input', { id: 'login-password', type: 'password' });
    wrap.appendChild(
      el('div', { class: 'card stack' }, [
        labeled('Email', emailInput),
        labeled('Password', passwordInput),
        el('button', {
          class: 'btn btn-primary',
          style: 'width:100%; margin-top:8px;',
          onclick: async () => {
            const alertEl = document.getElementById('auth-alert');
            alertEl.innerHTML = '';
            try {
              await Api.post('/api/login', { email: emailInput.value.trim(), password: passwordInput.value });
              meCache = null;
              navigate('#/account', { replace: true });
            } catch (err) {
              alertEl.appendChild(el('div', { class: 'alert alert-error' }, err.message));
            }
          },
        }, 'Log in'),
      ])
    );
  }

  setContent(wrap);
}

function labeled(label, inputNode) {
  return el('div', {}, [el('label', {}, label), inputNode]);
}

// ---------------------------------------------------------------------
// Business dashboard (Account tab, logged in)
// ---------------------------------------------------------------------

const DASH_TABS = [
  { id: 'passport', label: 'Passport' },
  { id: 'documents', label: 'Documents' },
  { id: 'references', label: 'References' },
  { id: 'requests', label: 'Requests' },
  { id: 'settings', label: 'Settings' },
];

async function viewDashboard(tab) {
  const business = await Api.get('/api/my-business');
  setTopbar({
    title: business.name,
    action: el('button', { class: 'top-action', onclick: doLogout }, 'Log out'),
  });

  const wrap = el('div', {}, []);
  wrap.appendChild(
    el('div', { class: 'segmented' }, DASH_TABS.map((t) =>
      el('button', { class: t.id === tab ? 'active' : '', onclick: () => navigate(`#/account/${t.id}`, { replace: true }) }, t.label)
    ))
  );

  const panel = el('div', {});
  wrap.appendChild(panel);
  setContent(wrap);

  if (tab === 'passport') return renderDashPassport(panel, business);
  if (tab === 'documents') return renderDashDocuments(panel, business);
  if (tab === 'references') return renderDashReferences(panel, business);
  if (tab === 'requests') return renderDashRequests(panel);
  if (tab === 'settings') return renderDashSettings(panel, business);
  return renderDashPassport(panel, business);
}

function renderDashPassport(panel, b) {
  panel.appendChild(
    el('div', { class: 'card', style: 'text-align:center;' }, [
      el('div', { class: 'mono muted' }, b.passportId),
      el('div', { style: 'margin:10px 0;' }, [trustBadge(b)]),
      el('div', { class: 'trust-score' }, [`${b.trustScore}`, el('small', {}, ' / 100')]),
      el('div', { class: 'small muted', style: 'margin-top:6px;' }, levelLabel(b.verificationLevel)),
      el('button', { class: 'btn btn-outline', style: 'margin-top:14px; width:100%;', onclick: () => navigate(`#/verify/${b.passportId}`) }, 'View public passport'),
    ])
  );
  panel.appendChild(
    el('div', { class: 'card', style: 'margin-top:14px;' }, [
      el('h3', {}, 'Score breakdown'),
      el('ul', { class: 'checklist' }, [
        el('li', {}, [el('span', {}, 'Business verification'), el('span', {}, `+${b.trustScoreBreakdown.businessVerification}`)]),
        el('li', {}, [el('span', {}, 'Documents'), el('span', {}, `+${b.trustScoreBreakdown.documents}`)]),
        el('li', {}, [el('span', {}, 'References'), el('span', {}, `+${b.trustScoreBreakdown.references}`)]),
        el('li', {}, [el('span', {}, 'Reviews'), el('span', {}, `+${b.trustScoreBreakdown.reviews}`)]),
      ]),
    ])
  );
}

const DOC_TYPE_LABELS = {
  registration_certificate: 'Registration certificate',
  incorporation_certificate: 'Certificate of incorporation',
  business_profile: 'Business profile',
  license: 'Licence',
  tax_document: 'Tax document',
  other: 'Other',
};

async function renderDashDocuments(panel, business) {
  panel.appendChild(
    el('div', { class: 'card' }, [
      el('h3', {}, 'Upload a document'),
      el('select', { id: 'doc-type' }, Object.entries(DOC_TYPE_LABELS).map(([v, label]) => el('option', { value: v }, label))),
      el('input', { id: 'doc-file', type: 'file', accept: '.pdf,.png,.jpg,.jpeg', style: 'margin-top:10px;' }),
      el('div', { id: 'doc-alert' }),
      el('button', {
        class: 'btn btn-primary',
        style: 'width:100%; margin-top:10px;',
        onclick: () => uploadDocument(panel, business),
      }, 'Upload'),
    ])
  );

  const listCard = el('div', { class: 'card', style: 'margin-top:14px;' }, [el('h3', {}, 'Your documents')]);
  panel.appendChild(listCard);
  try {
    const docs = await Api.get('/api/business/documents');
    if (docs.length === 0) {
      listCard.appendChild(el('div', { class: 'empty-state' }, 'No documents uploaded yet.'));
    } else {
      docs.forEach((d) => {
        listCard.appendChild(
          el('div', { class: 'list-row' }, [
            el('div', {}, [
              el('div', { style: 'font-weight:600;' }, DOC_TYPE_LABELS[d.type] || d.type),
              el('div', { class: 'small muted' }, `${escapeHtml(d.filename)} · ${formatDate(d.uploadedAt)}`),
            ]),
            documentStatusBadge(d.status),
          ])
        );
      });
    }
  } catch (err) {
    listCard.appendChild(el('div', { class: 'alert alert-error' }, err.message));
  }
}

function uploadDocument(panel, business) {
  const alertBox = document.getElementById('doc-alert');
  alertBox.innerHTML = '';
  const type = document.getElementById('doc-type').value;
  const fileInput = document.getElementById('doc-file');
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    alertBox.appendChild(el('div', { class: 'alert alert-error' }, 'Choose a file first.'));
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result.split(',')[1];
    try {
      await Api.post('/api/business/documents', { type, filename: file.name, base64 });
      await viewDashboard('documents');
    } catch (err) {
      alertBox.appendChild(el('div', { class: 'alert alert-error' }, err.message));
    }
  };
  reader.onerror = () => alertBox.appendChild(el('div', { class: 'alert alert-error' }, 'Could not read that file.'));
  reader.readAsDataURL(file);
}

async function renderDashReferences(panel) {
  panel.appendChild(
    el('div', { class: 'card' }, [
      el('h3', {}, 'Request a reference'),
      el('label', {}, "Other business's AfriPass ID"),
      el('input', { id: 'ref-passport-id', placeholder: 'AFR-GH-1C25B9FC' }),
      el('label', {}, 'Relationship'),
      el('input', { id: 'ref-relationship', placeholder: 'Supplier, Customer, Contractor…' }),
      el('label', {}, 'Comment'),
      el('textarea', { id: 'ref-comment', placeholder: 'Describe the business relationship…' }),
      el('div', { id: 'ref-alert' }),
      el('button', {
        class: 'btn btn-primary',
        style: 'width:100%; margin-top:10px;',
        onclick: async () => {
          const alertBox = document.getElementById('ref-alert');
          alertBox.innerHTML = '';
          const toPassportId = document.getElementById('ref-passport-id').value.trim().toUpperCase();
          const relationship = document.getElementById('ref-relationship').value.trim();
          const comment = document.getElementById('ref-comment').value.trim();
          if (!toPassportId || !relationship || !comment) {
            alertBox.appendChild(el('div', { class: 'alert alert-error' }, 'Fill in all fields.'));
            return;
          }
          try {
            await Api.post('/api/business/references', { toPassportId, relationship, comment });
            await viewDashboard('references');
          } catch (err) {
            alertBox.appendChild(el('div', { class: 'alert alert-error' }, err.message));
          }
        },
      }, 'Send request'),
    ])
  );

  let data;
  try {
    data = await Api.get('/api/business/references');
  } catch (err) {
    panel.appendChild(el('div', { class: 'alert alert-error', style: 'margin-top:14px;' }, err.message));
    return;
  }

  const receivedCard = el('div', { class: 'card', style: 'margin-top:14px;' }, [el('h3', {}, `Received (${data.received.length})`)]);
  if (data.received.length === 0) {
    receivedCard.appendChild(el('div', { class: 'empty-state' }, 'No reference requests received.'));
  } else {
    data.received.forEach((r) => {
      const row = el('div', { style: 'padding:10px 0; border-bottom:1px solid var(--border);' }, [
        el('div', { style: 'font-weight:600;' }, r.counterpartyName),
        el('div', { class: 'small muted' }, `${escapeHtml(r.relationship)} · ${escapeHtml(r.comment)}`),
        el('div', { style: 'margin-top:6px;' }, [pillBadge(r.status)]),
      ]);
      if (r.status === 'pending') {
        row.appendChild(
          el('div', { class: 'row', style: 'margin-top:8px;' }, [
            el('button', { class: 'btn btn-primary btn-sm', onclick: () => respondReference(r.id, true) }, 'Confirm'),
            el('button', { class: 'btn btn-danger btn-sm', onclick: () => respondReference(r.id, false) }, 'Decline'),
          ])
        );
      }
      receivedCard.appendChild(row);
    });
  }
  panel.appendChild(receivedCard);

  const sentCard = el('div', { class: 'card', style: 'margin-top:14px;' }, [el('h3', {}, `Sent (${data.sent.length})`)]);
  if (data.sent.length === 0) {
    sentCard.appendChild(el('div', { class: 'empty-state' }, 'No reference requests sent yet.'));
  } else {
    data.sent.forEach((r) => {
      sentCard.appendChild(
        el('div', { style: 'padding:10px 0; border-bottom:1px solid var(--border);' }, [
          el('div', { style: 'font-weight:600;' }, r.counterpartyName),
          el('div', { class: 'small muted' }, escapeHtml(r.relationship)),
          pillBadge(r.status),
        ])
      );
    });
  }
  panel.appendChild(sentCard);
}

async function respondReference(id, confirm) {
  try {
    await Api.post(`/api/business/references/${id}/respond`, { confirm });
    await viewDashboard('references');
  } catch (err) {
    window.alert(err.message);
  }
}

async function renderDashRequests(panel) {
  let list;
  try {
    list = await Api.get('/api/business/verification-requests');
  } catch (err) {
    panel.appendChild(el('div', { class: 'alert alert-error' }, err.message));
    return;
  }
  const card = el('div', { class: 'card' }, [el('h3', {}, 'Verification requests')]);
  if (list.length === 0) {
    card.appendChild(el('div', { class: 'empty-state' }, 'No verification requests yet.'));
  } else {
    list.forEach((r) => {
      const row = el('div', { style: 'padding:10px 0; border-bottom:1px solid var(--border);' }, [
        el('div', { style: 'font-weight:600;' }, r.requesterName),
        el('div', { class: 'small muted' }, r.purpose),
        el('div', { class: 'small muted' }, (r.checks || []).join(', ') || 'No specific checks listed'),
        el('div', { style: 'margin-top:6px;' }, [pillBadge(r.status)]),
      ]);
      if (r.status === 'pending') {
        row.appendChild(
          el('div', { class: 'row', style: 'margin-top:8px;' }, [
            el('button', { class: 'btn btn-primary btn-sm', onclick: () => respondVerificationRequest(r.id, true) }, 'Authorize'),
            el('button', { class: 'btn btn-danger btn-sm', onclick: () => respondVerificationRequest(r.id, false) }, 'Decline'),
          ])
        );
      }
      card.appendChild(row);
    });
  }
  panel.appendChild(card);
}

async function respondVerificationRequest(id, authorize) {
  try {
    await Api.post(`/api/business/verification-requests/${id}/respond`, { authorize });
    await viewDashboard('requests');
  } catch (err) {
    window.alert(err.message);
  }
}

function renderDashSettings(panel, business) {
  const fields = {};
  ['region', 'city', 'industry', 'businessType', 'phone', 'website', 'address', 'description'].forEach((f) => {
    fields[f] = el('input', { id: `set-${f}`, value: business[f] || '' });
  });
  const discoverable = el('input', { id: 'set-discoverable', type: 'checkbox' });
  discoverable.checked = business.discoverable !== false;

  panel.appendChild(
    el('div', { class: 'card stack' }, [
      el('h3', {}, 'Business settings'),
      el('div', { id: 'settings-alert' }),
      labeled('Region', fields.region),
      labeled('City', fields.city),
      labeled('Industry', fields.industry),
      labeled('Business type', fields.businessType),
      labeled('Phone', fields.phone),
      labeled('Website', fields.website),
      labeled('Address', fields.address),
      labeled('Description', fields.description),
      el('label', { class: 'row', style: 'margin-top:10px;' }, [discoverable, el('span', {}, ' Discoverable in public directory')]),
      el('button', {
        class: 'btn btn-primary',
        style: 'width:100%; margin-top:10px;',
        onclick: async () => {
          const alertBox = document.getElementById('settings-alert');
          alertBox.innerHTML = '';
          const payload = { discoverable: discoverable.checked };
          Object.entries(fields).forEach(([k, node]) => (payload[k] = node.value.trim()));
          try {
            await Api.patch('/api/business', payload);
            alertBox.appendChild(el('div', { class: 'alert alert-success' }, 'Saved.'));
          } catch (err) {
            alertBox.appendChild(el('div', { class: 'alert alert-error' }, err.message));
          }
        },
      }, 'Save changes'),
    ])
  );
}

async function doLogout() {
  try { await Api.post('/api/logout'); } catch (e) { /* ignore */ }
  meCache = null;
  navigate('#/home', { replace: true });
}

// ---------------------------------------------------------------------
// Admin tab: adaptive — admin login vs admin dashboard
// ---------------------------------------------------------------------

async function viewAdmin(sub, businessId) {
  const me = await getMe();
  if (!me.authenticated || me.role !== 'admin') {
    return viewAdminLogin();
  }
  if (sub === 'business' && businessId) {
    return viewAdminBusinessDetail(businessId);
  }
  return viewAdminDashboard(sub || 'queue');
}

function viewAdminLogin() {
  setTopbar({ title: 'Admin login' });
  const emailInput = el('input', { id: 'admin-email', type: 'email' });
  const passwordInput = el('input', { id: 'admin-password', type: 'password' });
  const wrap = el('div', { class: 'card stack' }, [
    el('div', { id: 'admin-auth-alert' }),
    labeled('Email', emailInput),
    labeled('Password', passwordInput),
    el('button', {
      class: 'btn btn-primary',
      style: 'width:100%; margin-top:8px;',
      onclick: async () => {
        const alertEl = document.getElementById('admin-auth-alert');
        alertEl.innerHTML = '';
        try {
          await Api.post('/api/admin/login', { email: emailInput.value.trim(), password: passwordInput.value });
          meCache = null;
          navigate('#/admin', { replace: true });
        } catch (err) {
          alertEl.appendChild(el('div', { class: 'alert alert-error' }, err.message));
        }
      },
    }, 'Log in'),
  ]);
  setContent(wrap);
}

const ADMIN_TABS = [
  { id: 'queue', label: 'Queue' },
  { id: 'stats', label: 'Stats' },
];

async function viewAdminDashboard(tab) {
  setTopbar({ title: 'Admin', action: el('button', { class: 'top-action', onclick: doLogout }, 'Log out') });
  const wrap = el('div', {}, [
    el('div', { class: 'segmented' }, ADMIN_TABS.map((t) =>
      el('button', { class: t.id === tab ? 'active' : '', onclick: () => navigate(`#/admin/${t.id}`, { replace: true }) }, t.label)
    )),
  ]);
  const panel = el('div', {});
  wrap.appendChild(panel);
  setContent(wrap);

  if (tab === 'stats') return renderAdminStats(panel);
  return renderAdminQueue(panel);
}

async function renderAdminQueue(panel) {
  let queue;
  try {
    queue = await Api.get('/api/admin/queue');
  } catch (err) {
    panel.appendChild(el('div', { class: 'alert alert-error' }, err.message));
    return;
  }
  if (queue.length === 0) {
    panel.appendChild(el('div', { class: 'empty-state' }, 'Nothing pending review.'));
    return;
  }
  queue.forEach((q) => {
    panel.appendChild(
      el(
        'div',
        { class: 'result-item', onclick: () => navigate(`#/admin/business/${q.id}`) },
        [
          el('div', {}, [
            el('div', { style: 'font-weight:700;' }, q.name),
            el('div', { class: 'mono small muted' }, q.passportId),
            el('div', { class: 'small muted' }, `${q.documents} doc(s), ${q.documentsPending} pending · ${q.references} verified reference(s)`),
          ]),
          trustBadge(q),
        ]
      )
    );
  });
}

async function renderAdminStats(panel) {
  let stats;
  try {
    stats = await Api.get('/api/admin/stats');
  } catch (err) {
    panel.appendChild(el('div', { class: 'alert alert-error' }, err.message));
    return;
  }
  const box = (num, label) => el('div', { class: 'stat-box' }, [el('div', { class: 'num' }, String(num)), el('div', { class: 'label' }, label)]);
  panel.appendChild(
    el('div', { class: 'card' }, [
      el('h3', {}, 'Businesses'),
      el('div', { class: 'stat-grid' }, [
        box(stats.businesses.registered, 'Registered'),
        box(stats.businesses.verified, 'Verified'),
        box(stats.businesses.pending, 'Pending'),
        box(stats.businesses.underReview, 'Under review'),
        box(stats.businesses.rejected, 'Rejected'),
      ]),
    ])
  );
  panel.appendChild(
    el('div', { class: 'card', style: 'margin-top:14px;' }, [
      el('h3', {}, 'Verification'),
      el('div', { class: 'stat-grid' }, [
        box(stats.verification.documents, 'Documents'),
        box(stats.verification.references, 'References'),
        box(stats.verification.requests, 'Requests'),
      ]),
    ])
  );
}

async function viewAdminBusinessDetail(businessId) {
  setTopbar({ title: 'Review business', showBack: true });
  pushBack('#/admin/queue');

  let b;
  try {
    b = await Api.get(`/api/admin/business/${encodeURIComponent(businessId)}`);
  } catch (err) {
    return renderError(err.message);
  }

  const wrap = el('div', {}, []);
  wrap.appendChild(
    el('div', { class: 'card' }, [
      el('h2', {}, b.name),
      el('div', { class: 'mono muted' }, b.passportId),
      el('div', { style: 'margin:10px 0;' }, [trustBadge(b)]),
      el('div', { class: 'small muted' }, `Trust score: ${b.trustScore} / 100`),
      el('label', { class: 'row', style: 'margin-top:14px;' }, [
        (() => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = !!b.representativeVerified;
          cb.addEventListener('change', async () => {
            try {
              await Api.patch(`/api/admin/business/${b.id}`, { representativeVerified: cb.checked });
            } catch (err) {
              window.alert(err.message);
            }
          });
          return cb;
        })(),
        el('span', {}, ' Representative verified'),
      ]),
    ])
  );

  const docsCard = el('div', { class: 'card', style: 'margin-top:14px;' }, [el('h3', {}, `Documents (${b.documents.length})`)]);
  if (b.documents.length === 0) {
    docsCard.appendChild(el('div', { class: 'empty-state' }, 'No documents uploaded.'));
  } else {
    b.documents.forEach((d) => {
      const row = el('div', { style: 'padding:10px 0; border-bottom:1px solid var(--border);' }, [
        el('div', { style: 'font-weight:600;' }, DOC_TYPE_LABELS[d.type] || d.type),
        el('div', { class: 'small muted' }, escapeHtml(d.filename)),
        el('div', { style: 'margin:6px 0;' }, [documentStatusBadge(d.status)]),
        el('div', { class: 'row' }, [
          el('a', { class: 'btn btn-outline btn-sm', href: `/api/admin/documents/${d.id}/file`, target: '_blank', rel: 'noopener' }, 'View'),
          el('button', { class: 'btn btn-primary btn-sm', onclick: () => setDocumentStatus(businessId, d.id, 'approved') }, 'Approve'),
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => setDocumentStatus(businessId, d.id, 'rejected') }, 'Reject'),
        ]),
      ]);
      docsCard.appendChild(row);
    });
  }
  wrap.appendChild(docsCard);

  const refsCard = el('div', { class: 'card', style: 'margin-top:14px;' }, [el('h3', {}, `References requested (${b.references.length})`)]);
  if (b.references.length === 0) {
    refsCard.appendChild(el('div', { class: 'empty-state' }, 'None yet.'));
  } else {
    b.references.forEach((r) => {
      refsCard.appendChild(
        el('div', { style: 'padding:8px 0; border-bottom:1px solid var(--border);' }, [
          el('div', {}, `${escapeHtml(r.relationship)} — ${escapeHtml(r.comment)}`),
          pillBadge(r.status),
        ])
      );
    });
  }
  wrap.appendChild(refsCard);

  wrap.appendChild(
    el('div', { class: 'card', style: 'margin-top:14px;' }, [
      el('h3', {}, 'Decision'),
      el('div', { id: 'decision-alert' }),
      el('div', { class: 'stack' }, [
        el('button', { class: 'btn btn-primary', onclick: () => setBusinessStatus(businessId, 'verified') }, 'Approve — mark Verified'),
        el('button', { class: 'btn btn-outline', onclick: () => setBusinessStatus(businessId, 'under_review') }, 'Request more information'),
        el('button', { class: 'btn btn-danger', onclick: () => setBusinessStatus(businessId, 'rejected') }, 'Reject'),
      ]),
    ])
  );

  setContent(wrap);
}

async function setDocumentStatus(businessId, docId, status) {
  try {
    await Api.patch(`/api/admin/document/${docId}`, { status });
    await viewAdminBusinessDetail(businessId);
  } catch (err) {
    window.alert(err.message);
  }
}

async function setBusinessStatus(businessId, status) {
  try {
    await Api.patch(`/api/admin/business/${businessId}`, { status });
    await viewAdminBusinessDetail(businessId);
  } catch (err) {
    const alertBox = document.getElementById('decision-alert');
    if (alertBox) alertBox.appendChild(el('div', { class: 'alert alert-error' }, err.message));
  }
}

// ---------------------------------------------------------------------
// PWA install prompt, offline banner, service worker
// ---------------------------------------------------------------------

let deferredInstallPrompt = null;

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const banner = document.getElementById('install-banner-slot');
    if (banner) banner.replaceChildren(renderInstallBanner());
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
  });
}

function renderInstallBanner() {
  const dismissed = localStorage.getItem('afripass_install_dismissed') === '1';
  if (!deferredInstallPrompt || dismissed) return el('div', { id: 'install-banner-slot' });

  return el('div', { id: 'install-banner-slot' }, [
    el('div', { class: 'install-banner' }, [
      el('div', { class: 'msg' }, 'Install AfriPass for quick access and offline browsing.'),
      el('button', {
        class: 'btn btn-gold btn-sm',
        onclick: async () => {
          if (!deferredInstallPrompt) return;
          deferredInstallPrompt.prompt();
          await deferredInstallPrompt.userChoice;
          deferredInstallPrompt = null;
        },
      }, 'Install'),
      el('button', {
        class: 'dismiss',
        onclick: (e) => {
          localStorage.setItem('afripass_install_dismissed', '1');
          e.target.closest('.install-banner').remove();
        },
      }, '✕'),
    ]),
  ]);
}

function setupOfflineBanner() {
  const bar = document.getElementById('offline-banner');
  const update = () => {
    bar.classList.toggle('hidden', navigator.onLine);
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Service workers require a secure context (HTTPS or localhost) — this
  // will silently no-op over plain HTTP on a non-localhost host, which is
  // expected and fine; the app still works, just without offline caching.
  navigator.serviceWorker.register('/service-worker.js').catch(() => {
    /* offline caching just won't be available — not fatal */
  });
}

// Bottom tab bar wiring
tabbar.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dest = btn.dataset.tab;
    backStack = [];
    navigate(`#/${dest}`);
  });
});
