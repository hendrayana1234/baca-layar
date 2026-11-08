'use strict';
// Mesin OCR: Tesseract (bawaan, offline) atau OCR Windows.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { preprocess } = require('./image-prep');
const T = require('./text-tools');
const { runScript, readJsonFile } = require('./winps');

const TESSDATA = path.join(__dirname, '..', 'tessdata');

// Satu worker aktif: { langs, promise }. Ganti bahasa → worker lama dimatikan dulu.
// Bila pembuatan gagal, cache dikosongkan agar percobaan berikutnya membuat ulang.
let current = null;

function getWorker(langs) {
  if (current && current.langs === langs) return current.promise;
  const prev = current;
  const promise = (async () => {
    if (prev) {
      try {
        const old = await prev.promise;
        await old.terminate();
      } catch (_) {}
    }
    const { createWorker } = require('tesseract.js');
    const w = await createWorker(langs.split('+'), 1, {
      langPath: TESSDATA,
      cacheMethod: 'none',
      gzip: true,
    });
    await w.setParameters({ preserve_interword_spaces: '1' });
    return w;
  })();
  current = { langs, promise };
  promise.catch(() => {
    if (current && current.promise === promise) current = null;
  });
  return promise;
}

/** Siapkan Tesseract di latar belakang agar baca pertama lebih cepat. */
function warmUp(langs) {
  getWorker(langs).catch(() => {});
}

/**
 * Ubah NativeImage hasil potong layar jadi PNG siap OCR.
 * Diperbesar agar huruf kecil di layar lebih mudah dikenali.
 */
function prepareImage(nativeImage, img, settings) {
  const { width, height } = img.getSize();
  const big = Math.max(width, height);
  let factor = big < 1400 ? 2 : big < 2600 ? 1.5 : 1;
  if (settings.ocrEngine === 'windows') factor = Math.min(factor, 9000 / big); // batas OCR Windows
  let work = img;
  if (factor > 1.01) {
    work = img.resize({ width: Math.round(width * factor), height: Math.round(height * factor), quality: 'best' });
  }
  const size = work.getSize();
  const { data } = preprocess(work.toBitmap(), size.width, size.height, {
    order: 'bgra',
    cleanWatermark: settings.cleanWatermark,
    threshold: settings.watermarkThreshold,
  });
  const png = nativeImage.createFromBitmap(data, { width: size.width, height: size.height }).toPNG();
  return { png, width: size.width, height: size.height, factor };
}

async function recognizeTesseract(png, langs) {
  const w = await getWorker(langs);
  const r = await w.recognize(png, {}, { blocks: true, text: true });
  return T.linesFromTesseract(r.data);
}

async function recognizeWindows(png, langs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacalayar-'));
  const img = path.join(dir, 'area.png');
  const out = path.join(dir, 'hasil.json');
  try {
    fs.writeFileSync(img, png);
    const lang = langs.startsWith('ind') ? 'id' : 'en-US';
    await runScript('win-ocr.ps1', ['-ImageFile', img, '-OutFile', out, '-Lang', lang], 45000);
    return T.linesFromWindows(readJsonFile(fs, out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @returns {{lines, text, engine, note}}
 */
async function recognize(nativeImage, img, settings, opt = {}) {
  const prepared = prepareImage(nativeImage, img, settings);
  const langs = settings.ocrLang || 'ind+eng';
  let lines;
  let engine = settings.ocrEngine === 'windows' ? 'windows' : 'tesseract';
  let note = '';
  if (engine === 'windows') {
    try {
      lines = await recognizeWindows(prepared.png, langs);
    } catch (e) {
      note = 'OCR Windows gagal, memakai Tesseract. (' + e.message + ')';
      engine = 'tesseract';
    }
  }
  if (!lines) lines = await recognizeTesseract(prepared.png, langs);
  if (opt.dropEdges) lines = T.dropEdgeLines(lines, prepared.height, Math.round(3 * prepared.factor));
  const text = T.linesToText(lines, { tidy: settings.tidyText, removeNoise: settings.cleanWatermark });
  return { lines, text, engine, note };
}

module.exports = { recognize, warmUp, prepareImage };
