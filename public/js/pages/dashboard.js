'use strict';

let CURRENT_BUSINESS = null;

async function initDashboard() {
  const root = document.getElementById('dashboard-root');
  const me = await Api.get('/api/me').catch(() => ({ authenticated: false }));
  if (!me.authenticated || me.role !== 'business') {
    window.location.href = '/login.html';
    return;
  }

  try {
    CURRENT_BUSINESS = await Api.get('/api/my-business');
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'alert alert-error' }, e.message));
    return;
  }

  renderShell(root);
}

function renderShell(root) {
  const b = CURRENT_BUSINESS;
  root.innerHTML = '';

  // ---- Header card ----
  const header = el('div', { class: 'card two-col' }, [
    el('div', { class: 'main' }, [
      el('h1', {}, b.name),
      el('div', { class: 'passport-id', style: 'font-size:1.05rem; margin-bottom:8px;' }, b.passportId),
      el('span', { class: `badge-status status-${b.status}` }, statusLabel(b.status)),
      el('div', { class: 'muted', style: 'margin-top:10px;' }, levelLabel(b.verificationLevel)),
      el('div', { style: 'margin-top:16px;' }, [
        el('a', { class: 'btn small', href: '/verify/' + encodeURIComponent(b.passportId), target: '_blank' }, 'View public passport'),
      ]),
    ]),
    el('div', { class: 'side', style: 'display:flex; gap:16px; align-items:center; justify-content:center;' }, [
      scoreCircle(b.trustScore),
    ]),
  ]);
  root.appendChild(header);

  // ---- Tabs ----
  const tabs = [
    { id: 'passport', label: 'My Passport' },
    { id: 'documents', label: 'Documents' },
    { id: 'references', label: 'References' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'requests', label: 'Verification Requests' },
    { id: 'settings', label: 'Settings' },
  ];
  const tabBar = el('div', { class: 'tabs' });
  const panels = el('div', {});
  tabs.forEach((t, i) => {
    const btn = el('button', { onclick: () => switchTab(t.id) }, t.label);
    btn.id = 'tab-btn-' + t.id;
    if (i === 0) btn.classList.add('active');
    tabBar.appendChild(btn);

    const panel = el('div', { class: 'tab-panel' + (i === 0 ? ' active' : '') });
    panel.id = 'tab-panel-' + t.id;
    panels.appendChild(panel);
  });
  root.appendChild(tabBar);
  root.appendChild(panels);

  renderPassportTab(document.getElementById('tab-panel-passport'));
  renderDocumentsTab(document.getElementById('tab-panel-documents'));
  renderReferencesTab(document.getElementById('tab-panel-references'));
  renderReviewsTab(document.getElementById('tab-panel-reviews'));
  renderRequestsTab(document.getElementById('tab-panel-requests'));
  renderSettingsTab(document.getElementById('tab-panel-settings'));
}

function switchTab(id) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('tab-btn-' + id).classList.add('active');
  document.getElementById('tab-panel-' + id).classList.add('active');
}

function scoreCircle(score) {
  const wrap = el('div', { class: 'score-circle', style: `--pct:${score}` }, [
    el('div', { class: 'inner' }, [
      el('div', { class: 'num' }, String(score)),
      el('div', { class: 'denom' }, '/ 100'),
    ]),
  ]);
  return wrap;
}

// ---------------------------------------------------------------------
// My Passport tab
// ---------------------------------------------------------------------

function renderPassportTab(panel) {
  const b = CURRENT_BUSINESS;
  panel.innerHTML = '';

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    window.location.origin + '/verify/' + b.passportId
  )}`;

  panel.appendChild(el('div', { class: 'grid-2' }, [
    el('div', { class: 'card' }, [
      el('h2', {}, 'Trust score breakdown'),
      el('div', { class: 'score-row' }, [el('span', {}, 'Business verification'), el('strong', {}, `${b.trustScoreBreakdown.businessVerification} / 35`)]),
      el('div', { class: 'score-row' }, [el('span', {}, 'Verified documents'), el('strong', {}, `${b.trustScoreBreakdown.documents} / 25`)]),
      el('div', { class: 'score-row' }, [el('span', {}, 'Verified references'), el('strong', {}, `${b.trustScoreBreakdown.references} / 20`)]),
      el('div', { class: 'score-row' }, [el('span', {}, 'Reviews'), el('strong', {}, `${b.trustScoreBreakdown.reviews} / 20`)]),
      el('p', { class: 'muted', style: 'margin-top:12px; font-size:0.82rem;' },
        "AfriPass's trust score is an informational indicator and is not a guarantee of financial performance, solvency or future conduct."),
    ]),
    el('div', { class: 'card qr-box' }, [
      el('h2', {}, 'Your QR code'),
      el('img', { src: qrUrl, alt: 'QR code for ' + b.passportId, width: '180', height: '180' }),
      el('p', { class: 'passport-id', style: 'margin-top:10px;' }, b.passportId),
      el('p', { class: 'muted', style: 'font-size:0.82rem;' }, 'Anyone who scans this lands on your public passport page.'),
    ]),
  ]));

  panel.appendChild(el('div', { class: 'card' }, [
    el('h2', {}, 'Business information'),
    infoRow('Country', b.country),
    infoRow('Region', b.region || '—'),
    infoRow('City', b.city || '—'),
    infoRow('Industry', b.industry || '—'),
    infoRow('Business type', b.businessType || '—'),
    infoRow('Phone', b.phone || '—'),
    infoRow('Website', b.website || '—'),
    infoRow('Address', b.address || '—'),
    infoRow('Description', b.description || '—'),
    el('p', { class: 'muted', style: 'margin-top:10px; font-size:0.82rem;' }, 'Edit these under the Settings tab.'),
  ]));
}

function infoRow(label, value) {
  return el('div', { class: 'list-row' }, [
    el('span', { class: 'muted' }, label),
    el('span', {}, value),
  ]);
}

// ---------------------------------------------------------------------
// Documents tab
// ---------------------------------------------------------------------

const DOC_TYPE_LABELS = {
  registration_certificate: 'Business Registration Certificate',
  incorporation_certificate: 'Certificate of Incorporation',
  business_profile: 'Business Profile',
  license: 'Licence',
  tax_document: 'Tax Document',
  other: 'Other Supporting Document',
};

function renderDocumentsTab(panel) {
  panel.innerHTML = '';
  const alertBox = el('div', {});
  const uploadCard = el('div', { class: 'card' }, [
    el('h2', {}, 'Upload a document'),
    alertBox,
    buildUploadForm(alertBox, panel),
  ]);
  panel.appendChild(uploadCard);

  const listCard = el('div', { class: 'card' }, [el('h2', {}, 'Your documents')]);
  const listMount = el('div', {}, [el('p', { class: 'muted' }, 'Loading…')]);
  listCard.appendChild(listMount);
  panel.appendChild(listCard);

  refreshDocuments(listMount);
}

function buildUploadForm(alertBox, panel) {
  const typeSelect = el('select', { id: 'doc-type' },
    Object.entries(DOC_TYPE_LABELS).map(([val, label]) => el('option', { value: val }, label)));
  const fileInput = el('input', { type: 'file', id: 'doc-file', accept: '.pdf,.png,.jpg,.jpeg' });
  const submitBtn = el('button', { type: 'submit' }, 'Upload');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      showAlert(alertBox, null);
      const file = fileInput.files[0];
      if (!file) { showAlert(alertBox, 'Choose a file first.'); return; }
      if (file.size > 8 * 1024 * 1024) { showAlert(alertBox, 'File exceeds 8MB limit.'); return; }

      submitBtn.disabled = true; submitBtn.textContent = 'Uploading…';
      try {
        const base64 = await fileToBase64(file);
        await Api.post('/api/business/documents', { type: typeSelect.value, filename: file.name, base64 });
        showAlert(alertBox, 'Document uploaded and pending review.', 'success');
        fileInput.value = '';
        refreshDocuments(document.querySelector('#tab-panel-documents .card:nth-child(2) > div'));
      } catch (err) {
        showAlert(alertBox, err.message);
      } finally {
        submitBtn.disabled = false; submitBtn.textContent = 'Upload';
      }
    },
  }, [
    el('div', { class: 'field' }, [el('label', {}, 'Document type'), typeSelect]),
    el('div', { class: 'field' }, [el('label', {}, 'File (PDF, PNG or JPG — max 8MB)'), fileInput]),
    el('div', { class: 'form-actions' }, [submitBtn]),
  ]);
  return form;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function refreshDocuments(mount) {
  mount.innerHTML = '';
  try {
    const docs = await Api.get('/api/business/documents');
    if (docs.length === 0) {
      mount.appendChild(el('div', { class: 'empty-state' }, 'No documents uploaded yet.'));
      return;
    }
    docs.slice().reverse().forEach((d) => {
      mount.appendChild(el('div', { class: 'list-row' }, [
        el('div', {}, [
          el('div', {}, [el('strong', {}, DOC_TYPE_LABELS[d.type] || d.type)]),
          el('div', { class: 'muted', style: 'font-size:0.82rem;' }, `${escapeHtml(d.filename)} · uploaded ${formatDate(d.uploadedAt)}`),
        ]),
        el('span', { class: `badge-status status-${d.status === 'approved' ? 'verified' : d.status === 'rejected' ? 'rejected' : 'under_review'}` },
          d.status.charAt(0).toUpperCase() + d.status.slice(1)),
      ]));
    });
  } catch (e) {
    mount.appendChild(el('div', { class: 'alert alert-error' }, e.message));
  }
}

// ---------------------------------------------------------------------
// References tab
// ---------------------------------------------------------------------

function renderReferencesTab(panel) {
  panel.innerHTML = '';
  const alertBox = el('div', {});

  const idInput = el('input', { type: 'text', id: 'ref-passport-id', placeholder: 'AFR-XX-XXXXXXXX', required: true });
  const relInput = el('input', { type: 'text', id: 'ref-relationship', placeholder: 'Supplier, Customer, Partner…', required: true });
  const commentInput = el('textarea', { id: 'ref-comment', placeholder: 'Briefly describe the relationship…', required: true });
  const submitBtn = el('button', { type: 'submit' }, 'Send reference request');

  const requestForm = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      showAlert(alertBox, null);
      submitBtn.disabled = true; submitBtn.textContent = 'Sending…';
      try {
        await Api.post('/api/business/references', {
          toPassportId: idInput.value.trim(),
          relationship: relInput.value.trim(),
          comment: commentInput.value.trim(),
        });
        showAlert(alertBox, 'Reference request sent.', 'success');
        idInput.value = ''; relInput.value = ''; commentInput.value = '';
        refreshReferences();
      } catch (err) {
        showAlert(alertBox, err.message);
      } finally {
        submitBtn.disabled = false; submitBtn.textContent = 'Send reference request';
      }
    },
  }, [
    el('div', { class: 'field' }, [el('label', {}, "Other business's AfriPass ID"), idInput]),
    el('div', { class: 'field' }, [el('label', {}, 'Relationship'), relInput]),
    el('div', { class: 'field' }, [el('label', {}, 'Comment'), commentInput]),
    el('div', { class: 'form-actions' }, [submitBtn]),
  ]);

  panel.appendChild(el('div', { class: 'card' }, [el('h2', {}, 'Request a reference'), alertBox, requestForm]));

  const receivedCard = el('div', { class: 'card' }, [el('h2', {}, 'Reference requests received')]);
  const receivedMount = el('div', {}, [el('p', { class: 'muted' }, 'Loading…')]);
  receivedCard.appendChild(receivedMount);
  panel.appendChild(receivedCard);

  const sentCard = el('div', { class: 'card' }, [el('h2', {}, 'Reference requests sent')]);
  const sentMount = el('div', {}, [el('p', { class: 'muted' }, 'Loading…')]);
  sentCard.appendChild(sentMount);
  panel.appendChild(sentCard);

  panel.dataset.receivedMountId = 'ref-received-mount';
  panel.dataset.sentMountId = 'ref-sent-mount';
  receivedMount.id = 'ref-received-mount';
  sentMount.id = 'ref-sent-mount';

  refreshReferences();
}

async function refreshReferences() {
  const receivedMount = document.getElementById('ref-received-mount');
  const sentMount = document.getElementById('ref-sent-mount');
  if (!receivedMount || !sentMount) return;
  receivedMount.innerHTML = '';
  sentMount.innerHTML = '';
  try {
    const { sent, received } = await Api.get('/api/business/references');

    if (received.length === 0) {
      receivedMount.appendChild(el('div', { class: 'empty-state' }, 'No reference requests received yet.'));
    } else {
      received.slice().reverse().forEach((r) => {
        const row = el('div', { class: 'list-row' }, [
          el('div', {}, [
            el('div', {}, [el('strong', {}, r.counterpartyName), el('span', { class: 'muted' }, ` — ${escapeHtml(r.relationship)}`)]),
            el('div', { class: 'muted', style: 'font-size:0.85rem;' }, escapeHtml(r.comment)),
          ]),
          referenceStatusOrActions(r),
        ]);
        receivedMount.appendChild(row);
      });
    }

    if (sent.length === 0) {
      sentMount.appendChild(el('div', { class: 'empty-state' }, 'No reference requests sent yet.'));
    } else {
      sent.slice().reverse().forEach((r) => {
        sentMount.appendChild(el('div', { class: 'list-row' }, [
          el('div', {}, [
            el('div', {}, [el('strong', {}, r.counterpartyName), el('span', { class: 'muted' }, ` — ${escapeHtml(r.relationship)}`)]),
            el('div', { class: 'muted', style: 'font-size:0.85rem;' }, escapeHtml(r.comment)),
          ]),
          el('span', { class: `pill` }, r.status),
        ]));
      });
    }
  } catch (e) {
    receivedMount.appendChild(el('div', { class: 'alert alert-error' }, e.message));
  }
}

function referenceStatusOrActions(r) {
  if (r.status !== 'pending') {
    return el('span', { class: 'pill' }, r.status);
  }
  const yesBtn = el('button', { class: 'small', onclick: () => respondReference(r.id, true) }, 'Confirm');
  const noBtn = el('button', { class: 'small secondary', onclick: () => respondReference(r.id, false) }, 'Decline');
  return el('div', { style: 'display:flex; gap:6px;' }, [yesBtn, noBtn]);
}

async function respondReference(id, confirm) {
  try {
    await Api.post(`/api/business/references/${id}/respond`, { confirm, duration: confirm ? prompt('Duration of relationship (e.g. 2024–2026)?') || '' : undefined });
    refreshReferences();
  } catch (e) {
    alert(e.message);
  }
}

// ---------------------------------------------------------------------
// Reviews tab (read-only here — reviews are left by others on the public page)
// ---------------------------------------------------------------------

async function renderReviewsTab(panel) {
  panel.innerHTML = '';
  const card = el('div', { class: 'card' }, [
    el('h2', {}, 'Reviews about your business'),
    el('p', { class: 'muted', style: 'font-size:0.85rem;' }, 'Anyone can leave a review from your public passport page. Reviews from businesses with a confirmed reference are marked "Verified transaction".'),
  ]);
  const mount = el('div', {}, [el('p', { class: 'muted' }, 'Loading…')]);
  card.appendChild(mount);
  panel.appendChild(card);

  try {
    const pub = await Api.get('/api/public/business/' + CURRENT_BUSINESS.passportId);
    mount.innerHTML = '';
    if (pub.reviews.length === 0) {
      mount.appendChild(el('div', { class: 'empty-state' }, 'No reviews yet.'));
      return;
    }
    pub.reviews.slice().reverse().forEach((r) => {
      mount.appendChild(el('div', { class: 'list-row' }, [
        el('div', {}, [
          el('div', {}, [
            el('span', { class: 'stars' }, stars(r.rating)),
            r.verifiedTransaction ? el('span', { class: 'pill', style: 'margin-left:8px;' }, 'Verified transaction ✓') : null,
          ]),
          el('div', {}, escapeHtml(r.comment)),
          el('div', { class: 'muted', style: 'font-size:0.8rem;' }, `${escapeHtml(r.authorName)} · ${formatDate(r.createdAt)}`),
        ]),
      ]));
    });
  } catch (e) {
    mount.innerHTML = '';
    mount.appendChild(el('div', { class: 'alert alert-error' }, e.message));
  }
}

// ---------------------------------------------------------------------
// Verification requests tab
// ---------------------------------------------------------------------

async function renderRequestsTab(panel) {
  panel.innerHTML = '';
  const card = el('div', { class: 'card' }, [
    el('h2', {}, 'Verification requests'),
    el('p', { class: 'muted', style: 'font-size:0.85rem;' }, 'Banks and companies can request to verify your business. Authorize only requests you recognize.'),
  ]);
  const mount = el('div', {}, [el('p', { class: 'muted' }, 'Loading…')]);
  card.appendChild(mount);
  panel.appendChild(card);

  try {
    const list = await Api.get('/api/business/verification-requests');
    mount.innerHTML = '';
    if (list.length === 0) {
      mount.appendChild(el('div', { class: 'empty-state' }, 'No verification requests yet.'));
      return;
    }
    list.slice().reverse().forEach((r) => {
      mount.appendChild(el('div', { class: 'list-row' }, [
        el('div', {}, [
          el('div', {}, [el('strong', {}, r.requesterName), el('span', { class: 'muted' }, ` wants to verify your business`)]),
          el('div', { class: 'muted', style: 'font-size:0.85rem;' }, `Purpose: ${escapeHtml(r.purpose)}`),
          r.checks.length ? el('div', { style: 'margin-top:4px;' }, r.checks.map((c) => el('span', { class: 'pill' }, c))) : null,
        ]),
        r.status === 'pending'
          ? el('div', { style: 'display:flex; gap:6px;' }, [
              el('button', { class: 'small', onclick: () => respondVerificationRequest(r.id, true) }, 'Authorize'),
              el('button', { class: 'small secondary', onclick: () => respondVerificationRequest(r.id, false) }, 'Decline'),
            ])
          : el('span', { class: 'pill' }, r.status),
      ]));
    });
  } catch (e) {
    mount.innerHTML = '';
    mount.appendChild(el('div', { class: 'alert alert-error' }, e.message));
  }
}

async function respondVerificationRequest(id, authorize) {
  try {
    await Api.post(`/api/business/verification-requests/${id}/respond`, { authorize });
    renderRequestsTab(document.getElementById('tab-panel-requests'));
  } catch (e) {
    alert(e.message);
  }
}

// ---------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------

function renderSettingsTab(panel) {
  panel.innerHTML = '';
  const b = CURRENT_BUSINESS;
  const alertBox = el('div', {});

  const fields = {
    region: el('input', { type: 'text', value: b.region || '' }),
    city: el('input', { type: 'text', value: b.city || '' }),
    industry: el('input', { type: 'text', value: b.industry || '' }),
    businessType: el('input', { type: 'text', value: b.businessType || '' }),
    phone: el('input', { type: 'tel', value: b.phone || '' }),
    website: el('input', { type: 'url', value: b.website || '' }),
    address: el('input', { type: 'text', value: b.address || '' }),
    description: el('textarea', {}, b.description || ''),
  };
  const discoverable = el('input', { type: 'checkbox' });
  discoverable.checked = b.discoverable !== false;

  const submitBtn = el('button', { type: 'submit' }, 'Save changes');
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      showAlert(alertBox, null);
      submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
      try {
        const payload = { discoverable: discoverable.checked };
        Object.entries(fields).forEach(([k, node]) => { payload[k] = node.value; });
        await Api.patch('/api/business', payload);
        showAlert(alertBox, 'Saved.', 'success');
        CURRENT_BUSINESS = await Api.get('/api/my-business');
      } catch (err) {
        showAlert(alertBox, err.message);
      } finally {
        submitBtn.disabled = false; submitBtn.textContent = 'Save changes';
      }
    },
  }, [
    el('div', { class: 'field' }, [el('label', {}, 'Region'), fields.region]),
    el('div', { class: 'field' }, [el('label', {}, 'City'), fields.city]),
    el('div', { class: 'field' }, [el('label', {}, 'Industry'), fields.industry]),
    el('div', { class: 'field' }, [el('label', {}, 'Business type'), fields.businessType]),
    el('div', { class: 'field' }, [el('label', {}, 'Phone'), fields.phone]),
    el('div', { class: 'field' }, [el('label', {}, 'Website'), fields.website]),
    el('div', { class: 'field' }, [el('label', {}, 'Address'), fields.address]),
    el('div', { class: 'field' }, [el('label', {}, 'Description'), fields.description]),
    el('div', { class: 'field' }, [
      el('label', { style: 'display:flex; align-items:center; gap:8px; font-weight:400;' }, [discoverable, 'Listed in the public directory']),
    ]),
    el('div', { class: 'form-actions' }, [submitBtn]),
  ]);

  panel.appendChild(el('div', { class: 'card' }, [el('h2', {}, 'Edit business profile'), alertBox, form]));
}

document.addEventListener('DOMContentLoaded', initDashboard);
