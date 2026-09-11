const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { parseXlsx, toNum } = require('./xlsx');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'keuangan.db');
const DEFAULT_XLSX = process.env.KEUANGAN_XLSX || path.join(require('node:os').homedir(), 'Downloads', 'Keuangan_Keluarga_Lengkap.xlsx');

const CATEGORIES = {
  'Pemasukan': 'income',
  'Kebutuhan Pokok': 'needs',
  'Cicilan/Utang': 'debt',
  'Tabungan/Dana Darurat': 'savings',
  'Keinginan/Fleksibel': 'wants',
};

function col(row, c) {
  const v = row ? row[c] : undefined;
  return v === undefined ? '' : v;
}

function num(v) {
  const n = toNum(v);
  return n === null ? 0 : n;
}

function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      jenis TEXT DEFAULT '',
      saldo_awal REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT DEFAULT '',
      keterangan TEXT DEFAULT '',
      kategori TEXT DEFAULT '',
      masuk REAL DEFAULT 0,
      keluar REAL DEFAULT 0,
      wallet TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT DEFAULT '',
      dari TEXT DEFAULT '',
      ke TEXT DEFAULT '',
      jumlah REAL DEFAULT 0,
      catatan TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      jenis TEXT DEFAULT '',
      pemberi TEXT DEFAULT '',
      pokok_awal REAL DEFAULT 0,
      sisa_pokok REAL DEFAULT 0,
      bunga TEXT DEFAULT '',
      cicilan_bulanan REAL DEFAULT 0,
      jatuh_tempo INTEGER,
      urutan_lunasin TEXT DEFAULT '',
      status TEXT DEFAULT 'Aktif',
      catatan TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS receivables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT DEFAULT '',
      jumlah REAL DEFAULT 0,
      tanggal_pinjam TEXT DEFAULT '',
      estimasi_kembali TEXT DEFAULT '',
      status TEXT DEFAULT 'Belum Lunas',
      catatan TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      siklus TEXT DEFAULT '',
      tanggal INTEGER,
      name TEXT DEFAULT '',
      jumlah REAL DEFAULT 0,
      status TEXT DEFAULT 'Belum Bayar',
      catatan TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jenis TEXT DEFAULT '',
      deskripsi TEXT DEFAULT '',
      nilai REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS budget (
      kategori TEXT PRIMARY KEY,
      target_persen REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS emergency (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      target_bulan REAL DEFAULT 6,
      saldo REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT DEFAULT '',
      target REAL DEFAULT 0,
      terkumpul REAL DEFAULT 0,
      target_tanggal TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS trends (
      bulan TEXT PRIMARY KEY,
      pemasukan REAL DEFAULT 0,
      pengeluaran REAL DEFAULT 0,
      sisa REAL DEFAULT 0,
      sisa_utang REAL DEFAULT 0
    );
  `);

  const walletCount = db.prepare('SELECT COUNT(*) c FROM wallets').get().c;
  const txnCount = db.prepare('SELECT COUNT(*) c FROM transactions').get().c;
  return { db, isEmpty: walletCount === 0 && txnCount === 0 };
}

function seedDefaults(db) {
  db.prepare('INSERT INTO budget (kategori, target_persen) VALUES (?, ?)').run('Kebutuhan Pokok', 0.35);
  db.prepare('INSERT INTO budget (kategori, target_persen) VALUES (?, ?)').run('Cicilan/Utang', 0.45);
  db.prepare('INSERT INTO budget (kategori, target_persen) VALUES (?, ?)').run('Tabungan/Dana Darurat', 0.05);
  db.prepare('INSERT INTO budget (kategori, target_persen) VALUES (?, ?)').run('Keinginan/Fleksibel', 0.15);
  db.prepare('INSERT INTO emergency (id, target_bulan, saldo) VALUES (1, 6, 0)').run();
}

function parseRows(rows, mapping) {
  const result = [];
  for (const r of mapping) {
    const row = rows[r.row];
    if (!row) continue;
    const obj = {};
    for (const key of Object.keys(r.cols)) {
      obj[key] = r.cols[key](row);
    }
    const has = Object.values(obj).some((v) => v !== '' && v !== 0 && v !== null && v !== undefined);
    if (has) result.push(obj);
  }
  return result;
}

function migrateFromXlsx(inputPath, db) {
  const buf = fs.readFileSync(inputPath);
  const book = parseXlsx(buf);

  db.exec('DELETE FROM transactions; DELETE FROM wallets; DELETE FROM transfers; DELETE FROM debts; DELETE FROM receivables; DELETE FROM bills; DELETE FROM assets; DELETE FROM budget; DELETE FROM emergency; DELETE FROM goals; DELETE FROM trends;');

  const catatan = book['Catatan Harian'];
  const dompet = book['Dompet & Mutasi'];
  const hutang = book['Hutang & Piutang'];
  const tagihan = book['Kalender Tagihan'];
  const aset = book['Aset & Kekayaan Bersih'];
  const anggaran = book['Anggaran Bulanan'];
  const dana = book['Dana Darurat & Tujuan'];
  const tren = book['Tren Bulanan'];

  const wallets = [];
  for (let r = 5; r <= 14; r++) {
    const row = dompet && dompet.rows[r];
    const name = String(col(row, 'A')).trim();
    if (!name || name.toUpperCase().startsWith('TOTAL')) continue;
    wallets.push({ name, jenis: String(col(row, 'B')).trim(), saldo_awal: num(col(row, 'C')) });
  }
  for (const w of wallets) {
    db.prepare('INSERT INTO wallets (name, jenis, saldo_awal) VALUES (?, ?, ?)').run(w.name, w.jenis, w.saldo_awal);
  }

  let nowDate = new Date();
  let nowMonth = nowDate.getMonth();
  for (let r = 6; r <= 149; r++) {
    const row = catatan && catatan.rows[r];
    if (!row) continue;
    const ket = String(col(row, 'B')).trim();
    const masuk = num(col(row, 'D'));
    const keluar = num(col(row, 'E'));
    if (!ket && masuk === 0 && keluar === 0) continue;
    const tanggal = String(col(row, 'A')).trim();
    db.prepare('INSERT INTO transactions (tanggal, keterangan, kategori, masuk, keluar, wallet) VALUES (?, ?, ?, ?, ?, ?)')
      .run(tanggal, ket, String(col(row, 'C')).trim(), masuk, keluar, String(col(row, 'F')).trim());
  }

  for (let r = 20; r <= 40; r++) {
    const row = dompet && dompet.rows[r];
    if (!row) continue;
    const dari = String(col(row, 'B')).trim();
    const ke = String(col(row, 'C')).trim();
    const jumlah = num(col(row, 'D'));
    if (!dari && !ke && jumlah === 0) continue;
    db.prepare('INSERT INTO transfers (tanggal, dari, ke, jumlah, catatan) VALUES (?, ?, ?, ?, ?)')
      .run(String(col(row, 'A')).trim(), dari, ke, jumlah, String(col(row, 'E')).trim());
  }

  for (let r = 5; r <= 29; r++) {
    const row = hutang && hutang.rows[r];
    if (!row) continue;
    const name = String(col(row, 'A')).trim();
    if (!name || name.toUpperCase().startsWith('TOTAL')) continue;
    const status = String(col(row, 'J')).trim();
    if (status !== 'Aktif' && status !== 'Lunas' && status !== '') continue;
    db.prepare('INSERT INTO debts (name, jenis, pemberi, pokok_awal, sisa_pokok, bunga, cicilan_bulanan, jatuh_tempo, urutan_lunasin, status, catatan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name,
        String(col(row, 'B')).trim(),
        String(col(row, 'C')).trim(),
        num(col(row, 'D')),
        num(col(row, 'E')),
        String(col(row, 'F')).trim(),
        num(col(row, 'G')),
        col(row, 'H') === '' ? null : num(col(row, 'H')),
        String(col(row, 'I')).trim(),
        status || 'Aktif',
        String(col(row, 'K')).trim());
  }

  for (let r = 36; r <= 49; r++) {
    const row = hutang && hutang.rows[r];
    if (!row) continue;
    const nama = String(col(row, 'A')).trim();
    const jumlah = num(col(row, 'B'));
    if (!nama && jumlah === 0) continue;
    db.prepare('INSERT INTO receivables (nama, jumlah, tanggal_pinjam, estimasi_kembali, status, catatan) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nama, jumlah, String(col(row, 'C')).trim(), String(col(row, 'D')).trim(), String(col(row, 'E')).trim() || 'Belum Lunas', String(col(row, 'F')).trim());
  }

  const billSections = [
    { siklus: '1', label: 'SIKLUS 1', start: 9, end: 14 },
    { siklus: '2', label: 'SIKLUS 2', start: 21, end: 24 },
    { siklus: 'FLEKSIBEL', label: 'FLEKSIBEL', start: 28, end: 28 },
  ];
  for (const sec of billSections) {
    for (let r = sec.start; r <= sec.end; r++) {
      const row = tagihan && tagihan.rows[r];
      if (!row) continue;
      const name = String(col(row, 'B')).trim();
      const jumlah = num(col(row, 'C'));
      if (!name && jumlah === 0) continue;
      const tglRaw = String(col(row, 'A')).trim();
      const tgl = /^\d+$/.test(tglRaw) ? parseInt(tglRaw, 10) : null;
      db.prepare('INSERT INTO bills (siklus, tanggal, name, jumlah, status, catatan) VALUES (?, ?, ?, ?, ?, ?)')
        .run(sec.siklus, tgl, name, jumlah, String(col(row, 'D')).trim() || 'Belum Bayar', String(col(row, 'E')).trim());
    }
  }

  for (let r = 5; r <= 19; r++) {
    const row = aset && aset.rows[r];
    if (!row) continue;
    const jenis = String(col(row, 'A')).trim();
    if (!jenis || jenis.toUpperCase().startsWith('TOTAL')) continue;
    db.prepare('INSERT INTO assets (jenis, deskripsi, nilai) VALUES (?, ?, ?)')
      .run(jenis, String(col(row, 'B')).trim(), num(col(row, 'C')));
  }

  for (let r = 6; r <= 9; r++) {
    const row = anggaran && anggaran.rows[r];
    if (!row) continue;
    const kategori = String(col(row, 'A')).trim();
    if (!kategori || kategori.toUpperCase().startsWith('TOTAL')) continue;
    db.prepare('INSERT INTO budget (kategori, target_persen) VALUES (?, ?) ON CONFLICT(kategori) DO UPDATE SET target_persen = excluded.target_persen')
      .run(kategori, num(col(row, 'B')) || 0);
  }

  const danaRow = dana && dana.rows[4];
  const targetBulan = num(col(danaRow, 'B')) || 6;
  const saldoRow = dana && dana.rows[6];
  const saldoDarurat = num(col(saldoRow, 'B'));
  db.prepare('INSERT INTO emergency (id, target_bulan, saldo) VALUES (1, ?, ?)')
    .run(targetBulan, saldoDarurat);

  for (let r = 11; r <= 19; r++) {
    const row = dana && dana.rows[r];
    if (!row) continue;
    const nama = String(col(row, 'A')).trim();
    if (!nama) continue;
    db.prepare('INSERT INTO goals (nama, target, terkumpul, target_tanggal) VALUES (?, ?, ?, ?)')
      .run(nama, num(col(row, 'B')), num(col(row, 'C')), String(col(row, 'D')).trim());
  }

  for (let r = 6; r <= 17; r++) {
    const row = tren && tren.rows[r];
    if (!row) continue;
    const bulan = String(col(row, 'A')).trim();
    if (!bulan) continue;
    db.prepare('INSERT INTO trends (bulan, pemasukan, pengeluaran, sisa, sisa_utang) VALUES (?, ?, ?, ?, ?) ON CONFLICT(bulan) DO UPDATE SET pemasukan=excluded.pemasukan, pengeluaran=excluded.pengeluaran, sisa=excluded.sisa, sisa_utang=excluded.sisa_utang')
      .run(bulan, num(col(row, 'B')), num(col(row, 'C')), num(col(row, 'D')), num(col(row, 'E')));
  }

  return { wallets: wallets.length, transactions: db.prepare('SELECT COUNT(*) c FROM transactions').get().c };
}

function bootstrap() {
  const { db, isEmpty } = initDb();
  if (isEmpty && fs.existsSync(DEFAULT_XLSX)) {
    try {
      migrateFromXlsx(DEFAULT_XLSX, db);
    } catch (e) {
      console.error('[migrate] gagal baca default xlsx:', e.message);
    }
  }
  const txnCount = db.prepare('SELECT COUNT(*) c FROM transactions').get().c;
  const walletCount = db.prepare('SELECT COUNT(*) c FROM wallets').get().c;
  const billCount = db.prepare('SELECT COUNT(*) c FROM bills').get().c;
  const debtCount = db.prepare('SELECT COUNT(*) c FROM debts').get().c;
  return { db, status: { txnCount, walletCount, billCount, debtCount, isEmpty: walletCount === 0 && txnCount === 0 } };
}

module.exports = { bootstrap, initDb, migrateFromXlsx, DB_PATH, DEFAULT_XLSX };