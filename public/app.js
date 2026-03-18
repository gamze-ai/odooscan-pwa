/* OdooScan PWA — app.js */

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  currentScreen: 'home',
  docType: 'businessCard',
  fileBase64: null,
  fileMime: null,
  fileName: null,
  extractedFields: {},
  customFieldValues: {},
  matchStep: 'contact',       // 'contact' | 'company'
  selectedContactId: null,
  selectedCompanyId: null,
  contactCandidates: [],
  companyCandidates: [],
};

// ─── Config ───────────────────────────────────────────────────────────────────
function getConfig() {
  const raw = localStorage.getItem('odoo_config');
  return raw ? JSON.parse(raw) : {};
}

function saveConfig(cfg) {
  localStorage.setItem('odoo_config', JSON.stringify(cfg));
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  state.currentScreen = name;
  if (name === 'home') refreshHome();
  if (name === 'history') renderHistory();
  if (name === 'settings') loadSettingsForm();
  // Nav active state
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => {
    if (b.textContent.includes(navLabel(name))) b.classList.add('active');
  });
}

function navLabel(name) {
  return { home: 'Ana', history: 'Geçmiş', settings: 'Ayarlar' }[name] || '';
}

// ─── Home ─────────────────────────────────────────────────────────────────────
function refreshHome() {
  const cfg = getConfig();
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (cfg.url) {
    dot.className = 'dot green';
    txt.textContent = 'Bağlı: ' + cfg.url.replace(/https?:\/\//, '').split('/')[0];
  } else {
    dot.className = 'dot orange';
    txt.textContent = 'Odoo bağlantısı kurulmadı — Ayarlar\'dan yapılandırın';
  }
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  document.getElementById('hist-count-label').textContent = hist.length + ' tarama';
}

// ─── Upload ───────────────────────────────────────────────────────────────────
function startScan(type) {
  state.docType = type;
  state.fileBase64 = null;
  state.fileMime = null;
  state.fileName = null;

  const titles = { businessCard: 'Kartvizit Tara', handwrittenForm: 'Form Tara', pdf: 'PDF Yükle' };
  const icons  = { businessCard: '📸', handwrittenForm: '✍️', pdf: '📄' };
  const subs   = { businessCard: 'Kartvizit fotoğrafı', handwrittenForm: 'El yazısı form', pdf: 'PDF dosyası (.pdf)' };

  document.getElementById('upload-title').innerHTML = titles[type].replace(' ', ' <span>') + '</span>';
  document.getElementById('uz-icon').textContent = icons[type];
  document.getElementById('uz-title').textContent = 'Dosya Seç veya Çek';
  document.getElementById('uz-sub').textContent = subs[type];

  const input = document.getElementById('file-input');
  input.accept = type === 'pdf' ? 'application/pdf' : 'image/*';
  input.removeAttribute('capture');
  if (type !== 'pdf') input.setAttribute('capture', 'environment');

  document.getElementById('preview-img').style.display = 'none';
  document.getElementById('extract-btn').disabled = true;
  document.getElementById('ai-loader').classList.remove('show');

  showScreen('upload');
}

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.fileMime = file.type;
  state.fileName = file.name;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const b64 = ev.target.result.split(',')[1];
    state.fileBase64 = b64;

    if (file.type.startsWith('image/')) {
      const img = document.getElementById('preview-img');
      img.src = ev.target.result;
      img.style.display = 'block';
    } else {
      document.getElementById('preview-img').style.display = 'none';
      document.getElementById('uz-title').textContent = file.name;
      document.getElementById('uz-sub').textContent = (file.size / 1024).toFixed(0) + ' KB';
    }
    document.getElementById('extract-btn').disabled = false;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// ─── Extract ─────────────────────────────────────────────────────────────────
async function doExtract() {
  if (!state.fileBase64) { toast('Önce bir dosya seçin', 'error'); return; }
  const cfg = getConfig();
  if (!cfg.backendUrl) { toast('Ayarlar\'dan Backend URL girin', 'error'); return; }

  document.getElementById('extract-btn').disabled = true;
  const loader = document.getElementById('ai-loader');
  loader.classList.add('show');

  const msgs = ['AI bilgileri çıkarıyor...', 'OCR işleniyor...', 'Alanlar eşleştiriliyor...'];
  let mi = 0;
  const msgInterval = setInterval(() => {
    document.getElementById('ai-msg').textContent = msgs[mi++ % msgs.length];
  }, 1800);

  try {
    const customFields = cfg.customFields || [];
    const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_base64: state.fileBase64,
        mime_type: state.fileMime,
        document_type: state.docType,
        custom_fields: customFields,
      }),
    });
    if (!res.ok) throw new Error('Sunucu hatası: ' + res.status);
    const data = await res.json();
    state.extractedFields = data.contact_fields || {};
    state.customFieldValues = data.custom_fields || {};
    renderPreviewFields();
    showScreen('preview');
  } catch (err) {
    toast('Hata: ' + err.message, 'error');
  } finally {
    clearInterval(msgInterval);
    loader.classList.remove('show');
    document.getElementById('extract-btn').disabled = false;
  }
}

// ─── Preview Fields ───────────────────────────────────────────────────────────
const CONTACT_FIELD_LABELS = {
  name: 'Ad Soyad', company: 'Şirket', job_title: 'Unvan',
  phone: 'Telefon', mobile: 'Cep Telefonu', email: 'E-posta',
  website: 'Web Sitesi', street: 'Adres', city: 'Şehir',
  country: 'Ülke', notes: 'Notlar',
};

function renderPreviewFields() {
  const container = document.getElementById('contact-fields');
  container.innerHTML = Object.entries(CONTACT_FIELD_LABELS).map(([key, label]) => `
    <div class="field-row">
      <div class="field-label">${label}</div>
      <input class="field-input" id="pf-${key}" value="${esc(state.extractedFields[key] || '')}"
        placeholder="${label}..." oninput="state.extractedFields['${key}']=this.value"/>
    </div>
  `).join('');

  // Özel alanlar
  const cfg = getConfig();
  const cFields = cfg.customFields || [];
  const customContainer = document.getElementById('custom-fields-container');
  document.getElementById('custom-section-label').style.display = cFields.length ? '' : 'none';
  customContainer.innerHTML = cFields.map(f => `
    <div class="field-row">
      <div class="field-label" style="color:var(--accent)">${f.label}</div>
      <input class="field-input" id="cf-${f.key}" value="${esc(state.customFieldValues[f.key] || '')}"
        placeholder="${f.label}..." oninput="state.customFieldValues['${f.key}']=this.value"/>
    </div>
  `).join('');
}

// ─── Match Screen ─────────────────────────────────────────────────────────────
async function goToMatchScreen() {
  // Güncel değerleri inputlardan oku
  Object.keys(CONTACT_FIELD_LABELS).forEach(key => {
    const el = document.getElementById('pf-' + key);
    if (el) state.extractedFields[key] = el.value;
  });

  state.matchStep = 'contact';
  state.selectedContactId = null;
  state.selectedCompanyId = null;

  document.getElementById('match-back-btn').onclick = () => showScreen('preview');
  document.getElementById('match-title').innerHTML = 'Kontak <span>Kontrolü</span>';

  showScreen('match');
  await runContactCheck();
}

async function runContactCheck() {
  const cfg = getConfig();
  if (!cfg.url) {
    renderMatchNoOdoo();
    return;
  }

  document.getElementById('match-body').innerHTML = `
    <div class="ai-loader show"><div class="pulse-ring"></div><p>Odoo'da kontak aranıyor...</p></div>`;

  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/check-contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        odoo_config: { url: cfg.url, db: cfg.db, username: cfg.username, api_key: cfg.apiKey },
        name: state.extractedFields.name || '',
        company_name: state.extractedFields.company || '',
        email: state.extractedFields.email || '',
        phone: state.extractedFields.phone || state.extractedFields.mobile || '',
      }),
    });
    const data = await res.json();
    state.contactCandidates = data.contact_candidates || [];
    state.companyCandidates = data.company_candidates || [];
    renderContactStep();
  } catch (err) {
    document.getElementById('match-body').innerHTML =
      `<div style="padding:24px;text-align:center;color:var(--danger)">Kontrol yapılamadı: ${err.message}</div>`;
  }
}

function renderContactStep() {
  const f = state.extractedFields;
  const candidates = state.contactCandidates;

  let html = `
    <div class="match-header">
      <div class="name">${esc(f.name || '—')}</div>
      ${f.company ? `<div class="company">${esc(f.company)}</div>` : ''}
      ${f.email ? `<div class="detail">✉ ${esc(f.email)}</div>` : ''}
      ${(f.phone || f.mobile) ? `<div class="detail">📞 ${esc(f.phone || f.mobile)}</div>` : ''}
    </div>`;

  if (candidates.length > 0) {
    html += `
      <p class="section-label">${candidates.length} BENZER KONTAK BULUNDU</p>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px">Bunlardan biri mi? Seçin veya yeni oluşturun.</p>`;

    candidates.forEach(c => {
      html += `
        <div class="candidate-card ${c.match_type}" onclick="selectContact(${c.id})">
          <div class="candidate-info">
            <div class="candidate-name">${esc(c.name)}</div>
            ${c.company ? `<div class="candidate-company">${esc(c.company)}</div>` : ''}
          </div>
          <div class="score-badge ${c.match_type}">%${c.score}</div>
        </div>`;
    });

    html += `<div class="divider"><div class="divider-line"></div><span class="divider-txt">veya</span><div class="divider-line"></div></div>`;
  } else {
    html += `
      <div style="background:var(--surface);border-radius:var(--radius);padding:24px;text-align:center;margin-bottom:20px">
        <div style="font-size:36px;margin-bottom:10px">🔍</div>
        <div style="font-family:var(--font-head);font-size:15px;font-weight:700;margin-bottom:6px">Eşleşen kontak bulunamadı</div>
        <div style="font-size:13px;color:var(--muted)">Yeni bir kontak kaydı oluşturulacak.</div>
      </div>`;
  }

  html += `
    <button class="btn-primary" onclick="selectContact(null)" style="background:var(--accent2);color:#fff">
      ➕ Yeni Kontak Oluştur
      <span style="display:block;font-size:11px;font-weight:400;margin-top:2px;opacity:.8">${esc(f.name)} adıyla kayıt açılacak</span>
    </button>`;

  document.getElementById('match-body').innerHTML = html;
}

function selectContact(id) {
  state.selectedContactId = id;
  state.matchStep = 'company';

  document.getElementById('match-back-btn').onclick = () => {
    state.matchStep = 'contact';
    renderContactStep();
  };
  document.getElementById('match-title').innerHTML = 'Şirket <span>Kontrolü</span>';
  renderCompanyStep();
}

function renderCompanyStep() {
  const f = state.extractedFields;
  const candidates = state.companyCandidates;

  // Step indicator
  let html = `
    <div class="step-row">
      <div class="step-dot done">✓</div>
      <div class="step-line done"></div>
      <div class="step-dot active">2</div>
      <div class="step-line idle"></div>
      <div class="step-dot idle">3</div>
    </div>`;

  if (!f.company) {
    html += `
      <div style="background:var(--surface);border-radius:var(--radius);padding:24px;text-align:center;margin-bottom:20px">
        <div style="font-size:13px;color:var(--muted)">Belgede şirket adı bulunamadı</div>
      </div>
      <button class="btn-primary" onclick="proceedToSave(null)">Şirketsiz Devam Et</button>`;
  } else {
    html += `
      <div class="match-header">
        <div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px;margin-bottom:4px">ŞİRKET</div>
        <div class="name">${esc(f.company)}</div>
      </div>`;

    if (candidates.length > 0) {
      html += `<p class="section-label">BENZER ŞİRKETLER</p>`;
      candidates.forEach(c => {
        html += `
          <div class="candidate-card ${c.match_type}" onclick="selectCompany(${c.id})">
            <div class="candidate-info">
              <div class="candidate-name">${esc(c.name)}</div>
            </div>
            <div class="score-badge ${c.match_type}">%${c.score}</div>
          </div>`;
      });
      html += `<div class="divider"><div class="divider-line"></div><span class="divider-txt">veya</span><div class="divider-line"></div></div>`;
    }

    html += `
      <button class="btn-primary" onclick="selectCompany(null)" style="background:var(--accent2);color:#fff">
        ➕ Yeni Şirket Oluştur
        <span style="display:block;font-size:11px;font-weight:400;margin-top:2px;opacity:.8">${esc(f.company)} adıyla açılacak</span>
      </button>`;
  }

  document.getElementById('match-body').innerHTML = html;
}

function selectCompany(id) {
  state.selectedCompanyId = id;
  proceedToSave(id);
}

// ─── Send to Odoo ─────────────────────────────────────────────────────────────
async function proceedToSave(companyId) {
  const cfg = getConfig();
  document.getElementById('match-body').innerHTML = `
    <div class="ai-loader show"><div class="pulse-ring"></div><p>Odoo'ya kaydediliyor...</p></div>`;

  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/send-to-odoo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        odoo_config: { url: cfg.url, db: cfg.db, username: cfg.username, api_key: cfg.apiKey },
        contact_fields: state.extractedFields,
        custom_fields: state.customFieldValues,
        custom_module: cfg.customModule || 'x_scanned_document',
        selected_contact_id: state.selectedContactId || null,
        selected_company_id: companyId || null,
        create_new_contact: !state.selectedContactId,
      }),
    });
    const result = await res.json();
    await saveToHistory(result);
    renderResult(result);
    showScreen('result');
  } catch (err) {
    toast('Kayıt hatası: ' + err.message, 'error');
    showScreen('preview');
  }
}

function renderMatchNoOdoo() {
  document.getElementById('match-body').innerHTML = `
    <div style="padding:32px;text-align:center">
      <div style="font-size:48px;margin-bottom:16px">⚠️</div>
      <div style="font-family:var(--font-head);font-size:17px;font-weight:700;margin-bottom:8px">Odoo Bağlantısı Yok</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:24px">Lütfen Ayarlar ekranından Odoo bilgilerini girin.</div>
      <button class="btn-primary" onclick="showScreen('settings')">⚙️ Ayarlara Git</button>
    </div>`;
}

// ─── Result ───────────────────────────────────────────────────────────────────
function renderResult(result) {
  let cards = `<div class="result-card"><h4>OLUŞTURULAN KAYITLAR</h4>`;

  if (result.contact_id) {
    const badge = result.contact_existed ? 'existed' : 'contact';
    const label = result.contact_existed ? 'Güncellendi' : 'Yeni Kontak';
    cards += `<div class="result-row">
      <span class="result-badge ${badge}">${label}</span>
      <span class="result-val">${esc(state.extractedFields.name || '')} #${result.contact_id}</span>
    </div>`;
  }
  if (result.company_id) {
    cards += `<div class="result-row">
      <span class="result-badge module">Yeni Şirket</span>
      <span class="result-val">${esc(state.extractedFields.company || '')} #${result.company_id}</span>
    </div>`;
  }
  if (result.company_existed) {
    cards += `<div class="result-row">
      <span class="result-badge existed">Mevcut Şirket</span>
      <span class="result-val">${esc(state.extractedFields.company || '')}</span>
    </div>`;
  }
  if (result.record_id) {
    cards += `<div class="result-row">
      <span class="result-badge module">Modül Kaydı</span>
      <span class="result-val">#${result.record_id}</span>
    </div>`;
  }
  if (result.record_error) {
    cards += `<div style="margin-top:8px;padding:10px;background:rgba(255,107,107,.1);border-radius:8px;font-size:12px;color:var(--danger)">${esc(result.record_error_hint || result.record_error)}</div>`;
  }
  cards += `</div>`;

  // Özet
  const fieldEntries = Object.entries(state.extractedFields).filter(([,v]) => v).slice(0, 5);
  if (fieldEntries.length) {
    cards += `<div class="result-card"><h4>AKTARILAN BİLGİLER</h4>`;
    fieldEntries.forEach(([k, v]) => {
      cards += `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--surface2);font-size:13px">
        <span style="color:var(--muted);text-transform:capitalize">${k.replace('_',' ')}</span>
        <span>${esc(v)}</span>
      </div>`;
    });
    cards += `</div>`;
  }

  document.getElementById('result-cards').innerHTML = cards;

  const linkBtn = document.getElementById('odoo-link-btn');
  if (result.odoo_url) {
    linkBtn.style.display = 'block';
    linkBtn.onclick = () => window.open(result.odoo_url, '_blank');
  } else {
    linkBtn.style.display = 'none';
  }
}

// ─── History ──────────────────────────────────────────────────────────────────
function saveToHistory(result) {
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  hist.unshift({
    fields: state.extractedFields,
    result,
    docType: state.docType,
    timestamp: new Date().toISOString(),
  });
  localStorage.setItem('scan_history', JSON.stringify(hist.slice(0, 50)));
}

function renderHistory() {
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  const body = document.getElementById('history-body');
  if (!hist.length) {
    body.innerHTML = `<div class="empty-state"><div class="ei">📋</div><p>Henüz tarama geçmişi yok</p></div>`;
    return;
  }
  const typeIcons = { businessCard: '📸', handwrittenForm: '✍️', pdf: '📄' };
  body.innerHTML = hist.map(item => `
    <div class="hist-item">
      <div class="hist-name">${esc(item.fields?.name || 'İsimsiz')}</div>
      ${item.fields?.company ? `<div class="hist-company">${esc(item.fields.company)}</div>` : ''}
      <div class="hist-footer">
        <span class="hist-date">${new Date(item.timestamp).toLocaleDateString('tr-TR', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
        <span style="font-size:11px">${typeIcons[item.docType] || '📄'}</span>
        ${item.result?.contact_id ? `<span class="result-badge contact" style="font-size:10px">Kontak #${item.result.contact_id}</span>` : ''}
      </div>
    </div>
  `).join('');
}

function clearHistory() {
  if (!confirm('Tüm geçmiş silinecek. Emin misiniz?')) return;
  localStorage.removeItem('scan_history');
  renderHistory();
  toast('Geçmiş temizlendi');
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettingsForm() {
  const cfg = getConfig();
  document.getElementById('cfg-backend').value = cfg.backendUrl || '';
  document.getElementById('cfg-url').value = cfg.url || '';
  document.getElementById('cfg-db').value = cfg.db || '';
  document.getElementById('cfg-user').value = cfg.username || '';
  document.getElementById('cfg-key').value = cfg.apiKey || '';
  document.getElementById('cfg-module').value = cfg.customModule || 'x_scanned_document';
  renderCustomFieldsList(cfg.customFields || []);
}

function renderCustomFieldsList(fields) {
  document.getElementById('custom-fields-list').innerHTML = fields.map((f, i) => `
    <div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border-radius:8px;padding:8px 12px;margin-bottom:6px">
      <span style="flex:1;font-size:13px;color:var(--accent2)">${esc(f.key)}</span>
      <span style="flex:1;font-size:13px;color:var(--muted)">${esc(f.label)}</span>
      <button onclick="removeCustomField(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px">✕</button>
    </div>
  `).join('');
}

function addCustomField() {
  const key = document.getElementById('new-field-key').value.trim();
  const label = document.getElementById('new-field-label').value.trim();
  if (!key || !label) { toast('Alan adı ve etiket girin', 'error'); return; }
  const cfg = getConfig();
  const fields = cfg.customFields || [];
  fields.push({ key, label });
  cfg.customFields = fields;
  saveConfig(cfg);
  document.getElementById('new-field-key').value = '';
  document.getElementById('new-field-label').value = '';
  renderCustomFieldsList(fields);
  toast('Alan eklendi');
}

function removeCustomField(i) {
  const cfg = getConfig();
  const fields = cfg.customFields || [];
  fields.splice(i, 1);
  cfg.customFields = fields;
  saveConfig(cfg);
  renderCustomFieldsList(fields);
}

function saveSettings() {
  const cfg = getConfig();
  cfg.backendUrl  = document.getElementById('cfg-backend').value.trim();
  cfg.url         = document.getElementById('cfg-url').value.trim();
  cfg.db          = document.getElementById('cfg-db').value.trim();
  cfg.username    = document.getElementById('cfg-user').value.trim();
  cfg.apiKey      = document.getElementById('cfg-key').value.trim();
  cfg.customModule= document.getElementById('cfg-module').value.trim();
  saveConfig(cfg);
  toast('Ayarlar kaydedildi ✓', 'success');
  refreshHome();
}

async function testConnection() {
  const cfg = getConfig();
  const backendUrl = document.getElementById('cfg-backend').value.trim() || cfg.backendUrl;
  const payload = {
    url: document.getElementById('cfg-url').value.trim(),
    db: document.getElementById('cfg-db').value.trim(),
    username: document.getElementById('cfg-user').value.trim(),
    api_key: document.getElementById('cfg-key').value.trim(),
  };
  const btn = document.getElementById('test-btn');
  const res_el = document.getElementById('test-result');
  btn.disabled = true;
  btn.textContent = '⏳ Test ediliyor...';
  res_el.style.display = 'none';
  try {
    const res = await fetch(backendUrl.replace(/\/$/, '') + '/api/test-odoo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    res_el.style.display = 'block';
    if (data.success) {
      res_el.innerHTML = `<span style="color:var(--success)">✓ Bağlantı başarılı! (uid: ${data.uid})</span>`;
    } else {
      res_el.innerHTML = `<span style="color:var(--danger)">✗ ${data.message}</span>`;
    }
  } catch (e) {
    res_el.style.display = 'block';
    res_el.innerHTML = `<span style="color:var(--danger)">✗ Sunucuya ulaşılamadı: ${e.message}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔌 Bağlantıyı Test Et';
  }
}

function clearAllData() {
  if (!confirm('Tüm veriler (ayarlar + geçmiş) silinecek. Emin misiniz?')) return;
  localStorage.clear();
  toast('Tüm veriler temizlendi');
  loadSettingsForm();
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Service Worker ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ─── Init ─────────────────────────────────────────────────────────────────────
refreshHome();
