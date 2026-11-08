'use strict';
// Uji tanpa Windows: OCR pada screenshot nyata, perapian teks,
// dan logika buang-teks-dobel saat halaman digulir.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { PNG } = require('pngjs');
const { createWorker } = require('tesseract.js');
const { preprocess } = require('../src/image-prep');
const T = require('../src/text-tools');

const FIX = path.join(__dirname, 'fixtures', 'ut-reader.png');

function crop(png, x, y, w, h) {
  const out = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++) {
    const s = ((y + j) * png.width + x) * 4;
    png.data.copy(out.data, j * w * 4, s, s + w * 4);
  }
  return out;
}

async function ocr(worker, png) {
  const { data } = preprocess(png.data, png.width, png.height, { order: 'rgba', cleanWatermark: true, threshold: 170 });
  const p = new PNG({ width: png.width, height: png.height });
  data.copy(p.data);
  const r = await worker.recognize(PNG.sync.write(p), {}, { blocks: true, text: true });
  return T.linesFromTesseract(r.data);
}

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ✓', name);
}

(async () => {
  console.log('Unit:');
  ok('baris angka watermark dibuang', () => {
    assert(T.isNoiseLine('054255381 054255381'));
    assert(T.isNoiseLine('— — —'));
    assert(!T.isNoiseLine('Tahun 2024 data naik'));
  });
  ok('drop cap "S ebagai" digabung', () => {
    const t = T.linesToText([{ text: 'S ebagai dasar', x0: 0, y0: 0, x1: 100, y1: 20 }]);
    assert.strictEqual(t, 'Sebagai dasar');
  });
  ok('"I am" bahasa Inggris tidak dirusak', () => {
    const t = T.linesToText([{ text: 'I am here', x0: 0, y0: 0, x1: 100, y1: 20 }]);
    assert.strictEqual(t, 'I am here');
  });
  ok('header diam (toolbar) dilewati saat gulir', () => {
    const L = (text, y) => ({ text, x0: 0, y0: y, x1: 500, y1: y + 20 });
    const prev = [L('Toolbar 199% 3 / 44', 0), L('baris satu yang cukup panjang', 40), L('baris dua yang cukup panjang', 70), L('baris tiga yang cukup panjang', 100)];
    const next = [L('Toolbar 199% 3 / 44', 0), L('baris dua yang cukup panjang', 40), L('baris tiga yang cukup panjang', 70), L('baris empat yang baru muncul', 100)];
    const r = T.newLinesAfterScroll(prev, next);
    assert(r.anchored);
    assert.deepStrictEqual(r.lines.map((l) => l.text), ['baris empat yang baru muncul']);
  });
  ok('akhir dokumen terdeteksi (gulir tidak berubah)', () => {
    const L = (text, y) => ({ text, x0: 0, y0: y, x1: 500, y1: y + 20 });
    const a = [L('isi halaman terakhir dokumen ini', 0), L('Daftar Pustaka lengkap di sini', 30)];
    assert(T.newLinesAfterScroll(a, a.map((l) => ({ ...l }))).same);
  });

  if (!fs.existsSync(FIX)) {
    console.log(`\nSemua ${passed} uji unit lulus. (Uji OCR dilewati: test/fixtures/ut-reader.png tidak ada.)`);
    return;
  }
  console.log('OCR screenshot halaman UT:');
  const src = PNG.sync.read(fs.readFileSync(FIX));
  const worker = await createWorker(['ind', 'eng'], 1, {
    langPath: path.join(__dirname, '..', 'tessdata'),
    cacheMethod: 'none',
  });

  const full = crop(src, 240, 360, 1290, 578);
  const lines = await ocr(worker, full);
  const text = T.linesToText(lines);
  console.log('\n' + text.split('\n').map((s) => '    | ' + s).join('\n') + '\n');
  ok('kalimat pertama utuh dengan huruf S', () => assert(text.startsWith('Sebagai dasar dalam mempelajari Sains Data')));
  ok('watermark NIM tidak terbaca', () => assert(!/0542|4255381/.test(text)));
  ok('daftar bernomor 1-4 per baris', () => {
    for (const n of ['1.', '2', '3.', '4.']) assert(text.split('\n').some((s) => s.startsWith(n + (n.endsWith('.') ? ' ' : ''))), 'tidak ada ' + n);
  });
  ok('"Secara khusus" jadi paragraf baru', () => assert(/\n\nSecara khusus/.test(text)));

  // Simulasi gulir: tangkapan pertama lalu tangkapan setelah halaman naik ~200px
  const H = 340;
  const a = crop(src, 240, 360, 1290, H);
  const b = crop(src, 240, 560, 1290, H);
  const la = T.dropEdgeLines(await ocr(worker, a), H);
  const lb = T.dropEdgeLines(await ocr(worker, b), H);
  const r = T.newLinesAfterScroll(la, lb);
  const firstRead = T.linesToText(la);
  const secondRead = T.linesToText(r.lines);
  console.log('    putaran 1:', JSON.stringify(firstRead.slice(-70)));
  console.log('    putaran 2:', JSON.stringify(secondRead.slice(0, 90)));
  ok('gulir: jangkar ditemukan', () => assert(r.anchored));
  ok('gulir: tidak ada baris dibaca dua kali', () => {
    for (const l of r.lines) assert(!la.some((p) => T.similarity(p.text, l.text) > 0.8), 'dobel: ' + l.text);
  });
  ok('gulir: baris baru ikut terbaca', () => assert(/3\. menjelaskan pertimbangan etika/.test(secondRead)));

  await worker.terminate();
  console.log(`\nSemua ${passed} uji lulus.`);
})().catch((e) => {
  console.error('GAGAL:', e.message);
  process.exit(1);
});
