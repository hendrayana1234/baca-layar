'use strict';
// Persiapan gambar sebelum OCR: abu-abu, balik warna untuk tema gelap,
// dan buang watermark tipis (abu-abu muda) supaya tidak ikut terbaca.
// Bekerja langsung pada buffer piksel 4 kanal (RGBA atau BGRA).

function luminance(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/**
 * @param {Buffer|Uint8Array} buf  piksel 4 kanal
 * @param {number} width
 * @param {number} height
 * @param {object} opt
 *   order: 'rgba' | 'bgra'
 *   cleanWatermark: boolean  buang piksel terang (watermark, garis halus)
 *   threshold: 0..255        batas terang; piksel lebih terang dari ini jadi putih
 * @returns {{data: Buffer, inverted: boolean}} buffer RGBA abu-abu baru
 */
function preprocess(buf, width, height, opt = {}) {
  const order = opt.order || 'rgba';
  const clean = opt.cleanWatermark !== false;
  const threshold = clampNum(opt.threshold, 60, 245, 170);
  const n = width * height;
  const gray = new Uint8Array(n);
  let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = order === 'bgra' ? buf[p + 2] : buf[p];
    const g = buf[p + 1];
    const b = order === 'bgra' ? buf[p] : buf[p + 2];
    const v = luminance(r, g, b);
    gray[i] = v;
    sum += v;
  }
  // Latar gelap (mode gelap / slide hitam): balik supaya teks gelap di atas putih.
  const inverted = sum / n < 110;
  if (inverted) for (let i = 0; i < n; i++) gray[i] = 255 - gray[i];

  const out = Buffer.alloc(n * 4);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let v = gray[i];
    if (clean) {
      // Piksel lebih terang dari batas = latar/watermark -> putih.
      // Sisanya dipertegas sedikit agar tepi huruf tetap tajam.
      v = v >= threshold ? 255 : Math.round((v / threshold) * 180);
    }
    out[p] = out[p + 1] = out[p + 2] = v;
    out[p + 3] = 255;
  }
  return { data: out, inverted };
}

function clampNum(v, min, max, def) {
  const x = Number(v);
  if (!Number.isFinite(x)) return def;
  return Math.min(max, Math.max(min, x));
}

module.exports = { preprocess };
