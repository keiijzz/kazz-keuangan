const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => [...(p || document).querySelectorAll(s)];

const fmtRp = (n) => {
  const v = Math.round(Number(n) || 0);
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString('id-ID');
  return (neg ? '-' : '') + 'Rp ' + s;
};

const fmtPct = (n) => (Number(n) * 100).toFixed(1) + '%';

const api = (url, opts = {}) =>
  fetch(url, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
  }).then((r) => r.json());

let _state = { tab: 'dashboard' };
let _summary = null;
let _debts_cache = null;
let _lastAlertKey = '';

// ================= ALERT SYSTEM =================

function toggleAlerts() {
  const panel = $('#alert-panel');
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  if (!isOpen && _summary) renderAlertPanel(_summary.alerts);
}

function closeAlerts() { $('#alert-panel')?.classList.remove('open'); }

function renderAlerts(alerts) {
  if (!alerts) return;
  const highCount = alerts.filter((a) => a.level === 'high').length;
  const totalCount = alerts.length;
  const badge = $('#bell-badge');
  if (totalCount === 0) { badge.classList.add('hidden'); }
  else {
    badge.classList.remove('hidden');
    badge.textContent = String(Math.min(totalCount, 99));
    badge.style.background = highCount > 0
      ? 'linear-gradient(135deg,#f87171,#fb7185)'
      : 'linear-gradient(135deg,#fbbf24,#f97316)';
  }
  renderAlertPanel(alerts);
  toastNewAlerts(alerts);
}

function renderAlertPanel(alerts) {
  const panel = $('#alert-panel');
  if (!panel) return;
  if (!alerts || alerts.length === 0) {
    panel.innerHTML = `<div class="alert-panel-title">
      <span>Semua Aman 🎉</span>
      <button class="alert-panel-clear" onclick="toggleAlerts()">Tutup</button>
    </div>
    <div class="empty-state" style="padding:24px">
      <div style="font-size:32px">✨</div>
      <div style="margin-top:6px">Tidak ada peringatan</div>
    </div>`;
    badgeCount(0);
    return;
  }
  panel.innerHTML = `
    <div class="alert-panel-title">
      <span>Peringatan (${alerts.length})</span>
      <button class="alert-panel-clear" onclick="closeAlerts()">Tutup</button>
    </div>
    ${alerts.map((a, i) => `
      <div class="alert-item level-${a.level}">
        <div class="alert-icon">${a.icon || '•'}</div>
        <div class="alert-text">${a.text}</div>
        <button class="alert-close" onclick="dismissAlert(this)">✕</button>
      </div>
    `).join('')}
  `;
}

function dismissAlert(btn) {
  const item = btn.closest('.alert-item');
  item.style.opacity = '0.3';
  setTimeout(() => item.remove(), 180);
  const remaining = $$('#alert-panel .alert-item').length - 1;
  badgeCount(remaining);
  if (remaining === 0 && _summary) {
    _summary.alerts = [];
    renderAlerts([]);
  }
}

function badgeCount(n) {
  const badge = $('#bell-badge');
  if (n <= 0) badge.classList.add('hidden');
  else { badge.classList.remove('hidden'); badge.textContent = String(n); }
}

let _toasts = new Set();

function toastNewAlerts(alerts) {
  const sessionKey = 'keuangan_toasts';
  let seen = new Set();
  try { seen = new Set(JSON.parse(sessionStorage.getItem(sessionKey) || '[]')); } catch (e) {}
  const now = new Set();
  alerts.forEach((a) => {
    const key = a.level + '|' + a.text;
    now.add(key);
    if (a.level === 'high' && !seen.has(key)) {
      showToast(a.icon || '⚠', a.text, a.level);
    }
  });
  try { sessionStorage.setItem(sessionKey, JSON.stringify([...now])); } catch (e) {}
}

function showToast(icon, text, level) {
  const toaster = $('#toaster');
  const t = document.createElement('div');
  t.className = `toast level-${level || 'low'}`;
  t.innerHTML = `<div class="toast-icon">${icon || '•'}</div>
    <div class="toast-content">
      <div class="toast-title">${level === 'high' ? 'Perlu Tindakan!' : level === 'med' ? 'Perhatian' : 'Info'}</div>
      <div class="toast-body">${text}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
  toaster.appendChild(t);
  setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 320); }, 9000);
}

// Close alert panel on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.bell-btn') && !e.target.closest('.alert-panel')) {
    closeAlerts();
  }
});

// ================= TAB NAVIGATION =================

function switchTab(tab) {
  _state.tab = tab;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.tab === tab));
  $('#page-title').textContent = {
    dashboard: 'Dashboard', transaksi: 'Catatan Harian', dompet: 'Dompet & Transfer',
    tagihan: 'Kalender Tagihan', hutang: 'Hutang & Piutang', anggaran: 'Anggaran Bulanan',
    aset: 'Aset & Kekayaan Bersih', tujuan: 'Dana Darurat & Tujuan', tren: 'Tren Bulanan', import: 'Import Data',
  }[tab] || tab;
  renderTab(tab);
}

function toggleSidebar() { $('#sidebar').classList.toggle('open'); }

$$('.nav-item').forEach((n) => n.addEventListener('click', () => { switchTab(n.dataset.tab); $('#sidebar').classList.remove('open'); }));

function renderTab(tab) {
  const el = $('#content');
  el.innerHTML = '<div style="padding:50px;text-align:center;color:var(--text3)"><div style="font-size:26px;margin-bottom:8px">⏳</div>Loading...</div>';
  const fns = { dashboard: renderDashboard, transaksi: renderTransaksi, dompet: renderDompet, tagihan: renderTagihan, hutang: renderHutang, anggaran: renderAnggaran, aset: renderAset, tujuan: renderTujuan, tren: renderTren, import: renderImport };
  (fns[tab] || renderDashboard)(el);
}

// ================= DASHBOARD =================

function renderDashboard(el) {
  Promise.all([api('/api/summary'), api('/api/debts')]).then(([s, debts]) => {
    _summary = s;
    _debts_cache = debts;
    renderAlerts(s.alerts);
    const pctClass = (p) => p > 1 ? 'bad' : p > 0.8 ? 'warn' : 'good';
    const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const today = new Date();
    const todayLabel = `${today.getDate()} ${monthNames[today.getMonth()]} ${today.getFullYear()}`;

    el.innerHTML = `
      <div class="hero-card" style="margin-bottom:14px">
        <div class="card-label">💼 Total Saldo Dompet · ${todayLabel}</div>
        <div class="card-value text-green" style="color:${s.saldoTotal >= 0 ? 'var(--green)' : 'var(--red)'} !important">${fmtRp(s.saldoTotal)}</div>
        <div class="hero-grid" style="margin-top:16px">
          <div class="hero-stat">
            <div class="hero-stat-label">💰 Pemasukan</div>
            <div class="hero-stat-value" style="color:var(--green)">${fmtRp(s.pemasukan)}</div>
          </div>
          <div class="hero-stat">
            <div class="hero-stat-label">💸 Pengeluaran</div>
            <div class="hero-stat-value" style="color:var(--red)">${fmtRp(s.pengeluaran)}</div>
          </div>
          <div class="hero-stat">
            <div class="hero-stat-label">📥 Sisa Bulan Ini</div>
            <div class="hero-stat-value" style="color:${s.sisa >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtRp(s.sisa)}</div>
          </div>
          <div class="hero-stat">
            <div class="hero-stat-label">📉 Net Worth</div>
            <div class="hero-stat-value" style="color:${s.assets.netWorth >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtRp(s.assets.netWorth)}</div>
          </div>
        </div>
      </div>

      <div class="cards cards-4">
        <div class="card card-sm">
          <div class="card-label">🛡 Cicilan/Bulan</div>
          <div class="card-value text-red">${fmtRp(s.debts.cicilan)}</div>
          <div class="card-sub"><span class="chip ${s.debts.dti > 0.35 ? 'chip-red' : s.debts.dti > 0.3 ? 'chip-orange' : 'chip-green'}">DTI ${(s.debts.dti * 100).toFixed(1)}%</span> via ${s.debts.count} utang</div>
        </div>
        <div class="card card-sm">
          <div class="card-label">🧾 Sisa Pokok Utang</div>
          <div class="card-value text-orange">${fmtRp(s.debts.sisa)}</div>
          <div class="card-sub">Harus lunas secepatnya</div>
        </div>
        <div class="card card-sm">
          <div class="card-label">🔔 Tagihan Telat</div>
          <div class="card-value ${s.bills.overdue > 0 ? 'text-red' : 'text-green'}">${s.bills.overdue} ${s.bills.overdue > 0 ? '(⚠ denda!)' : ''}</div>
          <div class="card-sub">${s.bills.dueToday > 0 ? `<span class="chip chip-orange">${s.bills.dueToday} jatuh tempo hari ini</span>` : s.bills.unpaid > 0 ? `${s.bills.unpaid} belum dibayar` : 'Semua lunas'}</div>
        </div>
        <div class="card card-sm">
          <div class="card-label">🛟 Dana Darurat</div>
          <div class="card-value ${s.emergency.progress >= 1 ? 'text-green' : s.emergency.progress > 0 ? 'text-orange' : 'text-red'}">${fmtPct(s.emergency.progress)}</div>
          <div class="card-sub">${fmtRp(s.emergency.saldo)} / ${fmtRp(s.emergency.targetDarurat)}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Dompet & Rekening</div>
        <div class="cards cards-2">
          ${s.wallets.map((w) => {
            const avatar = w.jenis === 'Cash' ? '💵' : w.jenis === 'E-Wallet' ? '📱' : '🏦';
            return `<div class="wallet-card">
              <div class="wallet-balance-row">
                <div class="wallet-avatar">${avatar}</div>
                <div class="wallet-info">
                  <h4>${w.name}</h4>
                  <span>${w.jenis} · ↑${fmtRp(w.masuk)} ↓${fmtRp(w.keluar)}</span>
                </div>
              </div>
              <div class="wallet-amount" style="color:${w.saldo >= 0 ? 'var(--green)' : 'var(--red)'};">${fmtRp(w.saldo)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Alokasi Anggaran Bulan Ini</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Kategori</th><th>Target</th><th>Realisasi</th><th class="td-right">Sisa</th><th>Progres</th></tr></thead>
            <tbody>
              ${s.budget.map((b) => `<tr>
                <td><b>${b.kategori}</b></td>
                <td class="rupiah">${fmtRp(b.target)}</td>
                <td class="rupiah" style="color:${b.over ? 'var(--red)' : 'var(--text)'}">${fmtRp(b.realisasi)}</td>
                <td class="td-right rupiah" style="color:${b.sisa_anggaran >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtRp(b.sisa_anggaran)}</td>
                <td style="min-width:130px">
                  <div class="progress-bar"><div class="progress-fill ${pctClass(b.realisasi_persen)}" style="width:${Math.min(b.realisasi_persen * 100, 100)}%"></div></div>
                  <span class="small">${fmtPct(b.realisasi_persen)} <span class="chip ${b.over ? 'chip-red' : 'chip-green'}">${b.over ? 'OVER' : 'OK'}</span></span>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Rencana Lunas Pinjol — urutan prioritas</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Nama</th><th>Pemberi</th><th class="td-right">Sisa Pokok</th><th class="td-right">Cicilan/bln</th><th>Catatan</th></tr></thead>
            <tbody>
              ${(() => {
                const ordered = _debts_cache?.filter((d) => d.status === 'Aktif').sort((a, b) => (parseInt(a.urutan_lunasin) || 99) - (parseInt(b.urutan_lunasin) || 99)) || [];
                if (ordered.length === 0) return '<tr><td colspan="6" class="empty-state">Tidak ada utang aktif 🎉</td></tr>';
                return ordered.map((d) => `<tr>
                  <td><span class="badge badge-info">${d.urutan_lunasin || '-'}</span></td>
                  <td><b>${d.name}</b></td>
                  <td class="muted">${d.pemberi} <span class="chip chip-blue">${d.jenis}</span></td>
                  <td class="td-right rupiah">${fmtRp(d.sisa_pokok)}</td>
                  <td class="td-right rupiah">${fmtRp(d.cicilan_bulanan)}</td>
                  <td class="small">${d.catatan}</td>
                </tr>`).join('');
              })()}
            </tbody>
          </table>
        </div>
      </div>
    `;
  });
}

// ================= TRANSAKSI =================

function renderTransaksi(el) {
  const today = new Date().getDate();
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="section-title" style="margin-bottom:14px">Tambah Transaksi</div>
      <div class="form-row" id="txn-form">
        <div class="form-group" style="max-width:78px">
          <label>Tanggal</label>
          <input id="txn-tgl" type="number" min="1" max="31" value="${today}">
        </div>
        <div class="form-group" style="flex:2">
          <label>Keterangan</label>
          <input id="txn-ket" placeholder="Contoh: Beli beras, Gajian, Cicilan TikTok...">
        </div>
        <div class="form-group">
          <label>Kategori</label>
          <select id="txn-kat">
            <option value="Pemasukan">Pemasukan</option>
            <option value="Kebutuhan Pokok">Kebutuhan Pokok</option>
            <option value="Cicilan/Utang" selected>Cicilan/Utang</option>
            <option value="Tabungan/Dana Darurat">Tabungan/Dana Darurat</option>
            <option value="Keinginan/Fleksibel">Keinginan/Fleksibel</option>
          </select>
        </div>
        <div class="form-group" style="max-width:130px">
          <label>Masuk (Rp)</label>
          <input id="txn-masuk" type="number" min="0" placeholder="0">
        </div>
        <div class="form-group" style="max-width:130px">
          <label>Keluar (Rp)</label>
          <input id="txn-keluar" type="number" min="0" placeholder="0">
        </div>
        <div class="form-group">
          <label>Dompet</label>
          <select id="txn-wallet"></select>
        </div>
        <button class="btn btn-primary btn-sm" onclick="addTxn()" style="align-self:flex-end">💾 Simpan</button>
      </div>
    </div>
    <div class="filter-bar">
      <input id="txn-search" placeholder="🔍 Cari keterangan..." oninput="loadTransactions()">
      <select id="txn-filter-kat" onchange="loadTransactions()">
        <option value="">Semua Kategori</option>
        <option value="Pemasukan">Pemasukan</option>
        <option value="Kebutuhan Pokok">Kebutuhan Pokok</option>
        <option value="Cicilan/Utang">Cicilan/Utang</option>
        <option value="Tabungan/Dana Darurat">Tabungan/Dana Darurat</option>
        <option value="Keinginan/Fleksibel">Keinginan/Fleksibel</option>
      </select>
      <select id="txn-filter-wallet" onchange="loadTransactions()"><option value="">Semua Dompet</option></select>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Tgl</th><th>Keterangan</th><th>Kategori</th><th class="td-right">Masuk</th><th class="td-right">Keluar</th><th>Dompet</th><th></th></tr></thead>
        <tbody id="txn-list"></tbody>
      </table>
      <div id="txn-totals" style="padding:12px 16px;font-weight:600;border-top:1px solid var(--border);display:flex;gap:22px;font-size:13px;flex-wrap:wrap"></div>
    </div>
  `;
  api('/api/wallets').then((ws) => {
    const sel = $('#txn-wallet');
    const filt = $('#txn-filter-wallet');
    ws.forEach((w) => { sel.innerHTML += `<option value="${w.name}">${w.name}</option>`; filt.innerHTML += `<option value="${w.name}">${w.name}</option>`; });
  });
  loadTransactions();
}

function loadTransactions() {
  const q = new URLSearchParams();
  const search = $('#txn-search')?.value;
  const kat = $('#txn-filter-kat')?.value;
  const wallet = $('#txn-filter-wallet')?.value;
  if (search) q.set('q', search);
  if (kat) q.set('kategori', kat);
  if (wallet) q.set('wallet', wallet);
  api('/api/transactions?' + q).then((txns) => {
    const tbody = $('#txn-list');
    if (!tbody) return;
    const catColors = { 'Pemasukan': 'var(--green)', 'Kebutuhan Pokok': 'var(--text)', 'Cicilan/Utang': 'var(--red)', 'Tabungan/Dana Darurat': 'var(--accent2)', 'Keinginan/Fleksibel': 'var(--orange)' };
    tbody.innerHTML = txns.length === 0 ? '<tr><td colspan="7" class="empty-state">Belum ada transaksi</td></tr>' :
      txns.map((t) => `<tr>
        <td class="td-center"><span class="badge badge-info">${t.tanggal || '-'}</span></td>
        <td>${t.keterangan}</td>
        <td><span style="color:${catColors[t.kategori] || 'var(--text)'}">${t.kategori}</span></td>
        <td class="td-right rupiah" style="color:var(--green)">${t.masuk > 0 ? fmtRp(t.masuk) : '-'}</td>
        <td class="td-right rupiah" style="color:var(--red)">${t.keluar > 0 ? fmtRp(t.keluar) : '-'}</td>
        <td><span class="chip chip-blue">${t.wallet}</span></td>
        <td><button class="btn-icon" onclick="deleteTxn(${t.id})" title="Hapus">🗑</button></td>
      </tr>`).join('');
    const totMasuk = txns.reduce((a, t) => a + (t.masuk || 0), 0);
    const totKeluar = txns.reduce((a, t) => a + (t.keluar || 0), 0);
    $('#txn-totals').innerHTML = `<span>Total Masuk: <b style="color:var(--green)">${fmtRp(totMasuk)}</b></span><span>Total Keluar: <b style="color:var(--red)">${fmtRp(totKeluar)}</b></span><span>Sisa: <b style="color:${totMasuk - totKeluar >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtRp(totMasuk - totKeluar)}</b></span><span style="margin-left:auto">${txns.length} transaksi</span>`;
  });
}

function addTxn() {
  const body = {
    tanggal: $('#txn-tgl').value || '',
    keterangan: $('#txn-ket').value,
    kategori: $('#txn-kat').value,
    masuk: $('#txn-masuk').value || 0,
    keluar: $('#txn-keluar').value || 0,
    wallet: $('#txn-wallet').value,
  };
  if (!body.keterangan) return showToast('⚠', 'Isi keterangan transaksi dulu!', 'med');
  api('/api/transactions', { method: 'POST', body }).then(() => {
    $('#txn-ket').value = '';
    $('#txn-masuk').value = '';
    $('#txn-keluar').value = '';
    showToast('✅', 'Transaksi tersimpan', 'low');
    loadTransactions();
  });
}

function deleteTxn(id) { if (confirm('Hapus transaksi ini?')) api('/api/transactions/' + id, { method: 'DELETE' }).then(() => loadTransactions()); }

// ================= DOMPET =================

function renderDompet(el) {
  Promise.all([api('/api/wallets'), api('/api/transfers')]).then(([wallets, transfers]) => {
    const totalSaldo = wallets.reduce((a, w) => a + w.saldo, 0);
    el.innerHTML = `
      <div class="hero-card" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div class="card-label">Total Saldo Semua Dompet</div>
          <div class="card-value ${totalSaldo >= 0 ? 'text-green' : 'text-red'}" style="color:${totalSaldo >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtRp(totalSaldo)}</div>
          <div class="card-sub">${wallets.length} rekening tercatat</div>
        </div>
        <button class="btn btn-primary" onclick="showAddWallet()">+ Tambah Dompet</button>
      </div>
      <div class="cards cards-2" style="margin-bottom:16px">
        ${wallets.map((w) => {
          const avatar = w.jenis === 'Cash' ? '💵' : w.jenis === 'E-Wallet' ? '📱' : '🏦';
          return `<div class="wallet-card">
            <div class="wallet-balance-row">
              <div class="wallet-avatar">${avatar}</div>
              <div class="wallet-info">
                <h4>${w.name}</h4>
                <span>${w.jenis} · Saldo awal ${fmtRp(w.saldo_awal)}</span>
              </div>
            </div>
            <div style="text-align:right">
              <div class="wallet-amount" style="color:${w.saldo >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtRp(w.saldo)}</div>
              <span class="small">↑${fmtRp(w.masuk)} ↓${fmtRp(w.keluar)}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div class="section-title" style="margin:0">Mutasi Transfer Antar Dompet</div>
          <button class="btn btn-primary btn-sm" onclick="showAddTransfer()">+ Transfer</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tanggal</th><th>Dari</th><th>Ke</th><th class="td-right">Jumlah</th><th>Catatan</th><th></th></tr></thead>
            <tbody>
              ${transfers.length === 0 ? '<tr><td colspan="6" class="empty-state">Belum ada transfer</td></tr>' :
              transfers.map((t) => `<tr>
                <td>${t.tanggal || '-'}</td>
                <td><span class="chip chip-blue">${t.dari}</span></td>
                <td><span class="chip chip-green">${t.ke}</span></td>
                <td class="td-right rupiah">${fmtRp(t.jumlah)}</td>
                <td class="muted">${t.catatan}</td>
                <td><button class="btn-icon" onclick="deleteTransfer(${t.id})">🗑</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  });
}

function showAddWallet() {
  showModal(`
    <div class="form-group"><label>Nama Dompet</label><input id="add-w-name" placeholder="Contoh: GoPay, BNI, OVO"></div>
    <div class="form-group"><label>Jenis</label><select id="add-w-jenis"><option>Bank</option><option>Cash</option><option>E-Wallet</option><option>Lainnya</option></select></div>
    <div class="form-group"><label>Saldo Awal (Rp)</label><input id="add-w-saldo" type="number" value="0"></div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Batal</button><button class="btn btn-primary" onclick="saveWallet()">Simpan</button></div>
  `);
}
function saveWallet() {
  api('/api/wallets', { method: 'POST', body: { name: $('#add-w-name').value, jenis: $('#add-w-jenis').value, saldo_awal: $('#add-w-saldo').value } }).then(() => { hideModal(); renderTab('dompet'); });
}

function showAddTransfer() {
  api('/api/wallets').then((ws) => {
    const opts = ws.map((w) => `<option value="${w.name}">${w.name}</option>`).join('');
    showModal(`
      <div class="form-group"><label>Tanggal</label><input id="add-tf-tgl" type="number" min="1" max="31" value="${new Date().getDate()}"></div>
      <div class="form-row"><div class="form-group"><label>Dari Dompet</label><select id="add-tf-dari">${opts}</select></div>
      <div class="form-group"><label>Ke Dompet</label><select id="add-tf-ke">${opts}</select></div></div>
      <div class="form-group"><label>Jumlah (Rp)</label><input id="add-tf-jml" type="number" min="0"></div>
      <div class="form-group"><label>Catatan</label><input id="add-tf-cat" placeholder="Contoh: Tarik tunai"></div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Batal</button><button class="btn btn-primary" onclick="saveTransfer()">Simpan</button></div>
    `);
  });
}
function saveTransfer() {
  api('/api/transfers', { method: 'POST', body: { tanggal: $('#add-tf-tgl').value, dari: $('#add-tf-dari').value, ke: $('#add-tf-ke').value, jumlah: $('#add-tf-jml').value, catatan: $('#add-tf-cat').value } }).then(() => { hideModal(); renderTab('dompet'); });
}
function deleteTransfer(id) { if (confirm('Hapus transfer?')) api('/api/transfers/' + id, { method: 'DELETE' }).then(() => renderTab('dompet')); }

// ================= TAGIHAN =================

function renderTagihan(el) {
  api('/api/bills').then((bills) => {
    const today = new Date().getDate();
    const siklus1 = bills.filter((b) => b.siklus === '1');
    const siklus2 = bills.filter((b) => b.siklus === '2');
    const flek = bills.filter((b) => b.siklus === 'FLEKSIBEL');

    const renderSiklus = (title, dateHint, items) => {
      const total = items.reduce((a, b) => a + (b.jumlah || 0), 0);
      const paid = items.filter((b) => b.status === 'Sudah Bayar').reduce((a, b) => a + b.jumlah, 0);
      const countTotal = items.length;
      const countPaid = items.filter((b) => b.status === 'Sudah Bayar').length;
      const overdueItems = items.filter((b) => b.status !== 'Sudah Bayar' && b.tanggal && b.tanggal < today);
      const hasOpen = items.some((b) => b.status !== 'Sudah Bayar');
      return `<div class="section">
        <div class="siklus-header accordion-toggle" onclick="toggleAccordion(this)">
          <div>
            <h3>${title}</h3>
            <div class="siklus-meta">
              <span>📅 ${dateHint}</span>
              <span>💰 Sisihkan: <b class="rupiah">${fmtRp(total)}</b></span>
              <span>✓ Dibayar ${countPaid}/${countTotal}</span>
              <span>💵 Sisa: <b class="${total - paid === 0 ? 'text-green' : 'text-red'} rupiah">${fmtRp(total - paid)}</b></span>
              ${overdueItems.length > 0 ? `<span class="chip chip-red">⚠ ${overdueItems.length} TELAT</span>` : ''}
            </div>
          </div>
          <div class="siklus-chevron">▾</div>
        </div>
        <div class="accordion-body${hasOpen ? ' open' : ''}">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Tgl</th><th>Tagihan</th><th class="td-right">Jumlah</th><th>Status</th><th>Catatan</th><th></th></tr></thead>
              <tbody>
                ${items.map((b) => {
                  const isOverdue = b.status !== 'Sudah Bayar' && b.tanggal && b.tanggal < today;
                  const isDue = b.status !== 'Sudah Bayar' && b.tanggal === today;
                  return `<tr style="background:${isOverdue ? 'rgba(248,113,113,0.05)' : isDue ? 'rgba(251,191,36,0.05)' : ''}">
                    <td class="td-center"><span class="badge ${isDue ? 'badge-unpaid' : 'badge-info'}">${b.tanggal || 'Flex'}</span></td>
                    <td><b>${b.name}</b> ${isOverdue ? '<span class="badge badge-overdue">TELAT</span>' : isDue ? '<span class="badge badge-unpaid">HARI INI</span>' : ''}</td>
                    <td class="td-right rupiah">${fmtRp(b.jumlah)}</td>
                    <td><span class="badge ${b.status === 'Sudah Bayar' ? 'badge-paid' : isOverdue ? 'badge-overdue' : 'badge-unpaid'}">${b.status}</span></td>
                    <td class="small">${b.catatan}</td>
                    <td><button class="btn btn-sm ${b.status === 'Sudah Bayar' ? 'btn-outline' : 'btn-green'}" onclick="toggleBill(${b.id})">${b.status === 'Sudah Bayar' ? '↺ Batal' : '✓ Bayar'}</button></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
    };

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div class="card-label">Kalender Tagihan</div>
          <div class="card-sub">Tentukan nominal yang harus disisihkan dari tiap gajian SEBELUM kepake</div>
        </div>
        <button class="btn btn-primary" onclick="showAddBill()">+ Tambah Tagihan</button>
      </div>
      ${renderSiklus('SIKLUS 1 · Gajian Suami (tgl 28)', 'Bayar tagihan tgl 1-3', siklus1)}
      ${renderSiklus('SIKLUS 2 · Gajian Istri (tgl 6)', 'Bayar tagihan tgl 7-20', siklus2)}
      ${renderSiklus('FLEKSIBEL', 'Boleh ditunda kalau kepepet, tapi usahakan tiap bulan', flek)}
    `;
  });
}

function toggleAccordion(el) {
  el.classList.toggle('open');
  el.nextElementSibling.classList.toggle('open');
}

function toggleBill(id) {
  api('/api/bills/' + id, { method: 'PUT', body: { toggle: true } }).then(() => renderTab('tagihan'));
}

function showAddBill() {
  showModal(`
    <div class="form-group"><label>Nama Tagihan</label><input id="add-b-name" placeholder="Contoh: PLN, PDAM, Kartu Kredit"></div>
    <div class="form-row">
      <div class="form-group"><label>Siklus</label><select id="add-b-siklus"><option value="1">Siklus 1 (Gajian Suami)</option><option value="2">Siklus 2 (Gajian Istri)</option><option value="FLEKSIBEL">Fleksibel</option></select></div>
      <div class="form-group"><label>Tanggal Jatuh Tempo</label><input id="add-b-tgl" type="number" min="1" max="31"></div>
    </div>
    <div class="form-group"><label>Jumlah (Rp)</label><input id="add-b-jml" type="number" min="0"></div>
    <div class="form-group"><label>Catatan</label><input id="add-b-cat" placeholder="Prioritas? Denda?"></div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Batal</button><button class="btn btn-primary" onclick="saveBill()">Simpan</button></div>
  `);
}
function saveBill() {
  api('/api/bills', { method: 'POST', body: { name: $('#add-b-name').value, siklus: $('#add-b-siklus').value, tanggal: $('#add-b-tgl').value, jumlah: $('#add-b-jml').value, catatan: $('#add-b-cat').value } }).then(() => { hideModal(); renderTab('tagihan'); });
}

// ================= HUTANG =================

function renderHutang(el) {
  Promise.all([api('/api/debts'), api('/api/receivables')]).then(([debts, receivables]) => {
    _debts_cache = debts;
    const aktif = debts.filter((d) => d.status === 'Aktif').sort((a, b) => (parseInt(a.urutan_lunasin) || 99) - (parseInt(b.urutan_lunasin) || 99));
    const totalSisa = aktif.reduce((a, d) => a + (d.sisa_pokok || 0), 0);
    const totalCicilan = aktif.reduce((a, d) => a + (d.cicilan_bulanan || 0), 0);
    const pemasukan = _summary?.pemasukan || 0;
    const dti = pemasukan > 0 ? totalCicilan / pemasukan : 0;

    el.innerHTML = `
      <div class="cards cards-3" style="margin-bottom:16px">
        <div class="card card-sm">
          <div class="card-label">Pinjol Aktif</div>
          <div class="card-value">${aktif.length}</div>
          <div class="card-sub">sedang berjalan</div>
        </div>
        <div class="card card-sm">
          <div class="card-label">Total Cicilan/Bulan</div>
          <div class="card-value text-red">${fmtRp(totalCicilan)}</div>
          <div class="card-sub"><span class="chip ${dti > 0.35 ? 'chip-red' : dti > 0.3 ? 'chip-orange' : 'chip-green'}">DTI ${(dti * 100).toFixed(1)}%</span> ${dti > 0.35 ? 'LEBIH dari patokan 35%' : 'di bawah 35%'}</div>
        </div>
        <div class="card card-sm">
          <div class="card-label">Total Sisa Pokok</div>
          <div class="card-value text-orange">${fmtRp(totalSisa)}</div>
          <div class="card-sub">target lunas: kecil dulu, tanpa bunga menumpuk</div>
        </div>
      </div>

      <div class="section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div class="section-title" style="margin:0">Rencana Pelunasan Pinjol</div>
          <button class="btn btn-primary btn-sm" onclick="showAddDebt()">+ Tambah Utang</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Urutan</th><th>Nama Utang</th><th>Pemberi</th><th class="td-right">Sisa Pokok</th><th class="td-right">Cicilan/bln</th><th>Jth Tempo</th><th>Status</th><th>Catatan</th><th></th></tr></thead>
            <tbody>
              ${aktif.map((d) => `<tr>
                <td><span class="badge badge-info">${d.urutan_lunasin || '-'}</span></td>
                <td><b>${d.name}</b></td>
                <td class="muted">${d.pemberi} <span class="chip chip-blue">${d.jenis}</span></td>
                <td class="td-right rupiah">${fmtRp(d.sisa_pokok)}</td>
                <td class="td-right rupiah">${fmtRp(d.cicilan_bulanan)}</td>
                <td class="td-center">${d.jatuh_tempo || '-'}</td>
                <td><span class="badge badge-active">${d.status}</span></td>
                <td class="small" style="max-width:170px">${d.catatan}</td>
                <td><button class="btn-icon" onclick="showEditDebt(${d.id})">✏️</button><button class="btn-icon" onclick="deleteDebt(${d.id})">🗑</button></td>
              </tr>`).join('')}
              ${aktif.length > 0 ? `<tr style="border-top:2px solid var(--border)">
                <td colspan="3" style="font-weight:700">TOTAL (Aktif)</td>
                <td class="td-right rupiah" style="font-weight:700">${fmtRp(totalSisa)}</td>
                <td class="td-right rupiah" style="font-weight:700;color:var(--red)">${fmtRp(totalCicilan)}</td>
                <td colspan="4"></td>
              </tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>

      <div class="section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div class="section-title" style="margin:0">Piutang — uang dipinjamkan ke orang lain</div>
          <button class="btn btn-primary btn-sm" onclick="showAddReceivable()">+ Tambah Piutang</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nama Peminjam</th><th class="td-right">Jumlah</th><th>Tanggal Pinjam</th><th>Estimasi Kembali</th><th>Status</th><th>Catatan</th><th></th></tr></thead>
            <tbody>
              ${receivables.length === 0 ? '<tr><td colspan="7" class="empty-state">Belum ada piutang</td></tr>' :
              receivables.map((r) => `<tr>
                <td><b>${r.nama}</b></td>
                <td class="td-right rupiah">${fmtRp(r.jumlah)}</td>
                <td>${r.tanggal_pinjam}</td>
                <td>${r.estimasi_kembali}</td>
                <td><span class="badge ${r.status === 'Lunas' ? 'badge-paid' : 'badge-unpaid'}">${r.status}</span></td>
                <td class="small">${r.catatan}</td>
                <td><button class="btn-icon" onclick="showEditReceivable(${r.id})">✏️</button><button class="btn-icon" onclick="deleteReceivable(${r.id})">🗑</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  });
}

function showAddDebt() {
  showModal(`
    <div class="form-group"><label>Nama Utang</label><input id="add-d-name" placeholder="Contoh: Spinjam 5"></div>
    <div class="form-row">
      <div class="form-group"><label>Jenis</label><select id="add-d-jenis"><option>Pinjaman Online</option><option>Kartu Kredit</option><option>KTA</option><option>Lainnya</option></select></div>
      <div class="form-group"><label>Pemberi Pinjaman</label><input id="add-d-pemberi"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Sisa Pokok (Rp)</label><input id="add-d-sisa" type="number"></div>
      <div class="form-group"><label>Cicilan/bln (Rp)</label><input id="add-d-cicilan" type="number"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Jth Tempo (tgl)</label><input id="add-d-tgl" type="number" min="1" max="31"></div>
      <div class="form-group"><label>Urutan Lunas</label><input id="add-d-urutan" type="number" min="1"></div>
    </div>
    <div class="form-group"><label>Catatan</label><textarea id="add-d-cat"></textarea></div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Batal</button><button class="btn btn-primary" onclick="saveDebt()">Simpan</button></div>
  `);
}
function saveDebt() {
  const body = { name: $('#add-d-name').value, jenis: $('#add-d-jenis').value, pemberi: $('#add-d-pemberi').value, sisa_pokok: $('#add-d-sisa').value, cicilan_bulanan: $('#add-d-cicilan').value, jatuh_tempo: $('#add-d-tgl').value, urutan_lunasin: $('#add-d-urutan').value, catatan: $('#add-d-cat').value };
  if (!body.name) return showToast('⚠', 'Nama utang wajib diisi!', 'med');
  api('/api/debts', { method: 'POST', body }).then(() => { hideModal(); renderTab('hutang'); });
}

function deleteDebt(id) { if (confirm('Hapus utang ini?')) api('/api/debts/' + id, { method: 'DELETE' }).then(() => renderTab('hutang')); }

function showAddReceivable() {
  showModal(`
    <div class="form-group"><label>Nama Peminjam</label><input id="add-r-nama"></div>
    <div class="form-group"><label>Jumlah (Rp)</label><input id="add-r-jml" type="number"></div>
    <div class="form-row">
      <div class="form-group"><label>Tanggal Pinjam</label><input id="add-r-tgl" placeholder="dd/mm/yyyy"></div>
      <div class="form-group"><label>Estimasi Kembali</label><input id="add-r-est" placeholder="dd/mm/yyyy"></div>
    </div>
    <div class="form-group"><label>Catatan</label><input id="add-r-cat"></div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Batal</button><button class="btn btn-primary" onclick="saveReceivable()">Simpan</button></div>
  `);
}
function saveReceivable() {
  api('/api/receivables', { method: 'POST', body: { nama: $('#add-r-nama').value, jumlah: $('#add-r-jml').value, tanggal_pinjam: $('#add-r-tgl').value, estimasi_kembali: $('#add-r-est').value, catatan: $('#add-r-cat').value } }).then(() => { hideModal(); renderTab('hutang'); });
}

function showEditReceivable(id) {
  api('/api/receivables').then((list) => {
    const r = list.find((x) => x.id === id);
    if (!r) return;
    showModal(`
      <div class="form-group"><label>Nama Peminjam</label><input id="er-nama" value="${r.nama}"></div>
      <div class="form-group"><label>Jumlah (Rp)</label><input id="er-jml" type="number" value="${r.jumlah}"></div>
      <div class="form-row">
        <div class="form-group"><label>Status</label><select id="er-status"><option ${r.status === 'Belum Lunas' ? 'selected' : ''}>Belum Lunas</option><option ${r.status === 'Lunas' ? 'selected' : ''}>Lunas</option></select></div>
        <div class="form-group"><label>Estimasi Kembali</label><input id="er-est" value="${r.estimasi_kembali}"></div>
      </div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Batal</button><button class="btn btn-primary" onclick="saveEditReceivable(${id})">Simpan</button></div>
    `);
  });
}

function saveEditReceivable(id) {
  api('/api/receivables/' + id, { method: 'PUT', body: { nama: $('#er-nama').value, jumlah: $('#er-jml').value, status: $('#er-status').value, estimasi_kembali: $('#er-est').value } }).then(() => { hideModal(); renderTab('hutang'); });
}

function deleteReceivable(id) { if (confirm('Hapus piutang ini?')) api('/api/receivables/' + id, { method: 'DELETE' }).then(() => renderTab('hutang')); }

function showEditDebt(id) {
  api('/api/debts').then((list) => {
    const d = list.find((x) => x.id === id);
    if (!d) return;
    showModal(`
      <div class="form-group"><label>Nama Utang</label><input id="ed-name" value="${d.name}"></div>
      <div class="form-row">
        <div class="form-group"><label>Pemberi</label><input id="ed-pemberi" value="${d.pemberi}"></div>
        <div class="form-group"><label>Status</label><select id="ed-status"><option ${d.status === 'Aktif' ? 'selected' : ''}>Aktif</option><option ${d.status === 'Lunas' ? 'selected' : ''}>Lunas</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Sisa Pokok (Rp)</label><input id="ed-sisa" type="number" value="${d.sisa_pokok}"></div>
        <div class="form-group"><label>Cicilan/bln (Rp)</label><input id="ed-cicilan" type="number" value="${d.cicilan_bulanan}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Jth Tempo</label><input id="ed-tgl" type="number" min="1" max="31" value="${d.jatuh_tempo || ''}"></div>
        <div class="form-group"><label>Urutan Lunas</label><input id="ed-urutan" type="number" value="${d.urutan_lunasin}"></div>
      </div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Batal</button><button class="btn btn-primary" onclick="saveEditDebt(${id})">Simpan</button></div>
    `);
  });
}

function saveEditDebt(id) {
  api('/api/debts/' + id, { method: 'PUT', body: { name: $('#ed-name').value, pemberi: $('#ed-pemberi').value, status: $('#ed-status').value, sisa_pokok: $('#ed-sisa').value, cicilan_bulanan: $('#ed-cicilan').value, jatuh_tempo: $('#ed-tgl').value, urutan_lunasin: $('#ed-urutan').value } }).then(() => { hideModal(); renderTab('hutang'); });
}

// ================= ANGGARAN =================

function renderAnggaran(el) {
  api('/api/summary').then((s) => {
    el.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <div class="card-label">Pemasukan bulan ini</div>
            <div class="card-value text-green" style="color:var(--green)">${fmtRp(s.pemasukan)}</div>
            <div class="card-sub">Total target teralokasi: ${(s.totalBudgetPersen * 100).toFixed(0)}%</div>
          </div>
          <button class="btn btn-primary" onclick="showEditBudget()">✏️ Edit Target %</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Kategori</th><th class="td-right">Target %</th><th class="td-right">Target (Rp)</th><th class="td-right">Realisasi</th><th>Realisasi %</th><th class="td-right">Sisa</th><th>Status</th></tr></thead>
          <tbody>
            ${s.budget.map((b) => `<tr>
              <td><b>${b.kategori}</b></td>
              <td class="td-right">${(b.target_persen * 100).toFixed(0)}%</td>
              <td class="td-right rupiah">${fmtRp(b.target)}</td>
              <td class="td-right rupiah" style="color:${b.over ? 'var(--red)' : 'var(--text)'}">${fmtRp(b.realisasi)}</td>
              <td style="min-width:150px">
                <div class="progress-bar"><div class="progress-fill ${b.over ? 'bad' : b.realisasi_persen > 0.8 ? 'warn' : 'good'}" style="width:${Math.min(b.realisasi_persen * 100, 100)}%"></div></div>
                <span class="small">${fmtPct(b.realisasi_persen)}</span>
              </td>
              <td class="td-right rupiah" style="color:${b.sisa_anggaran >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtRp(b.sisa_anggaran)}</td>
              <td><span class="badge ${b.over ? 'badge-over' : b.realisasi_persen > 0.8 ? 'badge-warn' : 'badge-ok'}">${b.over ? 'OVER!' : b.realisasi_persen > 0.8 ? 'PERHATIAN' : 'AMAN'}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="card card-sm" style="margin-top:14px">
        <div class="small">💡 Realisasi % di atas 100% artinya lo udah lewat anggaran kategori itu bulan ini. Kurangi belanja di kategori tsb.</div>
      </div>
    `;
  });
}

function showEditBudget() {
  api('/api/budget').then((items) => {
    showModal(`
      <h3>Edit Target Anggaran</h3>
      ${items.map((b) => `<div class="form-group" style="margin-bottom:10px">
        <label>${b.kategori}</label>
        <div class="form-row">
          <input id="budget-${b.kategori}" type="number" min="0" max="100" value="${Math.round(b.target_persen * 100)}" style="width:80px">
          <span class="muted">% dari pemasukan</span>
        </div>
      </div>`).join('')}
      <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Batal</button><button class="btn btn-primary" onclick="saveBudget()">Simpan</button></div>
    `);
  });
}
function saveBudget() {
  const items = ['Kebutuhan Pokok', 'Cicilan/Utang', 'Tabungan/Dana Darurat', 'Keinginan/Fleksibel'].map((k) => ({
    kategori: k,
    target_persen: (parseFloat($(`#budget-${k}`)?.value) || 0) / 100,
  }));
  api('/api/budget', { method: 'PUT', body: { items } }).then(() => { hideModal(); renderTab('anggaran'); });
}

// ================= ASET =================

function renderAset(el) {
  Promise.all([api('/api/assets'), api('/api/summary')]).then(([assets, s]) => {
    el.innerHTML = `
      <div class="section">
        <div class="section-title">A. Daftar Aset</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Jenis Aset</th><th>Deskripsi</th><th class="td-right">Nilai (Rp)</th></tr></thead>
            <tbody>
              <tr>
                <td><b>Kas & Tabungan</b></td>
                <td class="muted">Total saldo semua dompet</td>
                <td class="td-right rupiah text-green">${fmtRp(s.saldoTotal)}</td>
              </tr>
              <tr>
                <td><b>Piutang</b></td>
                <td class="muted">Piutang belum lunas</td>
                <td class="td-right rupiah">${fmtRp(s.piutangTotal)}</td>
              </tr>
              ${assets.map((a) => `<tr>
                <td>${a.jenis}</td>
                <td class="muted">${a.deskripsi}</td>
                <td class="td-right rupiah">${fmtRp(a.nilai)}</td>
              </tr>`).join('')}
              <tr style="border-top:2px solid var(--border)">
                <td colspan="2" style="font-weight:700">TOTAL ASET</td>
                <td class="td-right rupiah" style="font-weight:700;color:var(--green)">${fmtRp(s.assets.totalAset)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="section">
        <div class="section-title">B. Kewajiban (Utang)</div>
        <div class="card card-sm" style="display:flex;justify-content:space-between">
          <span class="muted">Total Sisa Pokok Utang Aktif</span>
          <span class="rupiah" style="font-weight:700;color:var(--red)">${fmtRp(s.assets.kewajiban)}</span>
        </div>
      </div>
      <div class="section">
        <div class="section-title">C. Kekayaan Bersih</div>
        <div class="hero-card" style="border-left:3px solid ${s.assets.netWorth >= 0 ? 'var(--green)' : 'var(--red)'}">
          <div class="card-label">Total Aset − Total Kewajiban</div>
          <div class="card-value ${s.assets.netWorth >= 0 ? 'text-green' : 'text-red'}" style="color:${s.assets.netWorth >= 0 ? 'var(--green)' : 'var(--red)'} !important">${fmtRp(s.assets.netWorth)}</div>
          <div class="card-sub">${s.assets.netWorth >= 0 ? '✨ Positif! Pertahankan!' : '⚠ Masih negatif — fokus lunasin utang, terutama pinjol yang bunganya akumulatif'}</div>
        </div>
      </div>
      <div class="section">
        <button class="btn btn-primary btn-sm" onclick="showAddAsset()">+ Tambah Aset Lainnya</button>
      </div>
    `;
  });
}

function showAddAsset() {
  showModal(`
    <div class="form-group"><label>Jenis Aset</label><input id="add-a-jenis" placeholder="Reksadana, Emas, Motor..."></div>
    <div class="form-group"><label>Deskripsi</label><input id="add-a-desc"></div>
    <div class="form-group"><label>Nilai (Rp)</label><input id="add-a-nilai" type="number"></div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Batal</button><button class="btn btn-primary" onclick="saveAsset()">Simpan</button></div>
  `);
}
function saveAsset() {
  api('/api/assets', { method: 'POST', body: { jenis: $('#add-a-jenis').value, deskripsi: $('#add-a-desc').value, nilai: $('#add-a-nilai').value } }).then(() => { hideModal(); renderTab('aset'); });
}

// ================= TUJUAN =================

function renderTujuan(el) {
  api('/api/summary').then((s) => {
    el.innerHTML = `
      <div class="section">
        <div class="section-title">A. Dana Darurat</div>
        <div class="hero-card">
          <div class="card-label">Target: ${s.emergency.target_bulan}x pengeluaran bulanan</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
            <div>
              <div class="card-value ${s.emergency.progress >= 1 ? 'text-green' : s.emergency.progress > 0 ? 'text-orange' : 'text-red'}" style="color:${s.emergency.progress >= 1 ? 'var(--green)' : s.emergency.progress > 0 ? 'var(--orange)' : 'var(--red)'} !important">${fmtPct(s.emergency.progress)}</div>
              <div class="card-sub">${fmtRp(s.emergency.saldo)} / ${fmtRp(s.emergency.targetDarurat)} sudah terkumpul</div>
            </div>
            <button class="btn btn-primary" onclick="showEditEmergency()">✏️ Edit</button>
          </div>
          <div class="progress-bar" style="margin-top:12px;height:12px"><div class="progress-fill ${s.emergency.progress >= 1 ? 'good' : s.emergency.progress > 0.3 ? 'warn' : 'bad'}" style="width:${Math.min(s.emergency.progress * 100, 100)}%"></div></div>
          <div class="card-sub" style="margin-top:10px">${Math.round(s.emergency.saldo / (s.emergency.target_bulan || 1))} dari ${fmtRp(Math.round(s.pengeluaran))} pengeluaran bulanan tertutup</div>
        </div>
      </div>

      <div class="section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div class="section-title" style="margin:0">B. Tujuan Nabung Lain</div>
          <button class="btn btn-primary btn-sm" onclick="showAddGoal()">+ Tambah Tujuan</button>
        </div>
        ${s.goals.length === 0 ? '<div class="empty-state" style="bg:var(--card);border:1px solid var(--border);border-radius:16px"><div class="emoji">🎯</div>Belum ada tujuan nabung — yuk tentukan target!</div>' :
        `<div class="cards cards-2">
          ${s.goals.map((g) => `<div class="card card-sm">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div>
                <h4 style="font-size:14.5px">🎯 ${g.nama}</h4>
                <div class="card-sub">${fmtRp(g.terkumpul)} / ${fmtRp(g.target)} ${g.target_tanggal ? `<span class="chip chip-blue">${g.target_tanggal}</span>` : ''}</div>
              </div>
              <div style="font-weight:800;font-family:var(--font-display);color:${g.progress >= 1 ? 'var(--green)' : 'var(--accent2)'}">${fmtPct(g.progress)}</div>
            </div>
            <div class="progress-bar"><div class="progress-fill ${g.progress >= 1 ? 'good' : 'accent'}" style="width:${Math.min(g.progress * 100, 100)}%"></div></div>
          </div>`).join('')}
        </div>`}
      </div>
    `;
  });
}

function showEditEmergency() {
  api('/api/emergency').then((e) => {
    showModal(`
      <h3>Dana Darurat</h3>
      <div class="form-group"><label>Target Bulan Pengeluaran (default 6)</label><input id="edit-em-bulan" type="number" min="1" value="${e.target_bulan}"></div>
      <div class="form-group"><label>Saldo Dana Darurat Saat Ini (Rp)</label><input id="edit-em-saldo" type="number" value="${e.saldo}"></div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Batal</button><button class="btn btn-primary" onclick="saveEmergency()">Simpan</button></div>
    `);
  });
}
function saveEmergency() {
  api('/api/emergency', { method: 'PUT', body: { target_bulan: $('#edit-em-bulan').value, saldo: $('#edit-em-saldo').value } }).then(() => { hideModal(); renderTab('tujuan'); });
}

function showAddGoal() {
  showModal(`
    <div class="form-group"><label>Nama Tujuan</label><input id="add-g-nama" placeholder="DP Rumah, Pendidikan Anak..."></div>
    <div class="form-group"><label>Target (Rp)</label><input id="add-g-target" type="number"></div>
    <div class="form-row">
      <div class="form-group"><label>Terkumpul (Rp)</label><input id="add-g-terkumpul" type="number" value="0"></div>
      <div class="form-group"><label>Target Tanggal</label><input id="add-g-tgl" placeholder="Contoh: Desember 2027"></div>
    </div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="hideModal()">Batal</button><button class="btn btn-primary" onclick="saveGoal()">Simpan</button></div>
  `);
}
function saveGoal() {
  api('/api/goals', { method: 'POST', body: { nama: $('#add-g-nama').value, target: $('#add-g-target').value, terkumpul: $('#add-g-terkumpul').value, target_tanggal: $('#add-g-tgl').value } }).then(() => { hideModal(); renderTab('tujuan'); });
}

// ================= TREN =================

function renderTren(el) {
  api('/api/trends').then((trends) => {
    el.innerHTML = `
      <div class="card" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <div class="card-label">Laporan Tren Bulanan</div>
          <div class="card-sub">Snapshot ringkasan bulan ini ke grafik untuk liat progress</div>
        </div>
        <button class="btn btn-primary" onclick="saveCurrentTrend()">📸 Simpan Tren Bulan Ini</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Bulan</th><th class="td-right">Pemasukan</th><th class="td-right">Pengeluaran</th><th class="td-right">Sisa</th><th class="td-right">Sisa Utang</th></tr></thead>
          <tbody>
            ${trends.map((t) => `<tr>
              <td><b>${t.bulan}</b></td>
              <td class="td-right rupiah" style="color:var(--green)">${fmtRp(t.pemasukan)}</td>
              <td class="td-right rupiah" style="color:var(--red)">${fmtRp(t.pengeluaran)}</td>
              <td class="td-right rupiah" style="color:${t.sisa >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtRp(t.sisa)}</td>
              <td class="td-right rupiah" style="color:var(--orange)">${fmtRp(t.sisa_utang)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="chart-container">
        <div class="section-title">Grafik Pemasukan vs Pengeluaran vs Sisa</div>
        <canvas id="trend-chart" height="240"></canvas>
      </div>
    `;
    setTimeout(() => drawTrendChart(trends), 150);
  });
}

function drawTrendChart(trends) {
  const canvas = $('#trend-chart');
  if (!canvas || trends.length === 0) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  const pad = { t: 36, r: 20, b: 64, l: 92 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const maxVal = Math.max(...trends.map((t) => Math.max(t.pemasukan, t.pengeluaran, t.sisa || 0)), 1);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#62687f';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  const step = cw / Math.max(trends.length - 1, 1);
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch - (i / 4) * ch;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#62687f';
    ctx.textAlign = 'right';
    ctx.fillText(fmtRp(maxVal * i / 4), pad.l - 10, y + 4);
  }
  const smooth = (data, key) => {
    const pts = data.map((t, i) => ({ x: pad.l + i * step, y: pad.t + ch - (t[key] / maxVal) * ch }));
    return pts;
  };
  const drawPath = (pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else {
        const prev = pts[i - 1];
        const mx = (prev.x + p.x) / 2;
        ctx.bezierCurveTo(mx, prev.y, mx, p.y, p.x, p.y);
      }
    });
  };
  const drawLine = (data, key, color) => {
    const pts = smooth(data, key);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    drawPath(pts);
    ctx.stroke();
    ctx.shadowBlur = 0;
    pts.forEach((p) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = 'rgba(10,14,26,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
    });
  };
  drawLine(trends, 'pemasukan', '#34d399');
  drawLine(trends, 'pengeluaran', '#f87171');
  drawLine(trends, 'sisa', '#7aa7ff');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#98a0b8';
  trends.forEach((t, i) => {
    const x = pad.l + i * step;
    ctx.save();
    ctx.translate(x, H - 12);
    ctx.rotate(-0.45);
    ctx.font = '10.5px Inter, sans-serif';
    ctx.fillText(t.bulan, 0, 0);
    ctx.restore();
  });
  const legends = [['Pemasukan', '#34d399'], ['Pengeluaran', '#f87171'], ['Sisa', '#7aa7ff']];
  let lx = pad.l;
  ctx.font = 'bold 12px Inter, sans-serif';
  legends.forEach(([label, color]) => {
    ctx.fillStyle = color;
    ctx.fillRect(lx, 8, 14, 12);
    ctx.strokeStyle = 'rgba(10,14,26,0.9)'; ctx.lineWidth = 1.5; ctx.strokeRect(lx, 8, 14, 12);
    ctx.fillStyle = '#98a0b8';
    ctx.textAlign = 'left';
    ctx.fillText(label, lx + 19, 19);
    lx += ctx.measureText(label).width + 42;
  });
}

function saveCurrentTrend() {
  api('/api/summary').then((s) => {
    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const d = new Date();
    const bulan = monthNames[d.getMonth()] + ' ' + d.getFullYear();
    api('/api/trends', { method: 'POST', body: { bulan, pemasukan: s.pemasukan, pengeluaran: s.pengeluaran, sisa: s.sisa, sisa_utang: s.debts.sisa } }).then(() => { showToast('📸', 'Tren bulan ini tersimpan!', 'low'); renderTab('tren'); });
  });
}

// ================= IMPORT =================

function renderImport(el) {
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-bottom:8px">Import dari Spreadsheet (.xlsx)</h3>
      <p class="muted" style="margin-bottom:14px">Upload file spreadsheet keuangan lo. Semua data lama akan ditimpa oleh data dari file baru.</p>
      <div class="import-zone" id="import-zone" onclick="document.getElementById('import-file').click()">
        <input type="file" id="import-file" accept=".xlsx" onchange="handleImport(this.files[0])">
        <div style="font-size:38px;margin-bottom:12px">📄</div>
        <div style="font-weight:600;color:var(--text2)">Klik atau seret file .xlsx ke sini</div>
        <div class="small" style="margin-top:4px">Data lama otomatis ditimpa</div>
      </div>
      <div id="import-result" style="margin-top:14px"></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:8px">Cara Pakai</h3>
      <ol style="padding-left:18px;color:var(--text3);font-size:13.5px;line-height:2">
        <li>Edit spreadsheet di Excel / LibreOffice / Google Sheets</li>
        <li>Save sebagai <b>.xlsx</b></li>
        <li>Upload file-nya di sini</li>
      </ol>
    </div>
  `;
  const zone = $('#import-zone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragover'); handleImport(e.dataTransfer.files[0]); });
}

function handleImport(file) {
  if (!file) return;
  const result = $('#import-result');
  result.innerHTML = '<span style="color:var(--orange)">⏳ Uploading & importing...</span>';
  file.arrayBuffer().then((buf) => {
    fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(buf) })
      .then((r) => r.json())
      .then((r) => {
        if (r.ok) {
          result.innerHTML = `<div class="card card-sm" style="border-left:3px solid var(--green)"><div class="text-green" style="font-weight:700;margin-bottom:4px">✅ Import berhasil!</div><div class="card-sub">${r.status.transactions} transaksi · ${r.status.wallets} dompet · ${r.status.debts} utang · ${r.status.bills} tagihan</div></div>`;
          showToast('✅', 'Data berhasil diimport!', 'low');
          setTimeout(() => renderTab('dashboard'), 1200);
        } else {
          result.innerHTML = `<div class="card card-sm" style="border-left:3px solid var(--red)"><div class="text-red" style="font-weight:700">❌ Gagal: ${r.error}</div></div>`;
          showToast('❌', 'Import gagal: ' + r.error, 'high');
        }
      })
      .catch((e) => {
        result.innerHTML = `<div class="card card-sm" style="border-left:3px solid var(--red)"><div class="text-red">❌ Error: ${e.message}</div></div>`;
      });
  });
}

// ================= MODAL =================

function showModal(html) {
  let overlay = $('.modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hideModal(); });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  overlay.style.display = 'flex';
}

function hideModal() {
  const overlay = $('.modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ================= AUTO-FILL HINTS =================

document.addEventListener('DOMContentLoaded', () => {
  const ketInput = document.getElementById('txn-ket');
  if (ketInput) {
    ketInput.addEventListener('input', () => {
      const v = ketInput.value.toLowerCase();
      const katSel = document.getElementById('txn-kat');
      if (/gajian|bonus|reward|cashback/.test(v)) katSel.value = 'Pemasukan';
      else if (/cicilan|pinjol|tokop|sea.?bank|spinjam|spay|kredit|kartu/.test(v)) katSel.value = 'Cicilan/Utang';
      else if (/belanja|beras|minyak|bensin|listrik|wifi|ipl|rumah|air|transport/.test(v)) katSel.value = 'Kebutuhan Pokok';
      else if (/tabung|dana darurat|invest|emas|reksa/.test(v)) katSel.value = 'Tabungan/Dana Darurat';
      else if (/jajan|nonton|game|kuota|pulsa/.test(v)) katSel.value = 'Keinginan/Fleksibel';
    });
  }
});

// ================= CLOCK =================
setInterval(() => {
  const el = $('#clock');
  if (el) {
    const d = new Date();
    el.textContent = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }
}, 1000);

// ================= INIT =================
switchTab('dashboard');