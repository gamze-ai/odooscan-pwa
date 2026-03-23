/* OdooScan PWA — app.js v2.0 */

let state = {
  currentScreen: 'home',
  scanMode: 'form',
  fileBase64: null, fileMime: null, fileName: null,
  formFields: {}, cardFields: {}, manualFields: {},
  contactCandidates: [], companyCandidates: [],
  selectedContactId: null, selectedCompanyId: null,
  matchStep: 'contact',
};

function getConfig() { return JSON.parse(localStorage.getItem('odoo_config') || '{}'); }
function saveConfig(cfg) { localStorage.setItem('odoo_config', JSON.stringify(cfg)); }

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  state.currentScreen = name;
  if (name === 'home') refreshHome();
  if (name === 'history') renderHistory();
  if (name === 'settings') loadSettingsForm();
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.textContent.includes({home:'Ana',history:'Geçmiş',settings:'Ayarlar'}[name]||''));
  });
}

function refreshHome() {
  const cfg = getConfig();
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (cfg.url) {
    dot.className = 'dot green';
    txt.textContent = 'Bağlı: ' + cfg.url.replace(/https?:\/\//,'').split('/')[0];
  } else {
    dot.className = 'dot orange';
    txt.textContent = "Odoo bağlantısı kurulmadı — Ayarlar'dan yapılandırın";
  }
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  document.getElementById('hist-count-label').textContent = hist.length + ' tarama';
}

function startScan(mode) {
  state.scanMode = mode;
  state.fileBase64 = null; state.fileMime = null; state.fileName = null;
  state.formFields = {}; state.cardFields = {}; state.manualFields = {};

  const titles = {form:'Form <span>Tara</span>', businessCard:'Kartvizit <span>Tara</span>', both:'Form + Kartvizit <span>Tara</span>'};
  const icons = {form:'📋', businessCard:'📸', both:'📋📸'};
  const subs = {form:'Fuar görüşme formu fotoğrafı', businessCard:'Kartvizit fotoğrafı', both:'Form + kartvizit birlikte'};

  document.getElementById('upload-title').innerHTML = titles[mode];
  document.getElementById('uz-icon').textContent = icons[mode];
  document.getElementById('uz-title').textContent = 'Fotoğraf Çek veya Yükle';
  document.getElementById('uz-sub').textContent = subs[mode];

  const input = document.getElementById('file-input');
  input.accept = 'image/*';
  input.setAttribute('capture', 'environment');
  document.getElementById('preview-img').style.display = 'none';
  document.getElementById('extract-btn').disabled = true;
  document.getElementById('ai-loader').classList.remove('show');
  showScreen('upload');
}

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.fileMime = file.type; state.fileName = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    state.fileBase64 = ev.target.result.split(',')[1];
    if (file.type.startsWith('image/')) {
      const img = document.getElementById('preview-img');
      img.src = ev.target.result; img.style.display = 'block';
    }
    document.getElementById('extract-btn').disabled = false;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

async function doExtract() {
  if (!state.fileBase64) { toast('Önce bir fotoğraf seçin', 'error'); return; }
  const cfg = getConfig();
  if (!cfg.backendUrl) { toast("Ayarlar'dan Backend URL girin", 'error'); return; }

  document.getElementById('extract-btn').disabled = true;
  const loader = document.getElementById('ai-loader');
  loader.classList.add('show');
  const msgs = ['AI bilgileri çıkarıyor...','OCR işleniyor...','Alanlar eşleştiriliyor...'];
  let mi = 0;
  const iv = setInterval(() => { document.getElementById('ai-msg').textContent = msgs[mi++%msgs.length]; }, 1800);

  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/,'') + '/api/extract', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({file_base64: state.fileBase64, mime_type: state.fileMime, document_type: state.scanMode}),
    });
    if (!res.ok) throw new Error('Sunucu hatası: ' + res.status);
    const data = await res.json();
    state.formFields = data.form_fields || {};
    state.cardFields = data.card_fields || {};
    renderPreviewFields();
    showScreen('preview');
  } catch (err) {
    toast('Hata: ' + err.message, 'error');
  } finally {
    clearInterval(iv);
    loader.classList.remove('show');
    document.getElementById('extract-btn').disabled = false;
  }
}

const FORM_LABELS = {
  fuar_adi:'Fuar Adı', sirket:'Şirket', tarih:'Tarih',
  gorusulen_1:'Görüşülen 1. Kişi', gorusulen_1_tel:'Görüşülen 1 Tel', gorusulen_1_mail:'Görüşülen 1 Mail',
  gorusulen_2:'Görüşülen 2. Kişi', gorusulen_2_tel:'Görüşülen 2 Tel', gorusulen_2_mail:'Görüşülen 2 Mail',
  gorusme_yapan_1:'Görüşme Yapan 1', gorusme_yapan_2:'Görüşme Yapan 2', gorusme_yapan_3:'Görüşme Yapan 3',
  notlar:'Notlar', aksiyon_plan:'Aksiyon Planı', oncelik:'Öncelik',
};
const CARD_LABELS = {
  name:'Ad Soyad', company:'Şirket', function:'Ünvan',
  phone:'Telefon', mobile:'Cep', email:'E-posta', website:'Website',
  street:'Adres', city:'İlçe', state:'Şehir', zip:'Posta Kodu', country:'Ülke',
};
const MANUAL_LABELS = {
  user_id:'Satış Temsilcisi (ID)',
  property_payment_term_id:'Müşteri Ödeme Koşulu (ID)',
  property_supplier_payment_term_id:'Tedarikçi Ödeme Koşulu (ID)',
  sale_currency_rate_type_id:'Satış Kur Türü (ID)',
};

function renderPreviewFields() {
  let html = '';
  if (state.scanMode === 'form' || state.scanMode === 'both') {
    html += `<p class="section-label">📋 FORM BİLGİLERİ</p>`;
    html += Object.entries(FORM_LABELS).map(([k,l]) => `
      <div class="field-row">
        <div class="field-label">${l}</div>
        <input class="field-input" id="ff-${k}" value="${esc(state.formFields[k]||'')}"
          placeholder="${l}..." oninput="state.formFields['${k}']=this.value"/>
      </div>`).join('');
  }
  if (state.scanMode === 'businessCard' || state.scanMode === 'both') {
    html += `<p class="section-label" style="margin-top:20px">📸 KARTVİZİT BİLGİLERİ</p>`;
    html += Object.entries(CARD_LABELS).map(([k,l]) => `
      <div class="field-row">
        <div class="field-label" style="color:var(--accent)">${l}</div>
        <input class="field-input" id="cf-${k}" value="${esc(state.cardFields[k]||'')}"
          placeholder="${l}..." oninput="state.cardFields['${k}']=this.value"/>
      </div>`).join('');
    html += `<p class="section-label" style="margin-top:20px">✏️ MANUEL ALANLAR</p>
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px">Odoo ID olarak girilmeli</p>`;
    html += Object.entries(MANUAL_LABELS).map(([k,l]) => `
      <div class="field-row">
        <div class="field-label" style="color:var(--success)">${l}</div>
        <input class="field-input" id="mf-${k}" value="${esc(state.manualFields[k]||'')}"
          placeholder="Odoo ID..." type="number" oninput="state.manualFields['${k}']=this.value?parseInt(this.value):null"/>
      </div>`).join('');
  }
  document.getElementById('contact-fields').innerHTML = html;
  document.getElementById('custom-section-label').style.display = 'none';
  document.getElementById('custom-fields-container').innerHTML = '';
}

async function goToMatchScreen() {
  Object.keys(FORM_LABELS).forEach(k => { const el = document.getElementById('ff-'+k); if (el) state.formFields[k] = el.value; });
  Object.keys(CARD_LABELS).forEach(k => { const el = document.getElementById('cf-'+k); if (el) state.cardFields[k] = el.value; });
  state.matchStep = 'contact'; state.selectedContactId = null; state.selectedCompanyId = null;
  document.getElementById('match-back-btn').onclick = () => showScreen('preview');
  document.getElementById('match-title').innerHTML = 'Kontak <span>Kontrolü</span>';
  showScreen('match');
  await runContactCheck();
}

async function runContactCheck() {
  const cfg = getConfig();
  if (!cfg.url) { renderMatchNoOdoo(); return; }
  document.getElementById('match-body').innerHTML = `<div class="ai-loader show"><div class="pulse-ring"></div><p>Odoo'da kontak aranıyor...</p></div>`;
  const searchName = state.cardFields.name || state.formFields.gorusulen_1 || '';
  const searchCompany = state.cardFields.company || state.formFields.sirket || '';
  const searchEmail = state.cardFields.email || state.formFields.gorusulen_1_mail || '';
  const searchPhone = state.cardFields.phone || state.formFields.gorusulen_1_tel || '';
  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/,'') + '/api/check-contact', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({odoo_config:{url:cfg.url,db:cfg.db,username:cfg.username,api_key:cfg.apiKey},
        name:searchName, company_name:searchCompany, email:searchEmail, phone:searchPhone}),
    });
    const data = await res.json();
    state.contactCandidates = data.contact_candidates || [];
    state.companyCandidates = data.company_candidates || [];
    renderContactStep();
  } catch (err) {
    document.getElementById('match-body').innerHTML = `<div style="padding:24px;text-align:center;color:var(--danger)">Kontrol hatası: ${err.message}</div>`;
  }
}

function renderContactStep() {
  const name = state.cardFields.name || state.formFields.gorusulen_1 || '—';
  const company = state.cardFields.company || state.formFields.sirket || '';
  const candidates = state.contactCandidates;
  let html = `<div class="match-header"><div class="name">${esc(name)}</div>${company?`<div class="company">${esc(company)}</div>`:''}</div>`;
  if (candidates.length > 0) {
    html += `<p class="section-label">${candidates.length} BENZER KONTAK BULUNDU</p><p style="font-size:13px;color:var(--muted);margin-bottom:14px">Bunlardan biri mi?</p>`;
    candidates.forEach(c => { html += `<div class="candidate-card ${c.match_type}" onclick="selectContact(${c.id})"><div class="candidate-info"><div class="candidate-name">${esc(c.name)}</div>${c.company?`<div class="candidate-company">${esc(c.company)}</div>`:''}</div><div class="score-badge ${c.match_type}">%${c.score}</div></div>`; });
    html += `<div class="divider"><div class="divider-line"></div><span class="divider-txt">veya</span><div class="divider-line"></div></div>`;
  } else {
    html += `<div style="background:var(--surface);border-radius:var(--radius);padding:24px;text-align:center;margin-bottom:20px"><div style="font-size:36px;margin-bottom:10px">🔍</div><div style="font-family:var(--font-head);font-size:15px;font-weight:700;margin-bottom:6px">Eşleşen kontak bulunamadı</div><div style="font-size:13px;color:var(--muted)">Yeni kontak kaydı oluşturulacak.</div></div>`;
  }
  html += `<button class="btn-primary" onclick="selectContact(null)" style="background:var(--accent2);color:#fff">➕ Yeni Kontak Oluştur<span style="display:block;font-size:11px;font-weight:400;margin-top:2px;opacity:.8">${esc(name)} adıyla kayıt açılacak</span></button>`;
  document.getElementById('match-body').innerHTML = html;
}

function selectContact(id) {
  state.selectedContactId = id; state.matchStep = 'company';
  document.getElementById('match-back-btn').onclick = () => renderContactStep();
  document.getElementById('match-title').innerHTML = 'Şirket <span>Kontrolü</span>';
  renderCompanyStep();
}

function renderCompanyStep() {
  const company = state.cardFields.company || state.formFields.sirket || '';
  const candidates = state.companyCandidates;
  let html = `<div class="step-row"><div class="step-dot done">✓</div><div class="step-line done"></div><div class="step-dot active">2</div><div class="step-line idle"></div><div class="step-dot idle">3</div></div>`;
  if (!company) {
    html += `<div style="background:var(--surface);border-radius:var(--radius);padding:24px;text-align:center;margin-bottom:20px"><div style="font-size:13px;color:var(--muted)">Belgede şirket adı bulunamadı</div></div><button class="btn-primary" onclick="proceedToSave(null)">Şirketsiz Devam Et</button>`;
  } else {
    html += `<div class="match-header"><div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px;margin-bottom:4px">ŞİRKET</div><div class="name">${esc(company)}</div></div>`;
    if (candidates.length > 0) {
      html += `<p class="section-label">BENZER ŞİRKETLER</p>`;
      candidates.forEach(c => { html += `<div class="candidate-card ${c.match_type}" onclick="selectCompany(${c.id})"><div class="candidate-info"><div class="candidate-name">${esc(c.name)}</div></div><div class="score-badge ${c.match_type}">%${c.score}</div></div>`; });
      html += `<div class="divider"><div class="divider-line"></div><span class="divider-txt">veya</span><div class="divider-line"></div></div>`;
    }
    html += `<button class="btn-primary" onclick="selectCompany(null)" style="background:var(--accent2);color:#fff">➕ Yeni Şirket Oluştur<span style="display:block;font-size:11px;font-weight:400;margin-top:2px;opacity:.8">${esc(company)} adıyla açılacak</span></button>`;
  }
  document.getElementById('match-body').innerHTML = html;
}

function selectCompany(id) { state.selectedCompanyId = id; proceedToSave(id); }

async function proceedToSave(companyId) {
  const cfg = getConfig();
  document.getElementById('match-body').innerHTML = `<div class="ai-loader show"><div class="pulse-ring"></div><p>Odoo'ya kaydediliyor...</p></div>`;
  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/,'') + '/api/send-to-odoo', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        odoo_config:{url:cfg.url,db:cfg.db,username:cfg.username,api_key:cfg.apiKey},
        scan_type: state.scanMode,
        form_fields: state.formFields,
        card_fields: state.cardFields,
        manual_fields: state.manualFields,
        selected_contact_id: state.selectedContactId || null,
        selected_company_id: companyId || null,
      }),
    });
    const result = await res.json();
    saveToHistory(result);
    renderResult(result);
    showScreen('result');
  } catch (err) {
    toast('Kayıt hatası: ' + err.message, 'error');
    showScreen('preview');
  }
}

function renderMatchNoOdoo() {
  document.getElementById('match-body').innerHTML = `<div style="padding:32px;text-align:center"><div style="font-size:48px;margin-bottom:16px">⚠️</div><div style="font-family:var(--font-head);font-size:17px;font-weight:700;margin-bottom:8px">Odoo Bağlantısı Yok</div><div style="font-size:13px;color:var(--muted);margin-bottom:24px">Ayarlar ekranından Odoo bilgilerini girin.</div><button class="btn-primary" onclick="showScreen('settings')">⚙️ Ayarlara Git</button></div>`;
}

function renderResult(result) {
  let cards = `<div class="result-card"><h4>OLUŞTURULAN KAYITLAR</h4>`;
  if (result.visit_id) cards += `<div class="result-row"><span class="result-badge module">Ziyaret Kaydı</span><span class="result-val">#${result.visit_id}</span></div>`;
  if (result.contact_id) cards += `<div class="result-row"><span class="result-badge ${result.contact_existed?'existed':'contact'}">${result.contact_existed?'Mevcut Kontak':'Yeni Kontak'}</span><span class="result-val">${esc(state.cardFields.name||'')} #${result.contact_id}</span></div>`;
  if (result.company_id) cards += `<div class="result-row"><span class="result-badge module">Yeni Şirket</span><span class="result-val">${esc(state.cardFields.company||state.formFields.sirket||'')} #${result.company_id}</span></div>`;
  if (result.company_existed) cards += `<div class="result-row"><span class="result-badge existed">Mevcut Şirket</span><span class="result-val">${esc(state.cardFields.company||state.formFields.sirket||'')}</span></div>`;
  if (result.visit_error) cards += `<div style="margin-top:8px;padding:10px;background:rgba(255,107,107,.1);border-radius:8px;font-size:12px;color:var(--danger)">${esc(result.visit_error)}</div>`;
  cards += `</div>`;
  document.getElementById('result-cards').innerHTML = cards;
  const linkBtn = document.getElementById('odoo-link-btn');
  if (result.odoo_url) { linkBtn.style.display = 'block'; linkBtn.onclick = () => window.open(result.odoo_url,'_blank'); }
  else linkBtn.style.display = 'none';
}

function saveToHistory(result) {
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  hist.unshift({formFields:state.formFields, cardFields:state.cardFields, scanMode:state.scanMode, result, timestamp:new Date().toISOString()});
  localStorage.setItem('scan_history', JSON.stringify(hist.slice(0,50)));
}

function renderHistory() {
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  const body = document.getElementById('history-body');
  if (!hist.length) { body.innerHTML = `<div class="empty-state"><div class="ei">📋</div><p>Henüz tarama geçmişi yok</p></div>`; return; }
  const modeIcons = {form:'📋', businessCard:'📸', both:'📋📸'};
  body.innerHTML = hist.map(item => {
    const name = item.cardFields?.name || item.formFields?.gorusulen_1 || 'İsimsiz';
    const company = item.cardFields?.company || item.formFields?.sirket || '';
    return `<div class="hist-item"><div class="hist-name">${esc(name)}</div>${company?`<div class="hist-company">${esc(company)}</div>`:''}<div class="hist-footer"><span class="hist-date">${new Date(item.timestamp).toLocaleDateString('tr-TR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span><span style="font-size:11px">${modeIcons[item.scanMode]||'📄'}</span>${item.result?.visit_id?`<span class="result-badge module" style="font-size:10px">Ziyaret #${item.result.visit_id}</span>`:''}</div></div>`;
  }).join('');
}

function clearHistory() {
  if (!confirm('Tüm geçmiş silinecek. Emin misiniz?')) return;
  localStorage.removeItem('scan_history');
  renderHistory();
  toast('Geçmiş temizlendi');
}

function loadSettingsForm() {
  const cfg = getConfig();
  document.getElementById('cfg-backend').value = cfg.backendUrl || '';
  document.getElementById('cfg-url').value = cfg.url || '';
  document.getElementById('cfg-db').value = cfg.db || '';
  document.getElementById('cfg-user').value = cfg.username || '';
  document.getElementById('cfg-key').value = cfg.apiKey || '';
  document.getElementById('cfg-module').value = cfg.customModule || 'x_ziyaret_toplanti';
  renderCustomFieldsList(cfg.customFields || []);
}

function renderCustomFieldsList(fields) {
  document.getElementById('custom-fields-list').innerHTML = fields.map((f,i) => `<div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border-radius:8px;padding:8px 12px;margin-bottom:6px"><span style="flex:1;font-size:13px;color:var(--accent2)">${esc(f.key)}</span><span style="flex:1;font-size:13px;color:var(--muted)">${esc(f.label)}</span><button onclick="removeCustomField(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px">✕</button></div>`).join('');
}

function addCustomField() {
  const key = document.getElementById('new-field-key').value.trim();
  const label = document.getElementById('new-field-label').value.trim();
  if (!key || !label) { toast('Alan adı ve etiket girin','error'); return; }
  const cfg = getConfig();
  const fields = cfg.customFields || [];
  fields.push({key,label});
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
  fields.splice(i,1);
  cfg.customFields = fields;
  saveConfig(cfg);
  renderCustomFieldsList(fields);
}

function saveSettings() {
  const cfg = getConfig();
  cfg.backendUrl = document.getElementById('cfg-backend').value.trim();
  cfg.url = document.getElementById('cfg-url').value.trim();
  cfg.db = document.getElementById('cfg-db').value.trim();
  cfg.username = document.getElementById('cfg-user').value.trim();
  cfg.apiKey = document.getElementById('cfg-key').value.trim();
  cfg.customModule = document.getElementById('cfg-module').value.trim();
  saveConfig(cfg);
  toast('Ayarlar kaydedildi ✓','success');
  refreshHome();
}

async function testConnection() {
  const cfg = getConfig();
  const backendUrl = document.getElementById('cfg-backend').value.trim() || cfg.backendUrl;
  const payload = {url:document.getElementById('cfg-url').value.trim(), db:document.getElementById('cfg-db').value.trim(), username:document.getElementById('cfg-user').value.trim(), api_key:document.getElementById('cfg-key').value.trim()};
  const btn = document.getElementById('test-btn');
  const res_el = document.getElementById('test-result');
  btn.disabled = true; btn.textContent = '⏳ Test ediliyor...'; res_el.style.display = 'none';
  try {
    const res = await fetch(backendUrl.replace(/\/$/,'') + '/api/test-odoo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), signal:AbortSignal.timeout(15000)});
    const data = await res.json();
    res_el.style.display = 'block';
    res_el.innerHTML = data.success ? `<span style="color:var(--success)">✓ Bağlantı başarılı! (uid: ${data.uid})</span>` : `<span style="color:var(--danger)">✗ ${data.message}</span>`;
  } catch (e) {
    res_el.style.display = 'block';
    res_el.innerHTML = `<span style="color:var(--danger)">✗ Sunucuya ulaşılamadı: ${e.message}</span>`;
  } finally { btn.disabled = false; btn.textContent = '🔌 Bağlantıyı Test Et'; }
}

function clearAllData() {
  if (!confirm('Tüm veriler silinecek. Emin misiniz?')) return;
  localStorage.clear(); toast('Tüm veriler temizlendi'); loadSettingsForm();
}

let toastTimer;
function toast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast show' + (type?' '+type:'');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function esc(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});

refreshHome();
