'use strict';

function getPassportIdFromUrl() {
  const parts = window.location.pathname.split('/').filter(Boolean); // ['verify', 'AFR-GH-XXXX']
  return decodeURIComponent(parts[1] || '');
}

async function initVerifyPage() {
  const root = document.getElementById('verify-root');
  const passportId = getPassportIdFromUrl();
  if (!passportId) {
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'alert alert-error' }, 'No AfriPass ID provided.'));
    return;
  }

  let business;
  try {
    business = await Api.get('/api/public/business/' + encodeURIComponent(passportId));
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'card' }, [
      el('h1', {}, 'Not found'),
      el('p', { class: 'muted' }, `No business found with ID "${escapeHtml(passportId)}".`),
      el('a', { class: 'btn small', href: '/directory.html' }, 'Search the directory'),
    ]));
    return;
  }

  renderPassport(root, business);
}

function renderPassport(root, b) {
  root.innerHTML = '';
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(window.location.href)}`;

  root.appendChild(el('div', { class: 'card two-col' }, [
    el('div', { class: 'main' }, [
      el('div', { class: 'muted', style: 'text-transform:uppercase; font-size:0.75rem; letter-spacing:1px;' }, 'AfriPass Business Passport'),
      el('h1', {}, b.name),
      el('div', { class: 'passport-id', style: 'margin-bottom:8px;' }, b.passportId),
      el('span', { class: `badge-status status-${b.status}` }, statusBadgeText(b)),
      el('div', { class: 'muted', style: 'margin-top:10px;' }, levelLabel(b.verificationLevel)),
      el('div', { class: 'grid-2', style: 'margin-top:16px;' }, [
        infoRowV('Country', b.country),
        infoRowV('Region', b.region || '—'),
        infoRowV('City', b.city || '—'),
        infoRowV('Industry', b.industry || '—'),
      ]),
    ]),
    el('div', { class: 'side qr-box' }, [
      scoreCircleV(b.trustScore),
      el('img', { src: qrUrl, alt: 'QR code', width: '140', height: '140', style: 'margin-top:14px;' }),
    ]),
  ]));

  root.appendChild(el('div', { class: 'card' }, [
    el('h2', {}, 'Trust Score'),
    scoreRowsV(b.trustScoreBreakdown),
    el('p', { class: 'muted', style: 'margin-top:12px; font-size:0.82rem;' },
      "AfriPass's trust score is an informational indicator and is not a guarantee of financial performance, solvency or future conduct."),
  ]));

  root.appendChild(el('div', { class: 'card' }, [
    el('h2', {}, 'Verification checklist'),
    checklistRow('Business verification', b.status === 'verified' || b.status === 'business_verified'),
    checklistRow('Representative verified', b.representativeVerified),
    checklistRow('Documents verified', b.documentsVerified),
    checklistRow('Verified references', b.verifiedReferenceCount > 0),
    b.documentTypesVerified.length
      ? el('p', { class: 'muted', style: 'font-size:0.85rem; margin-top:8px;' },
          'Verified document types: ' + b.documentTypesVerified.map(docTypeLabel).join(', '))
      : null,
  ]));

  root.appendChild(el('div', { class: 'card' }, [
    el('h2', {}, `Verified references (${b.verifiedReferenceCount})`),
    b.verifiedReferenceCount > 0
      ? el('p', { class: 'muted' }, `${b.verifiedReferenceCount} verified business relationship${b.verifiedReferenceCount === 1 ? '' : 's'} on file.`)
      : el('p', { class: 'muted' }, 'No verified references yet.'),
  ]));

  root.appendChild(renderReviewsSection(b));
  root.appendChild(renderVerificationRequestSection(b));
}

function docTypeLabel(t) {
  const map = {
    registration_certificate: 'Business Registration Certificate',
    incorporation_certificate: 'Certificate of Incorporation',
    business_profile: 'Business Profile',
    license: 'Licence',
    tax_document: 'Tax Document',
    other: 'Other',
  };
  return map[t] || t;
}

function statusBadgeText(b) {
  if (b.status === 'verified' || b.status === 'business_verified') return '✓ BUSINESS VERIFIED';
  return statusLabel(b.status).toUpperCase();
}

function infoRowV(label, value) {
  return el('div', {}, [el('div', { class: 'muted', style: 'font-size:0.78rem;' }, label), el('div', {}, value)]);
}

function scoreCircleV(score) {
  return el('div', { class: 'score-circle', style: `--pct:${score}` }, [
    el('div', { class: 'inner' }, [el('div', { class: 'num' }, String(score)), el('div', { class: 'denom' }, '/ 100')]),
  ]);
}

function scoreRowsV(breakdown) {
  return el('div', {}, [
    el('div', { class: 'score-row' }, [el('span', {}, 'Business verification'), el('strong', {}, `+${breakdown.businessVerification}`)]),
    el('div', { class: 'score-row' }, [el('span', {}, 'Documents verified'), el('strong', {}, `+${breakdown.documents}`)]),
    el('div', { class: 'score-row' }, [el('span', {}, 'Verified references'), el('strong', {}, `+${breakdown.references}`)]),
    el('div', { class: 'score-row' }, [el('span', {}, 'Reviews'), el('strong', {}, `+${breakdown.reviews}`)]),
  ]);
}

function checklistRow(label, ok) {
  return el('div', { class: 'list-row' }, [
    el('span', {}, label),
    el('span', { style: `color:${ok ? '#1e8a5f' : '#8a94a3'}; font-weight:700;` }, ok ? '✓' : '—'),
  ]);
}

function renderReviewsSection(b) {
  const card = el('div', { class: 'card' }, [el('h2', {}, `Reviews (${b.reviews.length})`)]);
  if (b.reviews.length === 0) {
    card.appendChild(el('p', { class: 'muted' }, 'No reviews yet. Be the first to leave one.'));
  } else {
    b.reviews.slice().reverse().forEach((r) => {
      card.appendChild(el('div', { class: 'list-row' }, [
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
  }

  const alertBox = el('div', {});
  const nameInput = el('input', { type: 'text', placeholder: 'Your name or business', required: true });
  const ratingSelect = el('select', {}, [5, 4, 3, 2, 1].map((n) => el('option', { value: n }, `${n} star${n === 1 ? '' : 's'}`)));
  const commentInput = el('textarea', { placeholder: 'Share your experience…', required: true });
  const submitBtn = el('button', { type: 'submit' }, 'Post review');

  const form = el('form', {
    style: 'margin-top:14px; border-top:1px solid var(--border); padding-top:14px;',
    onsubmit: async (e) => {
      e.preventDefault();
      showAlert(alertBox, null);
      submitBtn.disabled = true; submitBtn.textContent = 'Posting…';
      try {
        await Api.post(`/api/business/${encodeURIComponent(b.passportId)}/reviews`, {
          authorName: nameInput.value.trim(),
          rating: Number(ratingSelect.value),
          comment: commentInput.value.trim(),
        });
        showAlert(alertBox, 'Review posted.', 'success');
        nameInput.value = ''; commentInput.value = '';
        const fresh = await Api.get('/api/public/business/' + encodeURIComponent(b.passportId));
        renderPassport(document.getElementById('verify-root'), fresh);
      } catch (err) {
        showAlert(alertBox, err.message);
      } finally {
        submitBtn.disabled = false; submitBtn.textContent = 'Post review';
      }
    },
  }, [
    el('h3', {}, 'Leave a review'),
    alertBox,
    el('div', { class: 'field' }, [el('label', {}, 'Name'), nameInput]),
    el('div', { class: 'field' }, [el('label', {}, 'Rating'), ratingSelect]),
    el('div', { class: 'field' }, [el('label', {}, 'Comment'), commentInput]),
    el('div', { class: 'form-actions' }, [submitBtn]),
  ]);
  card.appendChild(form);
  return card;
}

function renderVerificationRequestSection(b) {
  const alertBox = el('div', {});
  const requesterInput = el('input', { type: 'text', placeholder: 'Your organization name', required: true });
  const purposeInput = el('input', { type: 'text', placeholder: 'e.g. Business onboarding', required: true });
  const checks = ['Business identity', 'Registration', 'Representative', 'Documents'];
  const checkboxes = checks.map((c) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = true;
    cb.dataset.label = c;
    return el('label', { style: 'display:flex; align-items:center; gap:6px; font-weight:400; margin-bottom:6px;' }, [cb, c]);
  });
  const submitBtn = el('button', { type: 'submit' }, 'Submit verification request');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      showAlert(alertBox, null);
      submitBtn.disabled = true; submitBtn.textContent = 'Submitting…';
      try {
        const selectedChecks = checkboxes
          .filter((label) => label.querySelector('input').checked)
          .map((label) => label.querySelector('input').dataset.label);
        await Api.post('/api/verification-requests', {
          passportId: b.passportId,
          requesterName: requesterInput.value.trim(),
          purpose: purposeInput.value.trim(),
          checks: selectedChecks,
        });
        showAlert(alertBox, 'Request submitted. The business will need to authorize it.', 'success');
        requesterInput.value = ''; purposeInput.value = '';
      } catch (err) {
        showAlert(alertBox, err.message);
      } finally {
        submitBtn.disabled = false; submitBtn.textContent = 'Submit verification request';
      }
    },
  }, [
    alertBox,
    el('div', { class: 'field' }, [el('label', {}, 'Your organization'), requesterInput]),
    el('div', { class: 'field' }, [el('label', {}, 'Purpose'), purposeInput]),
    el('div', { class: 'field' }, [el('label', {}, 'Requested checks'), ...checkboxes]),
    el('div', { class: 'form-actions' }, [submitBtn]),
  ]);

  return el('div', { class: 'card' }, [
    el('h2', {}, 'Bank or enterprise? Request formal verification'),
    el('p', { class: 'muted', style: 'font-size:0.85rem;' }, 'For onboarding, KYB checks or due diligence. The business must authorize your request before it is fulfilled.'),
    form,
  ]);
}

document.addEventListener('DOMContentLoaded', initVerifyPage);
