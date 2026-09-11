const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { bootstrap, migrateFromXlsx, DB_PATH } = require('./lib/db');
const { toNum } = require('./lib/xlsx');

const { db } = bootstrap();
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj, (k, v) => (v === undefined ? null : v));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      chunks.push(c);
      size += c.length;
      if (size > 30 * 1024 * 1024) {
        req.destroy();
        reject(new Error('terlalu besar'));
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getQuery(req) {
  const u = new URL(req.url, 'http://localhost');
  const q = {};
  u.searchParams.forEach((v, k) => { q[k] = v; });
  return q;
}

function monthPeriod() {
  const d = new Date();
  return { tahun: d.getFullYear(), bulanIdx: d.getMonth() };
}

// ---------- Aggregations ----------

function walletBalances() {
  const wallets = db.prepare('SELECT * FROM wallets ORDER BY id').all();
  const txnIn = db.prepare('SELECT wallet w, COALESCE(SUM(masuk),0) s FROM transactions WHERE masuk > 0 GROUP BY wallet').all();
  const txnOut = db.prepare('SELECT wallet w, COALESCE(SUM(keluar),0) s FROM transactions WHERE keluar > 0 GROUP BY wallet').all();
  const tfIn = db.prepare('SELECT ke w, COALESCE(SUM(jumlah),0) s FROM transfers GROUP BY ke').all();
  const tfOut = db.prepare('SELECT dari w, COALESCE(SUM(jumlah),0) s FROM transfers GROUP BY dari').all();
  const sum = (arr, w) => {
    const row = arr.find((x) => x.w === w);
    return row ? row.s : 0;
  };
  for (const w of wallets) {
    w.masuk = sum(txnIn, w.name);
    w.keluar = sum(txnOut, w.name);
    w.tf_in = sum(tfIn, w.name);
    w.tf_out = sum(tfOut, w.name);
    w.saldo = (w.saldo_awal || 0) + w.masuk - w.keluar + w.tf_in - w.tf_out;
    w.saldo = Math.round(w.saldo * 100) / 100;
  }
  return wallets;
}

function monthlyNumbers() {
  const inRow = db.prepare('SELECT COALESCE(SUM(masuk),0) s FROM transactions').get();
  const outRow = db.prepare('SELECT COALESCE(SUM(keluar),0) s FROM transactions').get();
  const byCat = db.prepare('SELECT kategori, COALESCE(SUM(keluar),0) s FROM transactions GROUP BY kategori').all();
  return { pemasukan: inRow.s, pengeluaran: outRow.s, byCat };
}

function debtTotals() {
  const aktif = db.prepare('SELECT * FROM debts WHERE status = ?',).all('Aktif');
  let sisa = 0;
  let cicilan = 0;
  for (const d of aktif) {
    sisa += d.sisa_pokok || 0;
    cicilan += d.cicilan_bulanan || 0;
  }
  return { count: aktif.length, sisa, cicilan };
}

function receivableTotal() {
  const row = db.prepare(`SELECT COALESCE(SUM(jumlah),0) s FROM receivables WHERE status = 'Belum Lunas' OR status = ''`).get();
  return row.s;
}

function getSummary() {
  const wallets = walletBalances();
  const saldoTotal = wallets.reduce((a, w) => a + w.saldo, 0);
  const { pemasukan, pengeluaran, byCat } = monthlyNumbers();
  const sisa = pemasukan - pengeluaran;

  const budgetRows = db.prepare('SELECT * FROM budget ORDER BY target_persen DESC').all();
  const budget = budgetRows.map((b) => {
    const realisasi = byCat.find((x) => x.kategori === b.kategori) || { s: 0 };
    const target = Math.round(pemasukan * b.target_persen);
    const real = Math.round(realisasi.s);
    const persen = target > 0 ? real / target : 0;
    return { kategori: b.kategori, target_persen: b.target_persen, target, realisasi: real, realisasi_persen: persen, sisa_anggaran: target - real, over: real > target };
  });
  const totalBudgetPersen = budgetRows.reduce((a, b) => a + (b.target_persen || 0), 0);

  const debts = debtTotals();
  const dti = pemasukan > 0 ? debts.cicilan / pemasukan : 0;
  const piutangTotal = receivableTotal();

  const emergency = db.prepare('SELECT * FROM emergency WHERE id = 1').get() || { target_bulan: 6, saldo: 0 };
  const targetDarurat = Math.round((emergency.target_bulan || 6) * pengeluaran);
  const progressDarurat = targetDarurat > 0 ? emergency.saldo / targetDarurat : 0;

  const goals = db.prepare('SELECT * FROM goals ORDER BY id').all().map((g) => ({
    ...g,
    progress: g.target > 0 ? g.terkumpul / g.target : 0,
  }));

  const assetsRows = db.prepare('SELECT * FROM assets ORDER BY id').all();
  const kasRow = assetsRows.find((a) => /kas|tabungan/i.test(a.jenis)) || { id: null, jenis: 'Kas & Tabungan', deskripsi: 'Total saldo semua dompet', nilai: 0 };
  const piutangRow = assetsRows.find((a) => /piutang/i.test(a.jenis)) || { id: null, jenis: 'Piutang', deskripsi: 'Piutang belum lunas', nilai: 0 };
  const otherAssets = assetsRows.filter((a) => a.id !== kasRow.id && a.id !== piutangRow.id);
  kasRow.nilai = saldoTotal;
  piutangRow.nilai = piutangTotal;
  const totalAset = saldoTotal + piutangTotal + otherAssets.reduce((a, x) => a + (x.nilai || 0), 0);
  const kewajiban = debts.sisa;
  const netWorth = totalAset - kewajiban;

  const nowD = new Date();
  const today = nowD.getDate();
  const bills = db.prepare('SELECT * FROM bills ORDER BY siklus, tanggal').all();
  const unpaid = bills.filter((b) => b.status !== 'Sudah Bayar');
  const overdue = unpaid.filter((b) => b.tanggal !== null && b.tanggal < today);
  const dueToday = unpaid.filter((b) => b.tanggal === today);

  const alerts = [];
  for (const b of budget) {
    if (b.over) alerts.push({ level: 'high', icon: '⚠', text: `Anggaran ${b.kategori} kedodoran ${fmtRp(b.realisasi - b.target)} (realisasi ${fmtRp(b.realisasi)} dari target ${fmtRp(b.target)}). Kurangi belanja kategori ini!` });
  }
  for (const b of overdue) alerts.push({ level: 'high', icon: '⏰', text: `Tagihan ${b.name} (${fmtRp(b.jumlah)}) TELAT - jatuh tempo tgl ${b.tanggal}. Jangan tunda, ada denda!` });
  for (const w of wallets) {
    if (w.saldo < 0) alerts.push({ level: 'high', icon: '🚨', text: `Dompet ${w.name} minus ${fmtRp(-w.saldo)}. Jangan transaksi dari dompet ini!` });
    else if (w.saldo === 0 && w.saldo_awal === 0) alerts.push({ level: 'low', icon: '💤', text: `Dompet ${w.name} kosong. Isi saldo awal atau transfer ke dalamnya.` });
  }
  if (dti > 0.35) alerts.push({ level: 'high', icon: '📉', text: `DTI ${(dti * 100).toFixed(0)}% MELEBIHI patokan 35% - pemasukan hampir habis buat cicilan. Prioritas: lunasin pinjol terkecil dulu!` });
  else if (dti > 0.3) alerts.push({ level: 'med', icon: '📉', text: `DTI ${(dti * 100).toFixed(0)}% - mendekati batas 35%. Hati-hati!` });
  if (progressDarurat < 0.1) alerts.push({ level: 'med', icon: '🛟', text: `Dana darurat masih kosong (${fmtRp(emergency.saldo)} dari target ${fmtRp(targetDarurat)}). Sisihkan berapapun tiap gajian!` });
  for (const b of dueToday) alerts.push({ level: 'med', icon: '🔔', text: `Hari ini tagihan ${b.name} ${fmtRp(b.jumlah)} jatuh tempo - bayar sekarang!` });

  const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const d = new Date();
  const periodName = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;

  return {
    periodName,
    today,
    pemasukan,
    pengeluaran,
    sisa,
    saldoTotal,
    wallets,
    budget,
    totalBudgetPersen,
    debts: { ...debts, dti },
    piutangTotal,
    emergency: { target_bulan: emergency.target_bulan, targetDarurat, saldo: emergency.saldo, progress: progressDarurat },
    goals,
    assets: { kas: kasRow, piutang: piutangRow, lain: otherAssets, totalAset, kewajiban, netWorth },
    bills: { unpaid: unpaid.length, dueToday: dueToday.length, overdue: overdue.length },
    alerts,
  };
}

function fmtRp(n) {
  const rounded = Math.round(Number(n) || 0);
  return 'Rp ' + rounded.toLocaleString('id-ID');
}

// ---------- Router ----------

async function handle(req, res, m) {
  const method = req.method;
  const pathname = m.pathname;

  if (pathname === '/api/status' && method === 'GET') {
    const counts = {
      transactions: db.prepare('SELECT COUNT(*) c FROM transactions').get().c,
      wallets: db.prepare('SELECT COUNT(*) c FROM wallets').get().c,
      debts: db.prepare('SELECT COUNT(*) c FROM debts').get().c,
      bills: db.prepare('SELECT COUNT(*) c FROM bills').get().c,
    };
    return sendJson(res, 200, { ok: true, counts });
  }

  if (pathname === '/api/summary' && method === 'GET') {
    return sendJson(res, 200, getSummary());
  }

  if (pathname === '/api/wallets') {
    if (method === 'GET') return sendJson(res, 200, walletBalances());
    if (method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!body.name) return sendJson(res, 400, { error: 'Nama dompet wajib diisi' });
      const r = db.prepare('INSERT INTO wallets (name, jenis, saldo_awal) VALUES (?, ?, ?)').run(body.name, body.jenis || '', toNum(body.saldo_awal) || 0);
      return sendJson(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
    }
  }
  const walletMatch = pathname.match(/^\/api\/wallets\/(\d+)$/);
  if (walletMatch) {
    const id = Number(walletMatch[1]);
    if (method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      db.prepare('UPDATE wallets SET name = ?, jenis = ?, saldo_awal = ? WHERE id = ?').run(body.name, body.jenis || '', toNum(body.saldo_awal) || 0, id);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM wallets WHERE id = ?').run(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/transactions') {
    if (method === 'GET') {
      const q = getQuery(req);
      let sql = 'SELECT * FROM transactions';
      const conds = [];
      const params = [];
      if (q.kategori) { conds.push('kategori = ?'); params.push(q.kategori); }
      if (q.wallet) { conds.push('wallet = ?'); params.push(q.wallet); }
      if (q.q) { conds.push('keterangan LIKE ?'); params.push('%' + q.q + '%'); }
      if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
      sql += ' ORDER BY id DESC';
      const rows = db.prepare(sql).all(...params);
      return sendJson(res, 200, rows);
    }
    if (method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!body.keterangan && !(toNum(body.masuk) || toNum(body.keluar))) return sendJson(res, 400, { error: 'Isi keterangan & nominal' });
      const r = db.prepare('INSERT INTO transactions (tanggal, keterangan, kategori, masuk, keluar, wallet) VALUES (?, ?, ?, ?, ?, ?)')
        .run(String(body.tanggal ?? ''), String(body.keterangan || ''), String(body.kategori || ''), toNum(body.masuk) || 0, toNum(body.keluar) || 0, String(body.wallet || ''));
      return sendJson(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
    }
  }
  const txnMatch = pathname.match(/^\/api\/transactions\/(\d+)$/);
  if (txnMatch) {
    const id = Number(txnMatch[1]);
    if (method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      db.prepare('UPDATE transactions SET tanggal = ?, keterangan = ?, kategori = ?, masuk = ?, keluar = ?, wallet = ? WHERE id = ?')
        .run(String(body.tanggal ?? ''), String(body.keterangan || ''), String(body.kategori || ''), toNum(body.masuk) || 0, toNum(body.keluar) || 0, String(body.wallet || ''), id);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/transfers') {
    if (method === 'GET') return sendJson(res, 200, db.prepare('SELECT * FROM transfers ORDER BY id DESC').all());
    if (method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!body.dari || !body.ke || !(toNum(body.jumlah) > 0)) return sendJson(res, 400, { error: 'Dari, ke, dan jumlah wajib' });
      const r = db.prepare('INSERT INTO transfers (tanggal, dari, ke, jumlah, catatan) VALUES (?, ?, ?, ?, ?)')
        .run(String(body.tanggal || ''), body.dari, body.ke, toNum(body.jumlah) || 0, String(body.catatan || ''));
      return sendJson(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
    }
  }
  const tfMatch = pathname.match(/^\/api\/transfers\/(\d+)$/);
  if (tfMatch) {
    const id = Number(tfMatch[1]);
    if (method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      db.prepare('UPDATE transfers SET tanggal = ?, dari = ?, ke = ?, jumlah = ?, catatan = ? WHERE id = ?')
        .run(String(body.tanggal || ''), body.dari, body.ke, toNum(body.jumlah) || 0, String(body.catatan || ''), id);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM transfers WHERE id = ?').run(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/debts') {
    if (method === 'GET') return sendJson(res, 200, db.prepare('SELECT * FROM debts ORDER BY id').all());
    if (method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!body.name) return sendJson(res, 400, { error: 'Nama utang wajib' });
      const r = db.prepare('INSERT INTO debts (name, jenis, pemberi, pokok_awal, sisa_pokok, bunga, cicilan_bulanan, jatuh_tempo, urutan_lunasin, status, catatan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(body.name, body.jenis || '', body.pemberi || '', toNum(body.pokok_awal) || 0, toNum(body.sisa_pokok) || 0, String(body.bunga || ''), toNum(body.cicilan_bulanan) || 0, body.jatuh_tempo ? toNum(body.jatuh_tempo) : null, String(body.urutan_lunasin || ''), body.status || 'Aktif', String(body.catatan || ''));
      return sendJson(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
    }
  }
  const debtMatch = pathname.match(/^\/api\/debts\/(\d+)$/);
  if (debtMatch) {
    const id = Number(debtMatch[1]);
    if (method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      db.prepare('UPDATE debts SET name = ?, jenis = ?, pemberi = ?, pokok_awal = ?, sisa_pokok = ?, bunga = ?, cicilan_bulanan = ?, jatuh_tempo = ?, urutan_lunasin = ?, status = ?, catatan = ? WHERE id = ?')
        .run(body.name, body.jenis || '', body.pemberi || '', toNum(body.pokok_awal) || 0, toNum(body.sisa_pokok) || 0, String(body.bunga || ''), toNum(body.cicilan_bulanan) || 0, body.jatuh_tempo ? toNum(body.jatuh_tempo) : null, String(body.urutan_lunasin || ''), body.status || 'Aktif', String(body.catatan || ''), id);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM debts WHERE id = ?').run(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/receivables') {
    if (method === 'GET') return sendJson(res, 200, db.prepare('SELECT * FROM receivables ORDER BY id').all());
    if (method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!body.nama) return sendJson(res, 400, { error: 'Nama peminjam wajib' });
      const r = db.prepare('INSERT INTO receivables (nama, jumlah, tanggal_pinjam, estimasi_kembali, status, catatan) VALUES (?, ?, ?, ?, ?, ?)')
        .run(body.nama, toNum(body.jumlah) || 0, String(body.tanggal_pinjam || ''), String(body.estimasi_kembali || ''), body.status || 'Belum Lunas', String(body.catatan || ''));
      return sendJson(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
    }
  }
  const recvMatch = pathname.match(/^\/api\/receivables\/(\d+)$/);
  if (recvMatch) {
    const id = Number(recvMatch[1]);
    if (method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      db.prepare('UPDATE receivables SET nama = ?, jumlah = ?, tanggal_pinjam = ?, estimasi_kembali = ?, status = ?, catatan = ? WHERE id = ?')
        .run(body.nama, toNum(body.jumlah) || 0, String(body.tanggal_pinjam || ''), String(body.estimasi_kembali || ''), body.status || 'Belum Lunas', String(body.catatan || ''), id);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM receivables WHERE id = ?').run(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/bills') {
    if (method === 'GET') return sendJson(res, 200, db.prepare('SELECT * FROM bills ORDER BY siklus, tanggal').all());
    if (method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!body.name) return sendJson(res, 400, { error: 'Nama tagihan wajib' });
      const r = db.prepare('INSERT INTO bills (siklus, tanggal, name, jumlah, status, catatan) VALUES (?, ?, ?, ?, ?, ?)')
        .run(String(body.siklus || '2'), body.tanggal ? toNum(body.tanggal) : null, body.name, toNum(body.jumlah) || 0, body.status || 'Belum Bayar', String(body.catatan || ''));
      return sendJson(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
    }
  }
  const billMatch = pathname.match(/^\/api\/bills\/(\d+)$/);
  if (billMatch) {
    const id = Number(billMatch[1]);
    if (method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const cur = db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
      const status = body.status !== undefined ? String(body.status) : (body.toggle ? (cur.status === 'Sudah Bayar' ? 'Belum Bayar' : 'Sudah Bayar') : cur.status);
      db.prepare('UPDATE bills SET siklus = ?, tanggal = ?, name = ?, jumlah = ?, status = ?, catatan = ? WHERE id = ?')
        .run(body.siklus !== undefined ? String(body.siklus) : cur.siklus, body.tanggal !== undefined ? toNum(body.tanggal) : cur.tanggal, body.name !== undefined ? body.name : cur.name, body.jumlah !== undefined ? toNum(body.jumlah) : cur.jumlah, status, body.catatan !== undefined ? String(body.catatan) : cur.catatan, id);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM bills WHERE id = ?').run(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/budget') {
    if (method === 'GET') return sendJson(res, 200, db.prepare('SELECT * FROM budget ORDER BY target_persen DESC').all());
    if (method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      for (const item of body.items || []) {
        db.prepare('INSERT INTO budget (kategori, target_persen) VALUES (?, ?) ON CONFLICT(kategori) DO UPDATE SET target_persen = excluded.target_persen')
          .run(String(item.kategori), toNum(item.target_persen) || 0);
      }
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/assets') {
    if (method === 'GET') return sendJson(res, 200, db.prepare('SELECT * FROM assets ORDER BY id').all());
    if (method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!body.jenis) return sendJson(res, 400, { error: 'Jenis aset wajib' });
      const r = db.prepare('INSERT INTO assets (jenis, deskripsi, nilai) VALUES (?, ?, ?)').run(body.jenis, String(body.deskripsi || ''), toNum(body.nilai) || 0);
      return sendJson(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
    }
  }
  const assetMatch = pathname.match(/^\/api\/assets\/(\d+)$/);
  if (assetMatch) {
    const id = Number(assetMatch[1]);
    if (method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      db.prepare('UPDATE assets SET jenis = ?, deskripsi = ?, nilai = ? WHERE id = ?').run(body.jenis, String(body.deskripsi || ''), toNum(body.nilai) || 0, id);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM assets WHERE id = ?').run(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/emergency') {
    if (method === 'GET') return sendJson(res, 200, db.prepare('SELECT * FROM emergency WHERE id = 1').get() || { target_bulan: 6, saldo: 0 });
    if (method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const cur = db.prepare('SELECT * FROM emergency WHERE id = 1').get() || { target_bulan: 6, saldo: 0 };
      const target_bulan = toNum(body.target_bulan) || cur.target_bulan;
      const saldo = toNum(body.saldo) !== null ? toNum(body.saldo) : cur.saldo;
      db.prepare('INSERT INTO emergency (id, target_bulan, saldo) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET target_bulan = excluded.target_bulan, saldo = excluded.saldo').run(target_bulan, saldo);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/goals') {
    if (method === 'GET') return sendJson(res, 200, db.prepare('SELECT * FROM goals ORDER BY id').all());
    if (method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!body.nama) return sendJson(res, 400, { error: 'Nama tujuan wajib' });
      const r = db.prepare('INSERT INTO goals (nama, target, terkumpul, target_tanggal) VALUES (?, ?, ?, ?)').run(body.nama, toNum(body.target) || 0, toNum(body.terkumpul) || 0, String(body.target_tanggal || ''));
      return sendJson(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
    }
  }
  const goalMatch = pathname.match(/^\/api\/goals\/(\d+)$/);
  if (goalMatch) {
    const id = Number(goalMatch[1]);
    if (method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      db.prepare('UPDATE goals SET nama = ?, target = ?, terkumpul = ?, target_tanggal = ? WHERE id = ?').run(body.nama, toNum(body.target) || 0, toNum(body.terkumpul) || 0, String(body.target_tanggal || ''), id);
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM goals WHERE id = ?').run(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/trends') {
    if (method === 'GET') return sendJson(res, 200, db.prepare('SELECT * FROM trends ORDER BY bulan').all());
    if (method === 'POST' || method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!body.bulan) return sendJson(res, 400, { error: 'Bulan wajib' });
      db.prepare('INSERT INTO trends (bulan, pemasukan, pengeluaran, sisa, sisa_utang) VALUES (?, ?, ?, ?, ?) ON CONFLICT(bulan) DO UPDATE SET pemasukan=excluded.pemasukan, pengeluaran=excluded.pengeluaran, sisa=excluded.sisa, sisa_utang=excluded.sisa_utang')
        .run(body.bulan, toNum(body.pemasukan) || 0, toNum(body.pengeluaran) || 0, toNum(body.sisa) || 0, toNum(body.sisa_utang) || 0);
      return sendJson(res, 200, { ok: true });
    }
  }
  const trendMatch = pathname.match(/^\/api\/trends\/(.+)\.?$/);
  if (trendMatch && method === 'DELETE') {
    db.prepare('DELETE FROM trends WHERE bulan = ?').run(decodeURIComponent(trendMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/import' && method === 'POST') {
    const buf = await readBody(req);
    if (buf.length === 0) return sendJson(res, 400, { error: 'File kosong' });
    const fname = path.join(DATA_DIR, 'upload.xlsx');
    fs.writeFileSync(fname, buf);
    try {
      const st = migrateFromXlsx(fname, db);
      return sendJson(res, 200, { ok: true, status: st });
    } catch (e) {
      return sendJson(res, 400, { error: 'Gagal baca file: ' + e.message });
    }
  }

  // Static files
  let p = pathname;
  if (p === '/') p = '/index.html';
  const full = path.normalize(path.join(PUBLIC, p));
  if (!full.startsWith(PUBLIC)) return sendJson(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return sendJson(res, 404, { error: 'not found' });
  const ext = path.extname(full).toLowerCase();
  const content = fs.readFileSync(full);
  const enc = /^text/.test(MIME[ext] || '') ? null : undefined;
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
  res.end(enc === undefined ? content : content.toString('utf8'));

  return undefined;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(u.pathname || '/');
  try {
    await handle(req, res, { pathname });
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
    else res.end();
  }
});

server.listen(PORT, () => {
  const { status } = (() => {
    const counts = {
      transactions: db.prepare('SELECT COUNT(*) c FROM transactions').get().c,
      wallets: db.prepare('SELECT COUNT(*) c FROM wallets').get().c,
      debts: db.prepare('SELECT COUNT(*) c FROM debts').get().c,
      bills: db.prepare('SELECT COUNT(*) c FROM bills').get().c,
    };
    return { status: counts };
  })();
  console.log('');
  console.log('=== KEUANGAN KELUARGA (mirip Kazz) ===');
  console.log(`Akses di http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`Data: ${status.transactions} transaksi, ${status.wallets} dompet, ${status.debts} utang, ${status.bills} tagihan`);
  console.log('');
});