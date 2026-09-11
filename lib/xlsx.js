const zlib = require('node:zlib');

function extractXlsx(buffer) {
  const entries = centralDirectory(buffer);
  const files = {};
  for (const e of entries) {
    try {
      files[e.name] = decompressAt(buffer, e);
    } catch (err) {
      files[e.name] = null;
    }
  }
  return files;
}

function centralDirectory(buf) {
  let pos = buf.length - 22;
  while (pos > 0 && !(buf[pos] === 0x50 && buf[pos + 1] === 0x4b && buf[pos + 2] === 0x05 && buf[pos + 3] === 0x06)) pos--;
  if (pos < 0) throw new Error('EOCD not found: not a valid zip/xlsx');
  const count = buf.readUInt16LE(pos + 10);
  const cdStart = buf.readUInt32LE(pos + 16);
  const entries = [];
  let p = cdStart;
  for (let i = 0; i < count; i++) {
    const sig = buf.readUInt32LE(p);
    if (sig !== 0x02014b50) {
      throw new Error('Central directory corrupted at 0x' + p.toString(16));
    }
    const method = buf.readUInt16LE(p + 10);
    const flags = buf.readUInt16LE(p + 8);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, lho, flags });
    p += 46 + nameLen + extraLen + commLen;
  }
  return entries;
}

function decompressAt(buf, e) {
  let p = e.lho;
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + e.compSize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error('Unsupported compression method ' + e.method);
}

function stripXmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseSharedStrings(xml) {
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('');
    out.push(stripXmlEntities(texts));
  }
  return out;
}

function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseSheet(xml, shared) {
  const rows = {};
  const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rowNum = parseInt(rm[1], 10);
    const cells = {};
    const rowXml = rm[2];
    const cellRe = /<c r="([A-Z]+)(\d+)"([^>/]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rowXml))) {
      const col = cm[1];
      const attrs = cm[3];
      const content = cm[4];
      const tMatch = /t="([^"]*)"/.exec(attrs);
      const t = tMatch ? tMatch[1] : null;
      let value = '';
      if (content) {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(content);
        if (vMatch) {
          value = stripXmlEntities(vMatch[1]);
        } else {
          const isMatch = /<is>([\s\S]*?)<\/is>/.exec(content);
          if (isMatch) {
            value = stripXmlEntities([...isMatch[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
          }
        }
      }
      if (t === 's') {
        const idx = parseInt(value, 10);
        value = shared && Number.isFinite(idx) ? shared[idx] || '' : '';
      } else if (value !== '') {
        const num = toNum(value);
        value = num !== null ? num : value;
      }
      cells[col] = value;
    }
    rows[rowNum] = cells;
  }
  return rows;
}

function parseWorkbook(fileMap) {
  const wb = fileMap['xl/workbook.xml'] ? fileMap['xl/workbook.xml'].toString('utf8') : '';
  const rels = fileMap['xl/_rels/workbook.xml.rels'] ? fileMap['xl/_rels/workbook.xml.rels'].toString('utf8') : '';
  const sheets = [];
  const sheetRe = /<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g;
  const relRe = /<Relationship[^>]*Id="([^"]*)"[^>]*Target="([^"]*)"/g;
  const relMap = {};
  let m;
  while ((m = relRe.exec(rels))) relMap[m[1]] = m[2];
  while ((m = sheetRe.exec(wb))) {
    const target = relMap[m[2]] || '';
    const id = target.match(/([\w]+)\.xml$/);
    sheets.push({ name: stripXmlEntities(m[1]), file: target, id: id ? id[1] : null });
  }
  return sheets;
}

function parseXlsx(buffer) {
  const files = extractXlsx(buffer);
  const shared = parseSharedStrings(files['xl/sharedStrings.xml'] ? files['xl/sharedStrings.xml'].toString('utf8') : '<si/>');
  const sheets = parseWorkbook(files);
  const result = {};
  for (const sheet of sheets) {
    const path = sheet.file.startsWith('xl/') ? sheet.file : 'xl/' + sheet.file.replace(/^\/?/, '');
    const xmlBuf = files[path] || files['xl/worksheets/' + (sheet.id || sheet.file.split('/').pop())];
    const xml = xmlBuf ? xmlBuf.toString('utf8') : '';
    result[sheet.name] = { rows: parseSheet(xml, shared), file: path };
  }
  return result;
}

module.exports = { parseXlsx, extractXlsx, parseSheet, parseSharedStrings, toNum };