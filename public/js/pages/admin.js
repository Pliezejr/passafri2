'use strict';

async function initAdmin() {
  const root = document.getElementById('admin-root');
  const me = await Api.get('/api/me').catch(() => ({ authenticated: false }));
  if (!me.authenticated || me.role !== 'admin') {
    renderAdminLogin(root);
    return;
  }
  await renderAdminHome(root);
}

function renderAdminLogin(root) {
  root.innerHTML = '';
  const alertBox = el('div', {});
  const emailInput = el('input', { type: 'email', required: true, value: 'admin@afripass.local' });
  const passInput = el('input', { type: 'password', required: true });
  const submitBtn = el('button', { type: 'submit' }, 'Log in');

  const form = el('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      showAlert(alertBox, null);
      submitBtn.disabled = true; submitBtn.textContent = 'Logging in…';
      try {
        await Api.post('/api/admin/login', { email: emailInput.value.trim(), password: passInput.value });
        await renderAdminHome(root);
      } catch (err) {
        showAlert(alertBox, err.message);
        submitBtn.disabled = false; submitBtn.textContent = 'Log in';
      }
    },
  }, [
    el('div', { class: 'field' }, [el('label', {}, 'Admin email'), emailInput]),
    el('div', { class: 'field' }, [el('label', {}, 'Password'), passInput]),
    el('div', { class: 'form-actions' }, [submitBtn]),
  ]);

  root.appendChild(el('div', { style: 'max-width:420px; margin:0 auto;' }, [
    el('h1', {}, 'AfriPass staff login'),
    alertBox,
    form,
    el('p', { class: 'muted', style: 'font-size:0.82rem;' }, 'Default seeded credentials are printed in the server console on first run — change them before deploying anywhere real.'),
  ]));
}

async function renderAdminHome(root) {
  root.innerHTML = '';
  root.appendChild(el('h1', {}, 'Admin dashboard'));

  const statsMount = el('div', { class: 'grid-3' });
  root.appendChild(statsMount);

  const queueCard = el('div', { class: 'card' }, [el('h2', {}, 'Pending verifications')]);
  const queueMount = el('div', { id: 'admin-queue-mount' }, [el('p', { class: 'muted' }, 'Loading…')]);
  queueCard.appendChild(queueMount);
  root.appendChild(queueCard);

  const detailMount = el('div', { id: 'admin-detail' });
  root.appendChild(detailMount);

  try {
    const stats = await Api.get('/api/admin/stats');
    statsMount.innerHTML = '';
    statsMount.appendChild(statCard('Registered', stats.businesses.registered));
    statsMount.appendChild(statCard('Verified', stats.businesses.verified));
    statsMount.appendChild(statCard('Pending', stats.businesses.pending));
    statsMount.appendChild(statCard('Under review', stats.businesses.underReview));
    statsMount.appendChild(statCard('Rejected', stats.businesses.rejected));
    statsMount.appendChild(statCard('Documents submitted', stats.verification.documents));
  } catch (e) {
    showAlert(statsMount, e.message);
  }

  await refreshQueue(queueMount);
}

function statCard(label, value) {
  return el('div', { class: 'card', style: 'text-align:center;' }, [
    el('div', { style: 'font-size:1.6rem; font-weight:800;' }, String(value)),
    el('div', { class: 'muted', style: 'font-size:0.85rem;' }, label),
  ]);
}

async function refreshQueue(mount) {
  mount = mount || document.getElementById('admin-queue-mount');
  mount.innerHTML = '';
  try {
    const queue = await Api.get('/api/admin/queue');
    if (queue.length === 0) {
      mount.appendChild(el('div', { class: 'empty-state' }, 'Nothing pending review right now.'));
      return;
    }
    queue.forEach((q) => {
      mount.appendChild(el('div', { class: 'list-row' }, [
        el('div', {}, [
          el('div', {}, [el('strong', {}, q.name), el('span', { class: `badge-status status-${q.status}`, style: 'margin-left:8px;' }, statusLabel(q.status))]),
          el('div', { class: 'passport-id muted', style: 'font-size:0.82rem;' }, q.passportId),
          el('div', { class: 'muted', style: 'font-size:0.82rem;' }, `${q.documents} document(s), ${q.documentsPending} pending · ${q.references} verified reference(s)`),
        ]),
        el('button', { class: 'small', onclick: () => openBusinessDetail(q.id) }, 'Review'),
      ]));
    });
  } catch (e) {
    mount.appendChild(el('div', { class: 'alert alert-error' }, e.message));
  }
}

async function openBusinessDetail(id) {
  const mount = document.getElementById('admin-detail');
  mount.innerHTML = '';
  mount.appendChild(el('p', { class: 'muted' }, 'Loading business…'));
  try {
    const b = await Api.get('/api/admin/business/' + id);
    mount.innerHTML = '';

    const statusSelect = el('select', {}, [
      'unverified', 'business_verified', 'under_review', 'verified', 'rejected', 'suspended',
    ].map((s) => {
      const opt = el('option', { value: s }, statusLabel(s));
      if (s === b.status) opt.selected = true;
      return opt;
    }));
    const repVerified = el('input', { type: 'checkbox' });
    repVerified.checked = !!b.representativeVerified;

    const alertBox = el('div', {});
    const saveBtn = el('button', {
      onclick: async () => {
        showAlert(alertBox, null);
        try {
          await Api.patch('/api/admin/business/' + id, {
            status: statusSelect.value,
            representativeVerified: repVerified.checked,
          });
          showAlert(alertBox, 'Saved.', 'success');
          await refreshQueue();
          openBusinessDetail(id);
        } catch (e) {
          showAlert(alertBox, e.message);
        }
      },
    }, 'Save decision');

    const card = el('div', { class: 'card' }, [
      el('h2', {}, `${b.name} — ${b.passportId}`),
      alertBox,
      el('div', { class: 'grid-2' }, [
        el('div', {}, [
          infoRowAdmin('Country', b.country), infoRowAdmin('Region', b.region || '—'), infoRowAdmin('City', b.city || '—'),
          infoRowAdmin('Industry', b.industry || '—'), infoRowAdmin('Trust score', b.trustScore + '/100'),
        ]),
        el('div', {}, [
          el('div', { class: 'field' }, [el('label', {}, 'Status'), statusSelect]),
          el('div', { class: 'field' }, [
            el('label', { style: 'display:flex; align-items:center; gap:8px; font-weight:400;' }, [repVerified, 'Representative verified']),
          ]),
          saveBtn,
        ]),
      ]),
    ]);
    mount.appendChild(card);

    const docsCard = el('div', { class: 'card' }, [el('h3', {}, `Documents (${b.documents.length})`)]);
    if (b.documents.length === 0) {
      docsCard.appendChild(el('p', { class: 'muted' }, 'No documents submitted.'));
    } else {
      b.documents.forEach((d) => {
        docsCard.appendChild(el('div', { class: 'list-row' }, [
          el('div', {}, [
            el('div', {}, [el('strong', {}, d.type.replace(/_/g, ' '))]),
            el('div', { class: 'muted', style: 'font-size:0.82rem;' }, escapeHtml(d.filename)),
          ]),
          el('div', { style: 'display:flex; gap:6px; align-items:center;' }, [
            el('a', { class: 'btn small secondary', href: `/api/admin/documents/${d.id}/file`, target: '_blank' }, 'View'),
            el('button', { class: 'small', onclick: () => reviewDocument(d.id, 'approved', id) }, 'Approve'),
            el('button', { class: 'small danger', onclick: () => reviewDocument(d.id, 'rejected', id) }, 'Reject'),
            el('span', { class: 'pill' }, d.status),
          ]),
        ]));
      });
    }
    mount.appendChild(docsCard);

    const refsCard = el('div', { class: 'card' }, [el('h3', {}, `References (${b.references.length})`)]);
    if (b.references.length === 0) {
      refsCard.appendChild(el('p', { class: 'muted' }, 'No references submitted.'));
    } else {
      b.references.forEach((r) => {
        refsCard.appendChild(el('div', { class: 'list-row' }, [
          el('div', {}, [el('strong', {}, r.relationship), el('span', { class: 'muted' }, ' — ' + escapeHtml(r.comment))]),
          el('span', { class: 'pill' }, r.status),
        ]));
      });
    }
    mount.appendChild(refsCard);
  } catch (e) {
    mount.innerHTML = '';
    mount.appendChild(el('div', { class: 'alert alert-error' }, e.message));
  }
}

function infoRowAdmin(label, value) {
  return el('div', { class: 'list-row' }, [el('span', { class: 'muted' }, label), el('span', {}, value)]);
}

async function reviewDocument(docId, status, businessId) {
  try {
    await Api.patch('/api/admin/document/' + docId, { status });
    openBusinessDetail(businessId);
  } catch (e) {
    alert(e.message);
  }
}

document.addEventListener('DOMContentLoaded', initAdmin);
