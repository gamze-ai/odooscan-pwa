/* OdooScan PWA — app.js v3.0
   Değişiklikler:
   1. Şirket kontrolü adımı kaldırıldı — kontak seçince direkt kaydet
   2. Manuel alanlar sadece "Yeni Kontak Oluştur" basılınca gösterilecek
   3. ID yerine Odoo'dan çekilen dropdown seçenekleri
   4. Görüşme yapan araması büyük/küçük harf duyarsız (normalize edildi)
*/

let state = {
  currentScreen: 'home',
  scanMode: 'form',
  fileBase64: null, fileMime: null, fileName: null,
  formFields: {}, cardFields: {}, manualFields: {},
  contactCandidates: [], companyCandidates: [],
  selectedContactId: null, selectedCompanyId: null,
  matchStep: 'contact',
  odooOptions: {},
  matchQueue: [],
  matchResults: [],
  currentMatchIdx: 0,
  extraCards: [],
  bulkFiles: [],        // Toplu yükleme dosyaları
  bulkIdx: 0,          // Şu an işlenen dosya indexi
  bulkResults: [],     // Tüm sonuçlar
  bulkSessionId: null,
  currentUser: null,   // Giriş yapan kullanıcı { name, email, uid }
};

function getConfig() {
  const raw = localStorage.getItem('odoo_config');
  return raw ? JSON.parse(raw) : {};
}
function saveConfig(cfg) { localStorage.setItem('odoo_config', JSON.stringify(cfg)); }

function showScreen(name) {
  if (name !== 'login' && name !== 'settings') {
    const user = JSON.parse(localStorage.getItem('odoo_user') || 'null');
    if (!user) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById('screen-login').classList.add('active');
      return;
    }
    if (!state.currentUser) state.currentUser = user;
  }
  // Ayarlar ekranı sadece admin'e açık
  if (name === 'settings') {
    const user = JSON.parse(localStorage.getItem('odoo_user') || 'null');
    if (!user) { 
      // Giriş yapılmamış ama ayarlara ihtiyaç var — ilk kurulum için izin ver
      // (Bu durumda nav'dan gelinmiyor, direkt erişim)
    } else if (user && !user.is_admin) {
      toast('Bu alana erişim yetkiniz yok', 'error');
      return;
    }
    if (user && !state.currentUser) state.currentUser = user;
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  state.currentScreen = name;
  if (name === 'home') refreshHome();
  if (name === 'history') renderHistory();
  if (name === 'settings') loadSettingsForm();
  document.querySelectorAll('.nav-item').forEach(b => {
    const lbl = { home: 'Ana', history: 'Geçmiş', settings: 'Ayarlar' }[name] || '';
    b.classList.toggle('active', b.textContent.includes(lbl));
  });
}

// ─── Auth ────────────────────────────────────────────────────────────────────
function checkAuth() {
  const user = JSON.parse(localStorage.getItem('odoo_user') || 'null');
  if (user) {
    state.currentUser = user;
    return true;
  }
  showScreen('login');
  return false;
}

async function doLogin() {
  const cfg = getConfig();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) { toast('E-posta ve şifre girin', 'error'); return; }
  if (!cfg.backendUrl || !cfg.url || !cfg.db) {
    toast('Önce ayarlardan sunucu bilgilerini girin', 'error');
    showScreen('settings');
    return;
  }

  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = 'Giriş yapılıyor...';

  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ odoo_url: cfg.url, db: cfg.db, email, password }),
    });
    const data = await res.json();
    if (data.success) {
      const user = { name: data.name, email: data.email, uid: data.uid, api_key: data.api_key, is_admin: data.is_admin };
      state.currentUser = user;
      localStorage.setItem('odoo_user', JSON.stringify(user));
      // API key'i config'e de kaydet
      const c = getConfig();
      c.username = email;
      c.apiKey = data.api_key;
      saveConfig(c);
      showScreen('home');
      refreshHome();
    } else {
      toast('❌ ' + (data.message || 'Giriş başarısız'), 'error');
    }
  } catch (err) {
    toast('❌ ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🔑 Giriş Yap';
  }
}

function doLogout() {
  if (!confirm('Çıkış yapmak istiyor musunuz?')) return;
  localStorage.removeItem('odoo_user');
  state.currentUser = null;
  showScreen('login');
}

function refreshHome() {
  const cfg = getConfig();
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (cfg.url) {
    dot.className = 'dot green';
    txt.textContent = 'Bağlı: ' + cfg.url.replace(/https?:\/\//, '').split('/')[0];
  } else {
    dot.className = 'dot orange';
    txt.textContent = "Odoo bağlantısı kurulmadı — Ayarlar'dan yapılandırın";
  }
  // Kullanıcı adını göster
  const userEl = document.getElementById('current-user-name');
  if (userEl && state.currentUser) userEl.textContent = '👤 ' + state.currentUser.name;

  // Admin değilse ayarlar butonunu gizle
  try {
    const isAdmin = state.currentUser?.is_admin;
    const settingsNavBtn = document.getElementById('nav-settings-btn');
    const settingsIconBtn = document.getElementById('home-settings-btn');
    if (settingsNavBtn) settingsNavBtn.style.display = isAdmin ? '' : 'none';
    if (settingsIconBtn) settingsIconBtn.style.display = isAdmin ? '' : 'none';
    // Nav dengeli görünsün — 2 buton varsa flex justify
    const bottomNav = document.querySelector('#screen-home .bottom-nav');
    if (bottomNav) bottomNav.style.justifyContent = isAdmin ? '' : 'space-around';
  } catch(e) {}
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  document.getElementById('hist-count-label').textContent = hist.length + ' tarama';
}

// ─── Toplu Yükleme ───────────────────────────────────────────────────────────
function startBulkUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,application/pdf';
  input.multiple = true;
  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    state.bulkFiles = files;
    state.bulkIdx = 0;
    state.bulkResults = [];
    state.bulkSessionId = 'bulk_' + Date.now();

    showScreen('match');
    document.getElementById('match-title').innerHTML = 'Toplu <span>Yükleme</span>';
    document.getElementById('match-back-btn').onclick = () => showScreen('home');
    await processBulkFile();
  };
  input.click();
}

async function processBulkFile() {
  const cfg = getConfig();
  const files = state.bulkFiles;
  const idx = state.bulkIdx;

  if (idx >= files.length) {
    renderBulkSummary();
    return;
  }

  const file = files[idx];
  const total = files.length;
  document.getElementById('match-title').innerHTML = `Form <span>${idx + 1}/${total}</span>`;
  document.getElementById('match-back-btn').onclick = () => {
    if (idx > 0) { state.bulkIdx--; processBulkFile(); }
    else showScreen('home');
  };

  // Dosyayı base64'e çevir
  document.getElementById('match-body').innerHTML = `
    <div class="ai-loader show"><div class="pulse-ring"></div><p>${esc(file.name)} okunuyor...</p></div>`;

  const b64 = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result.split(',')[1]);
    reader.readAsDataURL(file);
  });

  // AI'a gönder
  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_base64: b64, mime_type: file.type, document_type: 'both' }),
    });
    if (!res.ok) throw new Error('Sunucu hatası: ' + res.status);
    const data = await res.json();

    // Okunan verileri state'e yükle
    state.formFields = data.form_fields || {};
    state.cardFields = data.card_fields || {};
    state.extraCards = data.extra_cards || [];
    state.fileBase64 = b64;
    state.fileMime = file.type;
    state.fileName = file.name;

    renderBulkPreview(idx, total, file.name, b64, file.type);
  } catch (err) {
    document.getElementById('match-body').innerHTML = `
      <div style="padding:24px;text-align:center">
        <div style="font-size:36px;margin-bottom:12px">❌</div>
        <div style="color:var(--danger);margin-bottom:16px">${esc(err.message)}</div>
        <button class="btn-primary" onclick="skipBulkFile()">Bu dosyayı atla →</button>
      </div>`;
  }
}

function renderBulkPreview(idx, total, fileName, b64, mime) {
  const ff = state.formFields;
  const cf = state.cardFields;

  const makeField = (label, key, value, fieldset) => `
    <div class="field-row">
      <div class="field-label" style="font-size:11px">${label}</div>
      <input class="field-input" value="${esc(value || '')}"
        oninput="state.${fieldset}['${key}']=this.value"
        style="font-size:13px;padding:8px 10px"/>
    </div>`;

  let formHtml = '';
  const fl = { fuar_adi:'Fuar Adı', sirket:'Şirket', tarih:'Tarih',
    gorusulen_1:'Görüşülen 1', gorusulen_1_tel:'Tel', gorusulen_1_mail:'Mail',
    gorusulen_2:'Görüşülen 2', gorusulen_2_tel:'Tel 2', gorusulen_2_mail:'Mail 2',
    gorusulen_3:'Görüşülen 3', gorusme_yapan_1:'Görüşme Yapan 1',
    gorusme_yapan_2:'Görüşme Yapan 2', notlar:'Notlar', aksiyon_plan:'Aksiyon', oncelik:'Öncelik' };
  Object.entries(fl).forEach(([k, l]) => { formHtml += makeField(l, k, ff[k] || '', 'formFields'); });

  let cardHtml = '';
  const cl = { name:'Ad Soyad', company:'Şirket', function:'Ünvan', phone:'Telefon', mobile:'Cep', email:'E-posta' };
  Object.entries(cl).forEach(([k, l]) => {
    if (cf[k]) cardHtml += makeField(l, k, cf[k] || '', 'cardFields');
  });

  document.getElementById('match-body').innerHTML = `
    <div style="margin-bottom:16px;background:var(--surface2);border-radius:12px;overflow:hidden">
      ${mime.startsWith('image/') ? `<img src="data:${mime};base64,${b64}" style="width:100%;max-height:200px;object-fit:contain;background:#000"/>` : `<div style="padding:16px;text-align:center;font-size:13px;color:var(--muted)">📄 ${esc(fileName)}</div>`}
    </div>
    ${formHtml ? `<p class="section-label" style="margin-bottom:8px">📋 FORM BİLGİLERİ</p>${formHtml}` : ''}
    ${cardHtml ? `<p class="section-label" style="margin-top:16px;margin-bottom:8px">📸 KARTVİZİT</p>${cardHtml}` : ''}
    <div style="display:flex;gap:10px;margin-top:20px">
      <button class="btn-primary" style="flex:1" onclick="proceedBulkToMatch()">
        ✅ Onayla ve Devam
        <span style="display:block;font-size:11px;opacity:.7">${idx + 1}/${total} form</span>
      </button>
      <button onclick="skipBulkFile()" style="padding:14px 20px;background:var(--surface2);border:none;border-radius:12px;color:var(--muted);cursor:pointer;font-size:13px">Atla →</button>
    </div>`;
}

async function proceedBulkToMatch() {
  // Mevcut akışı kullan — kontak kontrolü + kayıt
  state.matchQueue = buildMatchQueue();
  state.matchResults = [];
  state.currentMatchIdx = 0;

  const origBack = document.getElementById('match-back-btn').onclick;

  // Match tamamlandığında bulk'a dön
  const origProceed = window._bulkProceedToSave;
  window._bulkMode = true;
  window._bulkOnComplete = async (result) => {
    state.bulkResults.push({
      fileIdx: state.bulkIdx,
      fileName: state.fileName,
      formFields: { ...state.formFields },
      cardFields: { ...state.cardFields },
      result,
    });
    state.bulkIdx++;
    window._bulkMode = false;
    document.getElementById('match-title').innerHTML = `Form <span>${state.bulkIdx + 1}/${state.bulkFiles.length}</span>`;
    document.getElementById('match-back-btn').onclick = () => {
      if (state.bulkIdx > 0) { state.bulkIdx--; processBulkFile(); }
      else showScreen('home');
    };
    await processBulkFile();
  };

  if (state.matchQueue.length === 0) {
    // Kontak yok, direkt kaydet
    await proceedToSave(null);
  } else {
    await processNextInQueue();
  }
}

function skipBulkFile() {
  state.bulkResults.push({ fileIdx: state.bulkIdx, fileName: state.fileName, skipped: true });
  state.bulkIdx++;
  processBulkFile();
}

function renderBulkSummary() {
  const results = state.bulkResults;
  const total = state.bulkFiles.length;
  const saved = results.filter(r => r.result?.visit_id).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => !r.result?.visit_id && !r.skipped).length;

  let rows = results.map((r, i) => {
    if (r.skipped) return `<div style="padding:10px;background:var(--surface2);border-radius:8px;margin-bottom:8px;font-size:13px;color:var(--muted)">⏭ ${esc(r.fileName || 'Dosya ' + (i+1))} — atlandı</div>`;
    if (r.result?.visit_id) return `<div style="padding:10px;background:rgba(81,207,102,.1);border-radius:8px;margin-bottom:8px;font-size:13px">
      ✅ ${esc(r.fileName || 'Dosya ' + (i+1))} — Ziyaret #${r.result.visit_id}
      ${r.result.odoo_url ? `<a href="${r.result.odoo_url}" target="_blank" style="color:var(--accent);margin-left:8px">Görüntüle →</a>` : ''}
    </div>`;
    return `<div style="padding:10px;background:rgba(255,107,107,.1);border-radius:8px;margin-bottom:8px;font-size:13px;color:var(--danger)">❌ ${esc(r.fileName || 'Dosya ' + (i+1))} — hata</div>`;
  }).join('');

  document.getElementById('match-title').innerHTML = 'Toplu Yükleme <span>Tamamlandı</span>';
  document.getElementById('match-back-btn').onclick = () => showScreen('home');
  document.getElementById('match-body').innerHTML = `
    <div style="text-align:center;padding:20px 0">
      <div style="font-size:48px;margin-bottom:8px">${saved === total ? '🎉' : '✅'}</div>
      <div style="font-family:var(--font-head);font-size:20px;font-weight:700;margin-bottom:4px">${saved}/${total} Kaydedildi</div>
      <div style="font-size:13px;color:var(--muted)">${skipped ? skipped + ' atlandı · ' : ''}${failed ? failed + ' başarısız' : ''}</div>
    </div>
    <div style="margin-top:16px">${rows}</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:20px">
      <button class="btn-primary" onclick="showScreen('home')">🏠 Ana Sayfaya Dön</button>
      <button class="btn-primary" style="background:var(--accent2);color:#fff" onclick="showScreen('history')">🗂️ Geçmişi Görüntüle</button>
    </div>`;
}

// ─── Upload ───────────────────────────────────────────────────────────────────
function startScan(mode) {
  state.scanMode = mode;
  state.fileBase64 = null; state.fileMime = null; state.fileName = null;
  state.formFields = {}; state.cardFields = {}; state.manualFields = {};

  const titles = { form: 'Form <span>Tara</span>', businessCard: 'Kartvizit <span>Tara</span>', both: 'Form + Kartvizit <span>Tara</span>' };
  const icons = { form: '📋', businessCard: '📸', both: '📋📸' };
  const subs = { form: 'Fuar görüşme formu fotoğrafı', businessCard: 'Kartvizit fotoğrafı', both: 'Form + kartvizit birlikte' };

  document.getElementById('upload-title').innerHTML = titles[mode];
  document.getElementById('uz-icon').textContent = icons[mode];
  document.getElementById('uz-title').textContent = 'Fotoğraf Çek veya Yükle';
  document.getElementById('uz-sub').textContent = subs[mode];

  const input = document.getElementById('file-input');
  input.accept = 'image/*,application/pdf';
  input.removeAttribute('capture');
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
    } else if (file.type === 'application/pdf') {
      const img = document.getElementById('preview-img');
      img.style.display = 'none';
      document.getElementById('uz-icon').textContent = '📄';
      document.getElementById('uz-title').textContent = file.name;
      document.getElementById('uz-sub').textContent = (file.size / 1024).toFixed(0) + ' KB — PDF yüklendi ✓';
    }
    document.getElementById('extract-btn').disabled = false;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// ─── Extract ─────────────────────────────────────────────────────────────────
async function doExtract() {
  if (!state.fileBase64) { toast('Önce bir fotoğraf seçin', 'error'); return; }
  const cfg = getConfig();
  if (!cfg.backendUrl) { toast("Ayarlar'dan Backend URL girin", 'error'); return; }

  document.getElementById('extract-btn').disabled = true;
  const loader = document.getElementById('ai-loader');
  loader.classList.add('show');
  const msgs = ['AI bilgileri çıkarıyor...', 'OCR işleniyor...', 'Alanlar eşleştiriliyor...'];
  let mi = 0;
  const iv = setInterval(() => { document.getElementById('ai-msg').textContent = msgs[mi++ % msgs.length]; }, 1800);

  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_base64: state.fileBase64, mime_type: state.fileMime, document_type: state.scanMode }),
    });
    if (!res.ok) throw new Error('Sunucu hatası: ' + res.status);
    const data = await res.json();
    state.formFields = data.form_fields || {};
    state.cardFields = data.card_fields || {};
    state.extraCards = data.extra_cards || [];
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

// ─── Preview Fields ───────────────────────────────────────────────────────────
const FORM_LABELS = {
  fuar_adi: 'Fuar Adı', sirket: 'Şirket', tarih: 'Tarih',
  gorusulen_1: 'Görüşülen 1. Kişi', gorusulen_1_tel: 'Görüşülen 1 Tel', gorusulen_1_mail: 'Görüşülen 1 Mail',
  gorusulen_2: 'Görüşülen 2. Kişi', gorusulen_2_tel: 'Görüşülen 2 Tel', gorusulen_2_mail: 'Görüşülen 2 Mail',
  gorusulen_3: 'Görüşülen 3. Kişi', gorusulen_3_tel: 'Görüşülen 3 Tel', gorusulen_3_mail: 'Görüşülen 3 Mail',
  gorusme_yapan_1: 'Görüşme Yapan 1', gorusme_yapan_2: 'Görüşme Yapan 2', gorusme_yapan_3: 'Görüşme Yapan 3',
  notlar: 'Notlar', aksiyon_plan: 'Aksiyon Planı', oncelik: 'Öncelik',
};
const CARD_LABELS = {
  name: 'Ad Soyad', company: 'Şirket', function: 'Ünvan',
  phone: 'Telefon', mobile: 'Cep', email: 'E-posta', website: 'Website',
  street: 'Adres', city: 'İlçe', state: 'Şehir', zip: 'Posta Kodu', country: 'Ülke',
};

// DÜZELTME 2: Manuel alanlar artık burada gösterilmiyor
// Bunlar sadece "Yeni Kontak Oluştur" butonuna basılınca açılan modal'da çıkacak
function renderPreviewFields() {
  let html = '';
  if (state.scanMode === 'form' || state.scanMode === 'both') {
    html += `<p class="section-label">📋 FORM BİLGİLERİ</p>`;
    html += Object.entries(FORM_LABELS).map(([k, l]) => `
      <div class="field-row">
        <div class="field-label">${l}</div>
        <input class="field-input" id="ff-${k}" value="${esc(state.formFields[k] || '')}"
          placeholder="${l}..." oninput="state.formFields['${k}']=this.value"/>
      </div>`).join('');
  }
  if (state.scanMode === 'businessCard' || state.scanMode === 'both') {
    html += `<p class="section-label" style="margin-top:20px">📸 KARTVİZİT BİLGİLERİ</p>`;
    html += Object.entries(CARD_LABELS).map(([k, l]) => `
      <div class="field-row">
        <div class="field-label" style="color:var(--accent)">${l}</div>
        <input class="field-input" id="cf-${k}" value="${esc(state.cardFields[k] || '')}"
          placeholder="${l}..." oninput="state.cardFields['${k}']=this.value"/>
      </div>`).join('');
  }
  document.getElementById('contact-fields').innerHTML = html;
  document.getElementById('custom-section-label').style.display = 'none';
  document.getElementById('custom-fields-container').innerHTML = '';
}

// ─── Match Screen — sıralı kontak kontrolü ───────────────────────────────────
// Her görüşülen kişi için sırayla kontak kontrolü yapılır
// state.matchQueue: işlenecek kişilerin kuyruğu
// state.matchResults: tamamlanan seçimler { slot, contactId, isNew, manualFields }

async function goToMatchScreen() {
  // Önce tüm input değerlerini state'e yaz
  Object.keys(FORM_LABELS).forEach(k => {
    const el = document.getElementById('ff-' + k);
    if (el) state.formFields[k] = el.value.trim();
  });
  Object.keys(CARD_LABELS).forEach(k => {
    const el = document.getElementById('cf-' + k);
    if (el) state.cardFields[k] = el.value.trim();
  });

  // Görüşülen kişi kuyruğunu oluştur
  state.matchQueue = buildMatchQueue();
  state.matchResults = [];
  state.currentMatchIdx = 0;

  console.log('[OdooScan] matchQueue:', JSON.stringify(state.matchQueue));
  console.log('[OdooScan] formFields:', JSON.stringify(state.formFields));

  if (state.matchQueue.length === 0) {
    // Görüşülen kişi yok, direkt kaydet
    document.getElementById('match-back-btn').onclick = () => showScreen('preview');
    document.getElementById('match-title').innerHTML = 'Kontak <span>Kontrolü</span>';
    showScreen('match');
    await proceedToSave(null);
    return;
  }

  document.getElementById('match-back-btn').onclick = () => showScreen('preview');
  document.getElementById('match-title').innerHTML = 'Kontak <span>Kontrolü</span>';
  showScreen('match');
  await processNextInQueue();
}

function buildMatchQueue() {
  const ff = state.formFields;
  const cf = state.cardFields;
  const queue = [];

  // Görüşülen 1
  const g1name = ff.gorusulen_1 || '';
  if (g1name) queue.push({
    slot: 'gorusulen_1', label: 'Görüşülen 1. Kişi',
    name: g1name, phone: ff.gorusulen_1_tel || '', email: ff.gorusulen_1_mail || '',
    company: ff.sirket || cf.company || '',
  });

  // Görüşülen 2
  const g2name = ff.gorusulen_2 || '';
  if (g2name) queue.push({
    slot: 'gorusulen_2', label: 'Görüşülen 2. Kişi',
    name: g2name, phone: ff.gorusulen_2_tel || '', email: ff.gorusulen_2_mail || '',
    company: ff.sirket || cf.company || '',
  });

  // Görüşülen 3
  const g3name = ff.gorusulen_3 || '';
  if (g3name) queue.push({
    slot: 'gorusulen_3', label: 'Görüşülen 3. Kişi',
    name: g3name, phone: ff.gorusulen_3_tel || '', email: ff.gorusulen_3_mail || '',
    company: ff.sirket || cf.company || '',
  });

  const normalize = s => (s || '').trim().toLowerCase().replace(/[^a-zğüşöçığA-ZĞÜŞÖÇİ0-9 ]/g, '');
  const inQueue = name => queue.some(q => normalize(q.name) === normalize(name));
  const inForm = name => {
    // Hem tam eşleşme hem de kısmi eşleşme kontrol et
    const normName = normalize(name);
    return [ff.gorusulen_1, ff.gorusulen_2, ff.gorusulen_3].some(n => {
      if (!n) return false;
      const normN = normalize(n);
      return normN === normName || normN.includes(normName) || normName.includes(normN);
    });
  };

  // Ana kartvizit kişisi — _merged_to_form flag'i varsa queue'ya ekleme
  const cardName = cf.name || '';
  const cardMerged = cf._merged_to_form === true;
  if (cardName && !cardMerged && !inQueue(cardName) && !inForm(cardName)) {
    queue.push({
      slot: 'card_contact', label: 'Kartvizit Kişisi',
      name: cardName, phone: cf.phone || cf.mobile || '', email: cf.email || '',
      company: cf.company || ff.sirket || '',
      isCardContact: true, cardData: cf,
    });
  }

  // Ekstra kartvizitler (birden fazla kartvizit durumu)
  (state.extraCards || []).forEach((ec, i) => {
    const ecName = ec.name || '';
    if (ecName && !inQueue(ecName) && !inForm(ecName)) {
      queue.push({
        slot: `extra_card_${i}`, label: `Kartvizit Kişisi ${i + 2}`,
        name: ecName, phone: ec.phone || ec.mobile || '', email: ec.email || '',
        company: ec.company || ff.sirket || '',
        isCardContact: true, cardData: ec,
      });
    }
  });

  // Şirket kontrolü — en sona ekle
  const companyName = ff.sirket || cf.company || '';
  if (companyName) {
    queue.push({
      slot: 'company', label: 'Şirket',
      name: companyName, isCompany: true,
    });
  }

  return queue;
}

async function processNextInQueue() {
  const cfg = getConfig();
  if (!cfg.url) { renderMatchNoOdoo(); return; }

  if (state.currentMatchIdx >= state.matchQueue.length) {
    // Tüm kişiler işlendi → kaydet
    await proceedToSave(null);
    return;
  }

  const person = state.matchQueue[state.currentMatchIdx];
  const total = state.matchQueue.length;
  const current = state.currentMatchIdx + 1;

  document.getElementById('match-title').innerHTML = `Kontak <span>Kontrolü</span> <span style="font-size:13px;font-weight:400;opacity:.6">${current}/${total}</span>`;
  document.getElementById('match-back-btn').onclick = () => {
    if (state.currentMatchIdx > 0) { state.currentMatchIdx--; processNextInQueue(); }
    else showScreen('preview');
  };

  document.getElementById('match-body').innerHTML = `<div class="ai-loader show"><div class="pulse-ring"></div><p>${esc(person.name)} aranıyor...</p></div>`;

  try {
    if (person.isCompany) {
      // Şirket araması
      const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/check-contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odoo_config: { url: cfg.url, db: cfg.db, username: cfg.username, api_key: cfg.apiKey },
          name: person.name, company_name: person.name, email: '', phone: '', is_company: true,
        }),
      });
      const data = await res.json();
      renderCompanyStep(person, data.company_candidates || [], current, total);
    } else {
      // Kişi araması
      const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/check-contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odoo_config: { url: cfg.url, db: cfg.db, username: cfg.username, api_key: cfg.apiKey },
          name: person.name, company_name: person.company, email: person.email, phone: person.phone,
        }),
      });
      const data = await res.json();
      renderPersonStep(person, data.contact_candidates || [], current, total);
    }
  } catch (err) {
    document.getElementById('match-body').innerHTML = `<div style="padding:24px;text-align:center;color:var(--danger)">Hata: ${esc(err.message)}</div>`;
  }
}

function renderPersonStep(person, candidates, current, total) {
  // Adım göstergesi
  let stepsHtml = '<div class="step-row">';
  for (let i = 0; i < total; i++) {
    const done = i < current - 1;
    const active = i === current - 1;
    stepsHtml += `<div class="step-dot ${done ? 'done' : active ? 'active' : 'idle'}">${done ? '✓' : i + 1}</div>`;
    if (i < total - 1) stepsHtml += `<div class="step-line ${done ? 'done' : 'idle'}"></div>`;
  }
  stepsHtml += '</div>';

  let html = stepsHtml + `
    <div class="match-header">
      <div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px;margin-bottom:4px">${esc(person.label)}</div>
      <div class="name">${esc(person.name)}</div>
      ${person.company ? `<div style="font-size:13px;color:var(--muted);margin-top:4px">${esc(person.company)}</div>` : ''}
    </div>`;

  if (candidates.length > 0) {
    html += `<p class="section-label">${candidates.length} BENZER KONTAK BULUNDU</p>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px">Bunlardan biri mi? Seçin veya yeni oluşturun.</p>`;
    candidates.forEach(c => {
      html += `
        <div class="candidate-card ${c.match_type}" onclick="selectPersonContact(${c.id})">
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

  // Tüm kişiler için yeni kontak butonu modal açar (4 zorunlu alan)
  html += `
    <button class="btn-primary" onclick="showNewContactModal()" style="background:var(--accent2);color:#fff">
      ➕ Yeni Kontak Oluştur
      <span style="display:block;font-size:11px;font-weight:400;margin-top:2px;opacity:.8">${esc(person.name)} adıyla kayıt açılacak</span>
    </button>`;

  document.getElementById('match-body').innerHTML = html;
}

function renderCompanyStep(person, candidates, current, total) {
  let stepsHtml = '<div class="step-row">';
  for (let i = 0; i < total; i++) {
    const done = i < current - 1;
    const active = i === current - 1;
    stepsHtml += `<div class="step-dot ${done ? 'done' : active ? 'active' : 'idle'}">${done ? '✓' : i + 1}</div>`;
    if (i < total - 1) stepsHtml += `<div class="step-line ${done ? 'done' : 'idle'}"></div>`;
  }
  stepsHtml += '</div>';

  let html = stepsHtml + `
    <div class="match-header">
      <div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px;margin-bottom:4px">ŞİRKET</div>
      <div class="name">${esc(person.name)}</div>
    </div>`;

  if (candidates.length > 0) {
    html += `<p class="section-label">${candidates.length} BENZER ŞİRKET BULUNDU</p>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px">Bunlardan biri mi? Seçin veya yeni oluşturun.</p>`;
    candidates.forEach(c => {
      html += `
        <div class="candidate-card ${c.match_type}" onclick="selectPersonContact(${c.id})">
          <div class="candidate-info">
            <div class="candidate-name">${esc(c.name)}</div>
          </div>
          <div class="score-badge ${c.match_type}">%${c.score}</div>
        </div>`;
    });
    html += `<div class="divider"><div class="divider-line"></div><span class="divider-txt">veya</span><div class="divider-line"></div></div>`;
  } else {
    html += `
      <div style="background:var(--surface);border-radius:var(--radius);padding:24px;text-align:center;margin-bottom:20px">
        <div style="font-size:36px;margin-bottom:10px">🔍</div>
        <div style="font-family:var(--font-head);font-size:15px;font-weight:700;margin-bottom:6px">Eşleşen şirket bulunamadı</div>
        <div style="font-size:13px;color:var(--muted)">Yeni bir şirket kaydı oluşturulacak.</div>
      </div>`;
  }

  html += `
    <button class="btn-primary" onclick="showNewCompanyModal()" style="background:var(--accent2);color:#fff">
      ➕ Yeni Şirket Oluştur
      <span style="display:block;font-size:11px;font-weight:400;margin-top:2px;opacity:.8">${esc(person.name)} adıyla kayıt açılacak</span>
    </button>`;

  document.getElementById('match-body').innerHTML = html;
}

function selectPersonContact(contactId) {
  const person = state.matchQueue[state.currentMatchIdx];
  state.matchResults.push({ slot: person.slot, contactId, isNew: !contactId, isCardContact: person.isCardContact });
  state.currentMatchIdx++;
  processNextInQueue();
}

// Yeni kontak modal — kişi bilgileri + Odoo zorunlu alanları
async function showNewContactModal() {
  const cfg = getConfig();
  const person = state.matchQueue[state.currentMatchIdx];

  // Kişiye ait mevcut bilgileri belirle (kartvizit veya form)
  const cd = person?.isCardContact ? (person.cardData || state.cardFields) : {};
  const ff = state.formFields;
  const slot = person?.slot || '';

  // Form alanından telefon/mail al (görüşülen 1/2/3 için)
  let prefill = { ...cd };
  if (!prefill.name) {
    if (slot === 'gorusulen_1') { prefill = { name: ff.gorusulen_1, phone: ff.gorusulen_1_tel, email: ff.gorusulen_1_mail }; }
    else if (slot === 'gorusulen_2') { prefill = { name: ff.gorusulen_2, phone: ff.gorusulen_2_tel, email: ff.gorusulen_2_mail }; }
    else if (slot === 'gorusulen_3') { prefill = { name: ff.gorusulen_3, phone: ff.gorusulen_3_tel, email: ff.gorusulen_3_mail }; }
  }

  const overlay = document.createElement('div');
  overlay.id = 'new-contact-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;display:flex;align-items:flex-end;';
  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:20px 20px 0 0;padding:24px;width:100%;max-height:90vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3 style="font-family:var(--font-head);font-size:17px">Yeni Kontak: <span style="color:var(--accent)">${esc(prefill.name || '')}</span></h3>
        <button onclick="document.getElementById('new-contact-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer">✕</button>
      </div>
      <div id="new-contact-fields-container">
        <div style="text-align:center;padding:20px;color:var(--muted)">
          <div class="pulse-ring" style="margin:0 auto 10px"></div>
          Yükleniyor...
        </div>
      </div>
      <button class="btn-primary" style="margin-top:16px" onclick="submitNewContact()">✅ Kontağı Oluştur ve Kaydet</button>
    </div>`;
  document.body.appendChild(overlay);

  // Odoo seçeneklerini çek (daha önce çekilmediyse)
  if (!state.odooOptions?.users?.length) {
    try {
      const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/odoo-options', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ odoo_config: { url: cfg.url, db: cfg.db, username: cfg.username, api_key: cfg.apiKey } }),
      });
      state.odooOptions = await res.json();
    } catch (err) {
      console.error('Odoo options error:', err);
    }
  }

  renderNewContactForm(prefill);
}

async function showNewCompanyModal() {
  const person = state.matchQueue[state.currentMatchIdx];
  const companyName = person?.name || '';
  const opts = state.odooOptions || {};
  const countries = opts.countries || [];
  const countrySel = countries.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'new-contact-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;display:flex;align-items:flex-end;';
  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:20px 20px 0 0;padding:24px;width:100%;max-height:90vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3 style="font-family:var(--font-head);font-size:17px">Yeni Şirket: <span style="color:var(--accent)">${esc(companyName)}</span></h3>
        <button onclick="document.getElementById('new-contact-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer">✕</button>
      </div>
      <p class="section-label" style="margin-bottom:12px">🏢 ŞİRKET BİLGİLERİ</p>
      <div class="field-row">
        <div class="field-label">Şirket Adı <span style="color:var(--danger)">*</span></div>
        <input class="field-input" id="nc-company-name" value="${esc(companyName)}" placeholder="Şirket Adı..."/>
      </div>
      <div class="field-row">
        <div class="field-label">Telefon</div>
        <input class="field-input" id="nc-company-phone" placeholder="Telefon..."/>
      </div>
      <div class="field-row">
        <div class="field-label">E-posta</div>
        <input class="field-input" id="nc-company-email" placeholder="E-posta..." type="email"/>
      </div>
      <div class="field-row">
        <div class="field-label">Website</div>
        <input class="field-input" id="nc-company-website" placeholder="Website..."/>
      </div>
      <button class="btn-primary" style="margin-top:16px" onclick="submitNewCompany()">✅ Şirketi Oluştur</button>
    </div>`;
  document.body.appendChild(overlay);
}

async function loadStatesForCompany(countryId) {
  const stateSelect = document.getElementById('nc-company-state_id');
  if (!stateSelect || !countryId) { stateSelect.innerHTML = '<option value="">-- Önce ülke seçin --</option>'; return; }
  stateSelect.innerHTML = '<option value="">Yükleniyor...</option>';
  const cfg = getConfig();
  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/states-by-country', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ odoo_config: { url: cfg.url, db: cfg.db, username: cfg.username, api_key: cfg.apiKey }, country_id: parseInt(countryId) }),
    });
    const data = await res.json();
    const states = data.states || [];
    stateSelect.innerHTML = '<option value="">-- Seçin --</option>' +
      (states.length ? states.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('') : '<option value="">Şehir yok</option>');
  } catch { stateSelect.innerHTML = '<option value="">Yüklenemedi</option>'; }
}

function submitNewCompany() {
  const name = document.getElementById('nc-company-name')?.value.trim();
  if (!name) { toast('❌ Şirket Adı zorunludur', 'error'); return; }

  const companyData = {
    name,
    phone: document.getElementById('nc-company-phone')?.value.trim() || '',
    email: document.getElementById('nc-company-email')?.value.trim() || '',
    website: document.getElementById('nc-company-website')?.value.trim() || '',
    vat: document.getElementById('nc-company-vat')?.value.trim() || '',
    street: document.getElementById('nc-company-street')?.value.trim() || '',
  };
  const countryEl = document.getElementById('nc-company-country_id');
  if (countryEl?.value) companyData.country_id = parseInt(countryEl.value);
  const stateEl = document.getElementById('nc-company-state_id');
  if (stateEl?.value) companyData.state_id = parseInt(stateEl.value);

  document.getElementById('new-contact-overlay').remove();
  const person = state.matchQueue[state.currentMatchIdx];
  state.matchResults.push({
    slot: person?.slot || 'company',
    contactId: null, isNew: true, isCompany: true,
    companyData,
  });
  state.currentMatchIdx++;
  processNextInQueue();
}

async function loadStatesForCountry(countryId) {
  const stateSelect = document.getElementById('nc-state_id');
  if (!stateSelect) return;
  if (!countryId) {
    stateSelect.innerHTML = '<option value="">-- Önce ülke seçin --</option>';
    return;
  }
  stateSelect.innerHTML = '<option value="">Yükleniyor...</option>';
  const cfg = getConfig();
  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/states-by-country', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        odoo_config: { url: cfg.url, db: cfg.db, username: cfg.username, api_key: cfg.apiKey },
        country_id: parseInt(countryId),
      }),
    });
    const data = await res.json();
    const states = data.states || [];
    if (states.length > 0) {
      stateSelect.innerHTML = '<option value="">-- Seçin --</option>' +
        states.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    } else {
      stateSelect.innerHTML = '<option value="">Bu ülke için şehir yok</option>';
    }
  } catch (err) {
    stateSelect.innerHTML = '<option value="">Yüklenemedi</option>';
  }
}

function renderNewContactForm(prefill) {
  const opts = state.odooOptions || {};
  const mf = state.manualFields;

  const makeInput = (key, label, value = '', required = false, type = 'text') => `
    <div class="field-row">
      <div class="field-label">${label}${required ? ' <span style="color:var(--danger)">*</span>' : ''}</div>
      <input class="field-input" id="nc-${key}" value="${esc(value)}" type="${type}"
        placeholder="${label}..." oninput="state.newContactData = state.newContactData||{}; state.newContactData['${key}']=this.value"/>
    </div>`;

  const makeSelect = (key, label, options, required = false) => {
    const sel = options.map(o => `<option value="${o.id}" ${mf[key] == o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
    return `
      <div class="field-row">
        <div class="field-label" style="color:var(--success)">${label}${required ? ' <span style="color:var(--danger)">*</span>' : ''}</div>
        <select class="field-input" id="mf-${key}"
          style="background:var(--surface2);color:var(--text);border:1px solid rgba(255,255,255,.1);padding:10px 12px;border-radius:8px;width:100%;appearance:none"
          onchange="state.manualFields['${key}']=this.value?parseInt(this.value):null">
          <option value="">-- Seçin --</option>
          ${sel}
        </select>
      </div>`;
  };

  // state.newContactData'yı prefill ile başlat
  state.newContactData = { ...prefill };

  let html = `<p class="section-label" style="margin-bottom:12px">👤 KİŞİ BİLGİLERİ</p>
    <p style="font-size:12px;color:var(--muted);margin-bottom:16px">Kartvizitten okunan bilgiler otomatik dolduruldu. İstediğiniz alanı düzenleyebilirsiniz.</p>`;
  html += makeInput('name', 'Ad Soyad', prefill.name || '');
  html += makeInput('function', 'İş Pozisyonu', prefill.function || '');
  html += makeInput('email', 'E-posta', prefill.email || '', false, 'email');
  html += makeInput('mobile', 'Cep', prefill.mobile || '');
  html += makeInput('phone', 'Telefon', prefill.phone || '');

  document.getElementById('new-contact-fields-container').innerHTML = html;
}

function submitNewContact() {
  // Kişi bilgilerini inputlardan oku — hiçbiri zorunlu değil
  const contactKeys = ['name','function','phone','mobile','email'];
  const newData = {};
  contactKeys.forEach(k => {
    const el = document.getElementById('nc-' + k);
    if (el) newData[k] = el.value.trim();
  });

  document.getElementById('new-contact-overlay').remove();
  const person = state.matchQueue[state.currentMatchIdx];
  state.matchResults.push({
    slot: person?.slot || 'card_contact',
    contactId: null, isNew: true,
    isCardContact: person?.isCardContact || false,
    contactData: newData,
    manualFields: { ...state.manualFields },
  });
  state.currentMatchIdx++;
  processNextInQueue();
}

// Eski selectContact — artık kullanılmıyor ama geriye dönük uyumluluk
function selectContact(id) {
  selectPersonContact(id);
}

// ─── Send to Odoo ─────────────────────────────────────────────────────────────
async function proceedToSave(companyId) {
  const cfg = getConfig();
  document.getElementById('match-body').innerHTML = `
    <div class="ai-loader show"><div class="pulse-ring"></div><p>Odoo'ya kaydediliyor...</p></div>`;

  // matchResults'tan seçimleri çıkar
  const results = state.matchResults || [];
  const g1Result = results.find(r => r.slot === 'gorusulen_1');
  const g2Result = results.find(r => r.slot === 'gorusulen_2');
  const g3Result = results.find(r => r.slot === 'gorusulen_3');
  const cardResult = results.find(r => r.slot === 'card_contact');
  const companyResult = results.find(r => r.slot === 'company');
  const extraCardResults = results.filter(r => r.slot.startsWith('extra_card_'));

  // Kartvizit kontağı için manualFields
  const cardManualFields = cardResult?.manualFields || state.manualFields;

  // Açıkça "Yeni Kontak Oluştur" onaylandıysa true
  const createNewCardContact = cardResult?.isNew === true;
  const createNewG1 = g1Result?.isNew === true;
  const createNewG2 = g2Result?.isNew === true;
  const createNewG3 = g3Result?.isNew === true;

  // Ekstra kartvizit sonuçları
  const extraCardData = extraCardResults.map((r, i) => {
    const queueItem = state.matchQueue.find(q => q.slot === r.slot);
    return {
      contact_id: r.contactId || null,
      is_new: r.isNew === true,
      card_data: queueItem?.cardData || {},
      manual_fields: r.manualFields || {},
    };
  });

  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/send-to-odoo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        odoo_config: { url: cfg.url, db: cfg.db, username: cfg.username, api_key: cfg.apiKey },
        scan_type: state.scanMode,
        form_fields: state.formFields,
        card_fields: createNewCardContact ? state.cardFields : {},
        manual_fields: cardManualFields,
        selected_contact_id: cardResult?.contactId || null,
        selected_gorusulen_1_id: g1Result?.contactId || null,
        selected_gorusulen_2_id: g2Result?.contactId || null,
        selected_gorusulen_3_id: g3Result?.contactId || null,
        create_new_gorusulen_1: createNewG1,
        create_new_gorusulen_2: createNewG2,
        create_new_gorusulen_3: createNewG3,
        gorusulen_1_data: g1Result?.contactData || null,
        gorusulen_2_data: g2Result?.contactData || null,
        gorusulen_3_data: g3Result?.contactData || null,
        extra_cards: extraCardData,
        selected_company_id: companyResult?.contactId || companyId || null,
        create_new_company: companyResult?.isNew === true,
        company_data: companyResult?.companyData || null,
      }),
    });
    const result = await res.json();
    saveToHistory(result);
    // Bulk modda callback çağır, normal modda sonuç ekranı göster
    if (window._bulkMode && window._bulkOnComplete) {
      await window._bulkOnComplete(result);
    } else {
      renderResult(result);
      showScreen('result');
    }
  } catch (err) {
    toast('Kayıt hatası: ' + err.message, 'error');
    document.getElementById('match-body').innerHTML = `
      <div style="padding:24px;text-align:center">
        <div style="font-size:48px;margin-bottom:16px">❌</div>
        <div style="font-family:var(--font-head);font-size:17px;font-weight:700;margin-bottom:8px;color:var(--danger)">Kayıt Hatası</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:24px;word-break:break-word">${esc(err.message)}</div>
        <button class="btn-primary" onclick="showScreen('preview')">← Önizlemeye Dön</button>
      </div>`;
  }
}

function renderMatchNoOdoo() {
  document.getElementById('match-body').innerHTML = `
    <div style="padding:32px;text-align:center">
      <div style="font-size:48px;margin-bottom:16px">⚠️</div>
      <div style="font-family:var(--font-head);font-size:17px;font-weight:700;margin-bottom:8px">Odoo Bağlantısı Yok</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:24px">Ayarlar ekranından Odoo bilgilerini girin.</div>
      <button class="btn-primary" onclick="showScreen('settings')">⚙️ Ayarlara Git</button>
    </div>`;
}

// ─── Result ───────────────────────────────────────────────────────────────────
function renderResult(result) {
  let cards = `<div class="result-card"><h4>OLUŞTURULAN KAYITLAR</h4>`;
  if (result.visit_id) cards += `<div class="result-row"><span class="result-badge module">Ziyaret Kaydı</span><span class="result-val">#${result.visit_id}</span></div>`;
  if (result.visit_error) cards += `<div style="margin-top:8px;padding:10px;background:rgba(255,107,107,.1);border-radius:8px;font-size:12px;color:var(--danger)">⚠️ Ziyaret kaydı oluşturulamadı: ${esc(result.visit_error)}</div>`;
  if (result.contact_id) {
    const badge = result.contact_existed ? 'existed' : 'contact';
    const label = result.contact_existed ? 'Mevcut Kontak' : 'Yeni Kontak';
    cards += `<div class="result-row"><span class="result-badge ${badge}">${label}</span><span class="result-val">#${result.contact_id}</span></div>`;
  }
  if (result.company_id) cards += `<div class="result-row"><span class="result-badge module">Şirket</span><span class="result-val">#${result.company_id}</span></div>`;
  if (result.record_error) cards += `<div style="margin-top:8px;padding:10px;background:rgba(255,107,107,.1);border-radius:8px;font-size:12px;color:var(--danger)">${esc(result.record_error)}</div>`;
  cards += `</div>`;
  document.getElementById('result-cards').innerHTML = cards;
  const linkBtn = document.getElementById('odoo-link-btn');
  if (result.odoo_url) { linkBtn.style.display = 'block'; linkBtn.onclick = () => window.open(result.odoo_url, '_blank'); }
  else linkBtn.style.display = 'none';
}

// ─── History ──────────────────────────────────────────────────────────────────
function saveToHistory(result) {
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  hist.unshift({
    formFields: state.formFields,
    cardFields: state.cardFields,
    extraCards: state.extraCards || [],
    result,
    scanMode: state.scanMode,
    fileBase64: state.fileBase64,
    fileMime: state.fileMime,
    timestamp: new Date().toISOString(),
    bulkSessionId: state.bulkSessionId || null,
    fileName: state.fileName || null,
    scannedBy: state.currentUser ? state.currentUser.name : null,
  });
  localStorage.setItem('scan_history', JSON.stringify(hist.slice(0, 50)));
}

function applyHistoryFilters() {
  renderHistoryList(
    document.getElementById('hist-search')?.value,
    document.getElementById('hist-filter-user')?.value,
    document.getElementById('hist-filter-company')?.value,
    document.getElementById('hist-filter-fuar')?.value,
    document.getElementById('hist-filter-aksiyon')?.value
  );
}

function renderHistory(searchQuery, filterUser, filterCompany, filterFuar, filterAksiyon) {
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  const body = document.getElementById('history-body');

  // Filtre seçeneklerini hesapla
  const users = [...new Set(hist.map(h => h.scannedBy).filter(Boolean))];
  const companies = [...new Set(hist.map(h => h.cardFields?.company || h.formFields?.sirket).filter(Boolean))];
  const fuarlar = [...new Set(hist.map(h => h.formFields?.fuar_adi).filter(Boolean))];
  const aksiyonlar = [...new Set(hist.map(h => h.formFields?.aksiyon_plan).filter(Boolean))];

  const makeSelect = (id, placeholder, options, val) => {
    if (!options.length) return '';
    const opts = options.map(o => '<option value="' + esc(o) + '"' + (val === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
    return '<select id="' + id + '" class="field-input" onchange="applyHistoryFilters()" ' +
      'style="background:var(--surface2);color:var(--text);appearance:none;font-size:12px;padding:8px 10px">' +
      '<option value="">' + placeholder + '</option>' + opts + '</select>';
  };

  // Kontrol panelini oluştur (sadece ilk yüklemede veya kontroller yoksa)
  if (!document.getElementById('hist-search')) {
    const q = (searchQuery || '');
    const fu = filterUser || '';
    const fc = filterCompany || '';
    const ff2 = filterFuar || '';
    const fa = filterAksiyon || '';
    const activeFilters = [fu,fc,ff2,fa].filter(Boolean).length;

    const controls = document.createElement('div');
    controls.id = 'hist-controls';
    controls.style.cssText = 'margin-bottom:16px';
    controls.innerHTML =
      '<input id="hist-search" class="field-input" placeholder="🔍 Ara..." value="' + esc(q) + '" ' +
      'oninput="applyHistoryFilters()" style="margin-bottom:8px"/>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">' +
      makeSelect('hist-filter-user', '👤 Tarayan', users, fu) +
      makeSelect('hist-filter-company', '🏢 Şirket', companies, fc) +
      makeSelect('hist-filter-fuar', '📋 Fuar', fuarlar, ff2) +
      makeSelect('hist-filter-aksiyon', '🎯 Aksiyon', aksiyonlar, fa) +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<span id="hist-count-info" style="font-size:11px;color:var(--muted)"></span>' +
      '<button id="hist-clear-btn" onclick="renderHistory()" style="font-size:11px;color:var(--danger);background:none;border:none;cursor:pointer;display:none">✕ Temizle</button>' +
      '</div>';

    const list = document.createElement('div');
    list.id = 'hist-list';
    body.innerHTML = '';
    body.appendChild(controls);
    body.appendChild(list);
  }

  renderHistoryList(searchQuery, filterUser, filterCompany, filterFuar, filterAksiyon);
}

function renderHistoryList(searchQuery, filterUser, filterCompany, filterFuar, filterAksiyon) {
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  const listEl = document.getElementById('hist-list');
  if (!listEl) { renderHistory(searchQuery, filterUser, filterCompany, filterFuar, filterAksiyon); return; }

  const q = (searchQuery || document.getElementById('hist-search')?.value || '').toLowerCase().trim();
  const fu = filterUser || document.getElementById('hist-filter-user')?.value || '';
  const fc = filterCompany || document.getElementById('hist-filter-company')?.value || '';
  const ff2 = filterFuar || document.getElementById('hist-filter-fuar')?.value || '';
  const fa = filterAksiyon || document.getElementById('hist-filter-aksiyon')?.value || '';

  const filtered = hist.map((item, idx) => ({ item, idx })).filter(({ item }) => {
    const ff = item.formFields || {};
    const cf = item.cardFields || {};
    if (fu && item.scannedBy !== fu) return false;
    if (fc && (cf.company || ff.sirket) !== fc) return false;
    if (ff2 && ff.fuar_adi !== ff2) return false;
    if (fa && ff.aksiyon_plan !== fa) return false;
    if (!q) return true;
    const searchable = [
      cf.name, cf.company, cf.function, cf.email, cf.phone, cf.mobile,
      ff.fuar_adi, ff.sirket, ff.tarih,
      ff.gorusulen_1, ff.gorusulen_1_tel, ff.gorusulen_1_mail,
      ff.gorusulen_2, ff.gorusulen_2_tel, ff.gorusulen_2_mail,
      ff.gorusulen_3, ff.gorusme_yapan_1, ff.gorusme_yapan_2, ff.gorusme_yapan_3,
      ff.notlar, ff.aksiyon_plan, ff.oncelik,
      item.scannedBy, item.fileName,
      item.result?.visit_id ? 'Ziyaret #' + item.result.visit_id : '',
    ].map(v => (v || '').toLowerCase());
    return searchable.some(s => s.includes(q));
  });

  // Sayaç güncelle
  const countEl = document.getElementById('hist-count-info');
  if (countEl) countEl.textContent = filtered.length + ' sonuç · toplam ' + hist.length + ' kayıt';
  const clearBtn = document.getElementById('hist-clear-btn');
  if (clearBtn) clearBtn.style.display = (q || fu || fc || ff2 || fa) ? 'block' : 'none';

  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty-state"><div class="ei">🔍</div><p>Sonuç bulunamadı</p></div>';
    return;
  }

  const modeIcons = { form: '📋', businessCard: '📸', both: '📋📸' };
  const seenSessions = {};
  let html = '';

  filtered.forEach(({ item, idx }) => {
    const name = item.cardFields?.name || item.formFields?.gorusulen_1 || 'İsimsiz';
    const company = item.cardFields?.company || item.formFields?.sirket || '';
    const fuar = item.formFields?.fuar_adi || '';
    const aksiyon = item.formFields?.aksiyon_plan || '';
    const sid = item.bulkSessionId;

    if (sid && !seenSessions[sid]) {
      const groupCount = hist.filter(h => h.bulkSessionId === sid).length;
      seenSessions[sid] = true;
      html += '<div style="display:flex;align-items:center;gap:8px;margin:16px 0 8px">' +
        '<div style="font-size:11px;font-weight:700;color:var(--warn);letter-spacing:1px;font-family:var(--font-head)">📦 TOPLU YÜKLEME</div>' +
        '<div style="font-size:11px;color:var(--muted)">' + groupCount + ' kayıt · ' +
        new Date(item.timestamp).toLocaleDateString('tr-TR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) + '</div>' +
        '</div>';
    }

    html += '<div class="hist-item" onclick="showHistoryDetail(' + idx + ')" style="cursor:pointer' + (sid ? ';border-left:3px solid var(--warn);padding-left:13px' : '') + '">' +
      '<div class="hist-name">' + esc(name) + '</div>' +
      (company ? '<div class="hist-company">' + esc(company) + '</div>' : '') +
      (fuar ? '<div style="font-size:11px;color:var(--accent);margin-top:3px">📋 ' + esc(fuar) + '</div>' : '') +
      '<div class="hist-footer">' +
      '<span class="hist-date">' + new Date(item.timestamp).toLocaleDateString('tr-TR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) + '</span>' +
      (item.scannedBy ? '<span style="font-size:10px;color:var(--muted)">👤 ' + esc(item.scannedBy) + '</span>' : '') +
      (aksiyon ? '<span style="font-size:10px;color:var(--accent2)">🎯 ' + esc(aksiyon) + '</span>' : '') +
      (sid ? '<span style="font-size:10px;color:var(--warn)">📦</span>' : '') +
      (item.result?.visit_id ? '<span class="result-badge module" style="font-size:10px">Ziyaret #' + item.result.visit_id + '</span>' : '') +
      '</div></div>';
  });

  listEl.innerHTML = html;
}


function showHistoryDetail(idx) {
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  const item = hist[idx];
  if (!item) return;
  const ff = item.formFields || {};
  const cf = item.cardFields || {};
  const result = item.result || {};

  const makeEditable = (label, fieldset, key, value) => {
    const safeLabel = label.replace(/"/g, '&quot;');
    return `<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--surface2);align-items:center">
      <div style="font-size:12px;color:var(--muted);min-width:130px;flex-shrink:0">${safeLabel}</div>
      <input style="font-size:13px;color:var(--text);background:transparent;border:none;flex:1;outline:none;border-bottom:1px solid var(--accent2)"
        value="${esc(value || '')}"
        onchange="updateHistoryField(${idx}, '${fieldset}', '${key}', this.value)"/>
    </div>`;
  };

  const formLabels = { fuar_adi:'Fuar Adı', sirket:'Şirket', tarih:'Tarih',
    gorusulen_1:'Görüşülen 1', gorusulen_1_tel:'Görüşülen 1 Tel', gorusulen_1_mail:'Görüşülen 1 Mail',
    gorusulen_2:'Görüşülen 2', gorusulen_2_tel:'Görüşülen 2 Tel', gorusulen_2_mail:'Görüşülen 2 Mail',
    gorusulen_3:'Görüşülen 3', gorusme_yapan_1:'Görüşme Yapan 1', gorusme_yapan_2:'Görüşme Yapan 2',
    notlar:'Notlar', aksiyon_plan:'Aksiyon Planı', oncelik:'Öncelik' };
  let formHtml = '';
  Object.entries(formLabels).forEach(([k, l]) => { if (ff[k]) formHtml += makeEditable(l, 'formFields', k, ff[k]); });

  const cardLabels = { name:'Ad Soyad', company:'Şirket', function:'Ünvan', phone:'Telefon', mobile:'Cep', email:'E-posta', website:'Website' };
  let cardHtml = '';
  Object.entries(cardLabels).forEach(([k, l]) => { if (cf[k]) cardHtml += makeEditable(l, 'cardFields', k, cf[k]); });

  const hist_total = JSON.parse(localStorage.getItem('scan_history') || '[]').length;
  const overlay = document.createElement('div');
  overlay.id = 'history-detail-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1000;overflow-y:auto;padding:20px;';
  overlay.innerHTML = `
    <div style="max-width:600px;margin:0 auto;background:var(--surface);border-radius:var(--radius);padding:24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <button onclick="document.getElementById('history-detail-overlay').remove();${idx > 0 ? 'showHistoryDetail(' + (idx-1) + ')' : ''}" 
          style="background:var(--surface2);border:none;color:${idx > 0 ? 'var(--text)' : 'var(--muted)'};border-radius:10px;width:36px;height:36px;font-size:18px;cursor:${idx > 0 ? 'pointer' : 'default'}">←</button>
        <h3 style="font-family:var(--font-head);font-size:15px">${idx+1} / ${hist_total}</h3>
        <button onclick="document.getElementById('history-detail-overlay').remove();${idx < hist_total-1 ? 'showHistoryDetail(' + (idx+1) + ')' : ''}"
          style="background:var(--surface2);border:none;color:${idx < hist_total-1 ? 'var(--text)' : 'var(--muted)'};border-radius:10px;width:36px;height:36px;font-size:18px;cursor:${idx < hist_total-1 ? 'pointer' : 'default'}">→</button>
      </div>
      <button onclick="document.getElementById('history-detail-overlay').remove()" style="position:absolute;top:28px;right:28px;background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer">✕</button>
      ${item.fileBase64 ? `<div style="margin-bottom:20px">
        <p class="section-label" style="margin-bottom:8px">📷 YÜKLENEN BELGE</p>
        ${(item.fileMime||'').includes('pdf') ?
          `<div style="background:var(--surface2);border-radius:8px;padding:16px;text-align:center">
            <div style="font-size:36px;margin-bottom:8px">📄</div>
            <div style="font-size:13px;color:var(--muted);margin-bottom:12px">${esc(item.fileName || 'PDF Dosyası')}</div>
            <a href="data:application/pdf;base64,${item.fileBase64}" download="${esc(item.fileName || 'belge.pdf')}"
              style="background:var(--accent);color:#0f0e17;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;display:inline-block">
              ⬇️ PDF İndir
            </a>
          </div>` :
          `<div>
            <img src="data:${item.fileMime||'image/jpeg'};base64,${item.fileBase64}"
              onclick="this.style.maxHeight=this.style.maxHeight==='none'?'300px':'none';this.style.cursor=this.style.maxHeight==='none'?'zoom-out':'zoom-in'"
              style="width:100%;border-radius:8px;max-height:300px;object-fit:contain;background:var(--surface2);cursor:zoom-in;transition:max-height .3s"/>
            <div style="text-align:center;margin-top:8px">
              <a href="data:${item.fileMime||'image/jpeg'};base64,${item.fileBase64}" download="${esc(item.fileName || 'belge.jpg')}"
                style="font-size:11px;color:var(--muted);text-decoration:none">⬇️ İndir</a>
            </div>
          </div>`
        }
      </div>` : ''}
      ${formHtml ? `<p class="section-label" style="margin-bottom:4px">📋 FORM BİLGİLERİ</p>${formHtml}` : ''}
      ${cardHtml ? `<p class="section-label" style="margin-top:20px;margin-bottom:4px">📸 KARTVİZİT</p>${cardHtml}` : ''}
      <div style="margin-top:20px;display:flex;flex-direction:column;gap:10px">
        ${result.odoo_url ? `<button class="btn-primary" onclick="window.open('${result.odoo_url}','_blank')">🔗 Odoo'da Görüntüle</button>` : ''}
        <button class="btn-primary" style="background:var(--accent2)" onclick="updateOdooFromHistory(${idx})">🔄 Odoo'da Güncelle</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
function updateHistoryField(idx, fieldset, key, value) {
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  if (!hist[idx]) return;
  if (!hist[idx][fieldset]) hist[idx][fieldset] = {};
  hist[idx][fieldset][key] = value;
  localStorage.setItem('scan_history', JSON.stringify(hist));
}

async function updateOdooFromHistory(idx) {
  const hist = JSON.parse(localStorage.getItem('scan_history') || '[]');
  const item = hist[idx];
  if (!item?.result?.visit_id) { toast('Bu kayıt için Odoo ziyaret ID bulunamadı', 'error'); return; }
  const cfg = getConfig();
  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/update-visit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        odoo_config: { url: cfg.url, db: cfg.db, username: cfg.username, api_key: cfg.apiKey },
        visit_id: item.result.visit_id,
        form_fields: item.formFields || {},
        card_fields: item.cardFields || {},
      }),
    });
    const data = await res.json();
    if (data.success) toast('Odoo kaydı güncellendi');
    else toast('Güncelleme hatası: ' + (data.error || ''), 'error');
  } catch (err) { toast(err.message, 'error'); }
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
  document.getElementById('cfg-module').value = cfg.customModule || 'x_ziyaret_toplanti';
  renderCustomFieldsList(cfg.customFields || []);
}

function renderCustomFieldsList(fields) {
  document.getElementById('custom-fields-list').innerHTML = fields.map((f, i) => `
    <div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border-radius:8px;padding:8px 12px;margin-bottom:6px">
      <span style="flex:1;font-size:13px;color:var(--accent2)">${esc(f.key)}</span>
      <span style="flex:1;font-size:13px;color:var(--muted)">${esc(f.label)}</span>
      <button onclick="removeCustomField(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px">✕</button>
    </div>`).join('');
}

function addCustomField() {
  const key = document.getElementById('new-field-key').value.trim();
  const label = document.getElementById('new-field-label').value.trim();
  if (!key || !label) { toast('Alan adı ve etiket girin', 'error'); return; }
  const cfg = getConfig(); const fields = cfg.customFields || [];
  fields.push({ key, label }); cfg.customFields = fields; saveConfig(cfg);
  document.getElementById('new-field-key').value = '';
  document.getElementById('new-field-label').value = '';
  renderCustomFieldsList(fields); toast('Alan eklendi');
}

function removeCustomField(i) {
  const cfg = getConfig(); const fields = cfg.customFields || [];
  fields.splice(i, 1); cfg.customFields = fields; saveConfig(cfg);
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
  saveConfig(cfg); toast('Ayarlar kaydedildi'); refreshHome();
}

async function testConnection() {
  const cfg = getConfig();
  if (!cfg.url) { toast("Önce Odoo URL girin", 'error'); return; }
  const btn = document.querySelector('[onclick="testConnection()"]');
  btn.disabled = true; btn.textContent = 'Test ediliyor...';
  const res_el = document.getElementById('conn-result');
  try {
    const res = await fetch(cfg.backendUrl.replace(/\/$/, '') + '/api/test-connection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ odoo_config: { url: cfg.url, db: cfg.db, username: cfg.username, api_key: cfg.apiKey } }),
    });
    const data = await res.json();
    res_el.style.display = 'block';
    res_el.innerHTML = data.success
      ? `<span style="color:var(--success)">✓ Bağlantı başarılı! (uid: ${data.uid})</span>`
      : `<span style="color:var(--danger)">✗ ${data.message}</span>`;
  } catch (e) {
    res_el.style.display = 'block';
    res_el.innerHTML = `<span style="color:var(--danger)">✗ Sunucuya ulaşılamadı: ${e.message}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = '🔌 Bağlantıyı Test Et';
  }
}

function clearAllData() {
  if (!confirm('Tüm veriler silinecek. Emin misiniz?')) return;
  localStorage.clear(); toast('Tüm veriler temizlendi'); loadSettingsForm();
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }

// Başlangıçta auth kontrolü
try {
  const _savedUser = JSON.parse(localStorage.getItem('odoo_user') || 'null');
  if (_savedUser) {
    state.currentUser = _savedUser;
    refreshHome();
  } else {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const ls = document.getElementById('screen-login');
    if (ls) ls.classList.add('active');
  }
} catch(e) {
  // Herhangi bir hata olursa login ekranına dön
  localStorage.removeItem('odoo_user');
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const ls = document.getElementById('screen-login');
  if (ls) ls.classList.add('active');
}
