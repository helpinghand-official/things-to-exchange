/**
 * app.js — DOM wiring for Kampong Basket.
 * Uses KampongStore (store.js) for data and KampongI18n (i18n.js) for text.
 */
(function () {
  'use strict';

  const store = KampongStore.createStore(); // defaults to localStorage in the browser
  let lang = localStorage.getItem('kb_lang') || 'en';
  let needItemCount = 0;
  let offerItemCount = 0;

  // ---------------------------------------------------------------
  // i18n rendering
  // ---------------------------------------------------------------
  function applyI18n() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = KampongI18n.t(lang, el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = KampongI18n.t(lang, el.getAttribute('data-i18n-placeholder'));
    });
    document.querySelectorAll('.lang-switch button').forEach((b) => {
      b.classList.toggle('active', b.dataset.lang === lang);
    });
  }

  function setLang(newLang) {
    lang = newLang;
    localStorage.setItem('kb_lang', lang);
    applyI18n();
    // Re-render dynamic content that isn't tag-driven
    renderTrackResult(lastTrackResult);
    renderVolunteerBoard();
  }

  function tr(key) { return KampongI18n.t(lang, key); }

  // ---------------------------------------------------------------
  // View routing (single page, section show/hide)
  // ---------------------------------------------------------------
  function showView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('nav.main-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'volunteer') renderVolunteerBoard();
  }

  // ---------------------------------------------------------------
  // Helpers: image + voice capture
  // ---------------------------------------------------------------
  function wireImageInput(fileInput, previewImg) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        previewImg.src = reader.result;
        previewImg.style.display = 'block';
        fileInput.dataset.imageData = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function wireVoiceInput(recordBtn, statusSpan, hiddenAudioHolder) {
    let mediaRecorder = null;
    let chunks = [];
    recordBtn.addEventListener('click', async () => {
      if (recordBtn.dataset.recording === 'true') {
        mediaRecorder && mediaRecorder.stop();
        return;
      }
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        statusSpan.textContent = 'Voice recording is not supported in this browser.';
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onload = () => { hiddenAudioHolder.dataset.audioData = reader.result; };
          reader.readAsDataURL(blob);
          stream.getTracks().forEach((t) => t.stop());
          recordBtn.dataset.recording = 'false';
          recordBtn.textContent = tr('record_voice');
          statusSpan.textContent = 'Recorded ✓';
        };
        mediaRecorder.start();
        recordBtn.dataset.recording = 'true';
        recordBtn.textContent = tr('stop_voice');
        statusSpan.textContent = '● recording…';
      } catch (err) {
        statusSpan.textContent = 'Microphone permission denied.';
      }
    });
  }

  // ---------------------------------------------------------------
  // Dynamic item rows — Need form
  // ---------------------------------------------------------------
  function addNeedItemRow() {
    needItemCount += 1;
    const idx = needItemCount;
    const wrap = document.createElement('div');
    wrap.className = 'item-card';
    wrap.dataset.idx = idx;
    wrap.innerHTML = `
      <button type="button" class="remove-x" aria-label="${tr('remove_item')}" data-remove>&times;</button>
      <label data-i18n="item_name">${tr('item_name')}</label>
      <input type="text" required class="f-item-name" placeholder="${tr('item_name')}">
      <div class="field-row">
        <div>
          <label data-i18n="item_qty">${tr('item_qty')}</label>
          <input type="text" class="f-item-qty" placeholder="e.g. 2 packets">
        </div>
        <div>
          <label data-i18n="item_timeline">${tr('item_timeline')}</label>
          <input type="date" class="f-item-timeline">
        </div>
      </div>
      <label data-i18n="item_image">${tr('item_image')}</label>
      <input type="file" accept="image/*" class="f-item-image">
      <img class="thumb-preview" alt="">
      <label data-i18n="item_voice">${tr('item_voice')}</label>
      <div style="display:flex;align-items:center;gap:10px;">
        <button type="button" class="btn small secondary f-voice-btn">${tr('record_voice')}</button>
        <span class="hint f-voice-status"></span>
      </div>
    `;
    document.getElementById('need-items-wrap').appendChild(wrap);
    wireImageInput(wrap.querySelector('.f-item-image'), wrap.querySelector('.thumb-preview'));
    wireVoiceInput(wrap.querySelector('.f-voice-btn'), wrap.querySelector('.f-voice-status'), wrap);
    wrap.querySelector('[data-remove]').addEventListener('click', () => wrap.remove());
  }

  function addOfferItemRow() {
    offerItemCount += 1;
    const idx = offerItemCount;
    const wrap = document.createElement('div');
    wrap.className = 'item-card';
    wrap.dataset.idx = idx;
    wrap.innerHTML = `
      <button type="button" class="remove-x" aria-label="${tr('remove_item')}" data-remove>&times;</button>
      <label data-i18n="item_name">${tr('item_name')}</label>
      <input type="text" required class="f-item-name" placeholder="${tr('item_name')}">
      <label data-i18n="item_qty">${tr('item_qty')}</label>
      <input type="text" class="f-item-qty" placeholder="e.g. 5kg">
      <label data-i18n="item_image">${tr('item_image')}</label>
      <input type="file" accept="image/*" class="f-item-image">
      <img class="thumb-preview" alt="">
    `;
    document.getElementById('offer-items-wrap').appendChild(wrap);
    wireImageInput(wrap.querySelector('.f-item-image'), wrap.querySelector('.thumb-preview'));
    wrap.querySelector('[data-remove]').addEventListener('click', () => wrap.remove());
  }

  function collectNeedItems() {
    return Array.from(document.querySelectorAll('#need-items-wrap .item-card')).map((card) => ({
      name: card.querySelector('.f-item-name').value.trim(),
      qty: card.querySelector('.f-item-qty').value.trim(),
      timeline: card.querySelector('.f-item-timeline').value || null,
      imageData: card.querySelector('.f-item-image').dataset.imageData || null,
      note: card.dataset.audioData ? '(voice note attached)' : '',
    })).filter((it) => it.name);
  }

  function collectOfferItems() {
    return Array.from(document.querySelectorAll('#offer-items-wrap .item-card')).map((card) => ({
      name: card.querySelector('.f-item-name').value.trim(),
      qty: card.querySelector('.f-item-qty').value.trim(),
      imageData: card.querySelector('.f-item-image').dataset.imageData || null,
    })).filter((it) => it.name);
  }

  // ---------------------------------------------------------------
  // Need form submit
  // ---------------------------------------------------------------
  function wireNeedForm() {
    const form = document.getElementById('need-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const items = collectNeedItems();
      const errBox = document.getElementById('need-error');
      errBox.style.display = 'none';
      if (items.length === 0) {
        errBox.textContent = tr('required') + ' (' + tr('items_needed') + ')';
        errBox.style.display = 'block';
        return;
      }
      const record = store.addNeedRequest({
        requesterName: document.getElementById('need-requester-name').value.trim(),
        contact: document.getElementById('need-contact').value.trim(),
        submittedBy: document.getElementById('need-submitted-by').value,
        urgency: Number(document.getElementById('need-urgency').value),
        notes: document.getElementById('need-notes').value.trim(),
        pin: document.getElementById('need-pin').value.trim() || null,
        items,
      });
      form.style.display = 'none';
      const successBox = document.getElementById('need-success');
      successBox.style.display = 'block';
      successBox.querySelector('.ref-id').textContent = record.id;
    });
  }

  function wireOfferForm() {
    const form = document.getElementById('offer-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const items = collectOfferItems();
      const errBox = document.getElementById('offer-error');
      errBox.style.display = 'none';
      if (items.length === 0) {
        errBox.textContent = tr('required') + ' (' + tr('items_offered') + ')';
        errBox.style.display = 'block';
        return;
      }
      const mode = document.querySelector('input[name="offer-mode"]:checked').value;
      const record = store.addDonation({
        donorName: document.getElementById('offer-donor-name').value.trim(),
        contact: document.getElementById('offer-contact').value.trim(),
        mode,
        collectionAddress: document.getElementById('offer-address').value.trim(),
        notes: document.getElementById('offer-notes').value.trim(),
        pin: document.getElementById('offer-pin').value.trim() || null,
        items,
      });
      form.style.display = 'none';
      const successBox = document.getElementById('offer-success');
      successBox.style.display = 'block';
      successBox.querySelector('.ref-id').textContent = record.id;
    });
  }

  // ---------------------------------------------------------------
  // Track status
  // ---------------------------------------------------------------
  let lastTrackResult = null;

  function statusChip(status) {
    return `<span class="item-status-chip status-${status}"><span class="chip-basket"></span>${tr('status_' + status)}</span>`;
  }

  function renderTrackResult(result) {
    const out = document.getElementById('track-result');
    if (!out) return;
    if (!result) { out.innerHTML = ''; return; }
    if (result === 'not_found') {
      out.innerHTML = `<div class="error-box">${tr('not_found')}</div>`;
      return;
    }
    if (result === 'wrong_pin') {
      out.innerHTML = `<div class="error-box">${tr('wrong_pin')}</div>`;
      return;
    }
    const { type, record, messages } = result;
    let itemsHtml = '';
    if (type === 'need') {
      itemsHtml = record.items.map((it) => `
        <div class="item-line is-${it.status}">
          <div>
            <div class="item-name">${escapeHtml(it.name)}</div>
            <div class="item-meta">${it.qty ? escapeHtml(it.qty) + ' · ' : ''}${it.itemId}</div>
          </div>
          ${statusChip(it.status)}
        </div>`).join('');
    } else {
      itemsHtml = record.items.map((it) => `
        <div class="item-line is-${it.status}">
          <div>
            <div class="item-name">${escapeHtml(it.name)}</div>
            <div class="item-meta">${it.qty ? escapeHtml(it.qty) + ' · ' : ''}${it.itemId}</div>
          </div>
          ${statusChip(it.status)}
        </div>`).join('');
    }
    const msgHtml = messages.map((m) => `<li><time>${new Date(m.at).toLocaleString()}</time>${escapeHtml(m.text)}</li>`).join('');
    out.innerHTML = `
      <div class="panel" style="margin-top:20px;">
        <span class="ref-id">${record.id}</span>
        <h3>${type === 'need' ? tr('items_needed') : tr('items_offered')}</h3>
        ${itemsHtml}
        <h3 style="margin-top:22px;">${tr('messages_title')}</h3>
        <ul class="messages-list">${msgHtml || '<li>—</li>'}</ul>
      </div>
    `;
  }

  function wireTrackForm() {
    const form = document.getElementById('track-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ref = document.getElementById('track-ref').value.trim().toUpperCase();
      const pin = document.getElementById('track-pin').value.trim();
      const status = store.getStatus(ref);
      if (!status) { lastTrackResult = 'not_found'; renderTrackResult(lastTrackResult); return; }
      if (!store.verifyPin(ref, pin)) { lastTrackResult = 'wrong_pin'; renderTrackResult(lastTrackResult); return; }
      lastTrackResult = status;
      renderTrackResult(lastTrackResult);
    });
  }

  // ---------------------------------------------------------------
  // Volunteer board
  // ---------------------------------------------------------------
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderVolunteerBoard() {
    const root = document.getElementById('view-volunteer');
    if (!root || !root.classList.contains('active')) {
      // still update counts even if not visible, cheap enough
    }
    const needs = store.listNeeds();
    const donations = store.listDonations();

    const pendingItems = [];
    needs.forEach((n) => n.items.forEach((it) => { if (it.status === 'pending') pendingItems.push({ n, it }); }));
    pendingItems.sort((a, b) => b.n.urgency - a.n.urgency || new Date(a.n.createdAt) - new Date(b.n.createdAt));

    const availableItems = [];
    donations.forEach((d) => d.items.forEach((it) => { if (it.status === 'available') availableItems.push({ d, it }); }));

    const matchedItems = [];
    needs.forEach((n) => n.items.forEach((it) => { if (it.status === 'matched') matchedItems.push({ n, it }); }));

    document.getElementById('vol-pending-count').textContent = pendingItems.length;
    document.getElementById('vol-available-count').textContent = availableItems.length;
    document.getElementById('vol-matched-count').textContent = matchedItems.length;

    document.getElementById('vol-pending-list').innerHTML = pendingItems.map(({ n, it }) => `
      <div class="item-line is-pending">
        <div>
          <div class="item-name">${escapeHtml(it.name)} <span class="hint">(${tr('urgency_label')} ${n.urgency})</span></div>
          <div class="item-meta">${it.itemId} · ${n.id}</div>
        </div>
        ${statusChip('pending')}
      </div>`).join('') || `<p class="hint">—</p>`;

    document.getElementById('vol-available-list').innerHTML = availableItems.map(({ d, it }) => `
      <div class="item-line is-available">
        <div>
          <div class="item-name">${escapeHtml(it.name)}</div>
          <div class="item-meta">${it.itemId} · ${d.id} · ${d.mode}</div>
        </div>
        ${statusChip('available')}
      </div>`).join('') || `<p class="hint">—</p>`;

    document.getElementById('vol-matched-list').innerHTML = matchedItems.map(({ n, it }) => `
      <div class="item-line">
        <div>
          <div class="item-name">${escapeHtml(it.name)}</div>
          <div class="item-meta">${it.itemId} · ${n.id} → ${it.matchedDonationItemId}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${statusChip('matched')}
          <button class="btn small gold" data-fulfil-need="${n.id}" data-fulfil-item="${it.itemId}">${tr('mark_collected')}</button>
        </div>
      </div>`).join('') || `<p class="hint">—</p>`;

    root.querySelectorAll('[data-fulfil-need]').forEach((btn) => {
      btn.addEventListener('click', () => {
        store.fulfil(btn.dataset.fulfilNeed, btn.dataset.fulfilItem);
        renderVolunteerBoard();
      });
    });

    // Audit trail
    const rows = store.auditTrail();
    document.getElementById('vol-audit-body').innerHTML = rows.map((r) => `
      <tr>
        <td>${r.donationItemId}</td>
        <td>${escapeHtml(r.itemName)}</td>
        <td>${statusChip(r.donationStatus)}</td>
        <td>${r.reservedForNeedItemId || '—'}</td>
      </tr>`).join('') || `<tr><td colspan="4">—</td></tr>`;
  }

  function wireVolunteerBoard() {
    document.getElementById('vol-run-matching').addEventListener('click', () => {
      const result = store.runMatching();
      const summary = document.getElementById('vol-match-summary');
      summary.style.display = 'block';
      summary.textContent = result.matchedCount > 0
        ? `${result.matchedCount} ${tr('matches_made')}`
        : tr('no_matches');
      renderVolunteerBoard();
    });
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  function init() {
    document.querySelectorAll('nav.main-nav button').forEach((b) => {
      b.addEventListener('click', () => showView(b.dataset.view));
    });
    document.querySelectorAll('[data-goto]').forEach((b) => {
      b.addEventListener('click', () => showView(b.dataset.goto));
    });
    document.querySelectorAll('.lang-switch button').forEach((b) => {
      b.addEventListener('click', () => setLang(b.dataset.lang));
    });

    document.getElementById('need-add-item').addEventListener('click', addNeedItemRow);
    document.getElementById('offer-add-item').addEventListener('click', addOfferItemRow);
    addNeedItemRow();
    addOfferItemRow();

    wireNeedForm();
    wireOfferForm();
    wireTrackForm();
    wireVolunteerBoard();

    applyI18n();
    showView('home');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
