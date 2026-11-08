'use strict';
// Alat olah teks hasil OCR: susun baris jadi paragraf, rapikan,
// dan buang bagian yang sudah dibaca saat halaman digulir (mode Baca Terus).

/** Baris dari Tesseract (blocks -> paragraphs -> lines). */
function linesFromTesseract(data) {
  const out = [];
  let para = 0;
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      para++;
      for (const l of p.lines || []) {
        const text = (l.text || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        out.push({ text, ...l.bbox, conf: l.confidence, para });
      }
    }
  }
  return out;
}

/** Baris dari Windows OCR (skrip PowerShell menulis {t,x,y,w,h}). */
function linesFromWindows(arr) {
  const list = Array.isArray(arr) ? arr : arr ? [arr] : [];
  return list
    .map((l) => ({
      text: String(l.t || '').replace(/\s+/g, ' ').trim(),
      x0: +l.x || 0,
      y0: +l.y || 0,
      x1: (+l.x || 0) + (+l.w || 0),
      y1: (+l.y || 0) + (+l.h || 0),
      conf: 90,
      para: 0,
    }))
    .filter((l) => l.text)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/** Buang baris yang terpotong di tepi atas/bawah gambar (dibaca di putaran berikutnya). */
function dropEdgeLines(lines, height, margin = 3) {
  return lines.filter((l) => l.y0 > margin && l.y1 < height - margin);
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const LIST_RE = /^(\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|[•●▪◦■\-–*])\s+/;
const END_RE = /[.!?:;"”)]$/;

/**
 * Tentukan awal paragraf memakai bentuk halaman: jarak antarbaris,
 * indentasi, dan tanda daftar (1. 2. a. •).
 */
function markParagraphs(lines) {
  if (!lines.length) return [];
  const heights = lines.map((l) => Math.max(1, l.y1 - l.y0));
  const lh = median(heights);
  const gaps = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i].y0 - lines[i - 1].y1);
  const gap = median(gaps.filter((g) => g > -lh));
  const left = Math.min(...lines.map((l) => l.x0));
  return lines.map((l, i) => {
    if (i === 0) return { ...l, start: true, list: LIST_RE.test(l.text) };
    const prev = lines[i - 1];
    const isList = LIST_RE.test(l.text);
    const bigGap = l.y0 - prev.y1 > gap + lh * 0.6;
    const indented = l.x0 - left > lh * 1.2;
    const newPara =
      (l.para && prev.para && l.para !== prev.para) ||
      bigGap ||
      (indented && END_RE.test(prev.text));
    return { ...l, start: newPara, list: isList };
  });
}

/** Huruf besar hiasan (drop cap) di awal paragraf: "ebagai …" + "S relatif …" -> "Sebagai …". */
function fixDropCap(lines) {
  const out = lines.map((l) => ({ ...l }));
  for (let i = 0; i < out.length; i++) {
    const l = out[i];
    if (!(i === 0 || l.start)) continue;
    // Kasus 1: huruf terpisah spasi di baris yang sama: "S ebagai"
    const m1 = l.text.match(/^([B-HJ-Z]) ([a-z]{2,})(.*)$/);
    if (m1) {
      l.text = m1[1] + m1[2] + m1[3];
      continue;
    }
    // Kasus 2: huruf jatuh ke awal baris berikutnya
    const next = out[i + 1];
    if (next && /^[a-z]/.test(l.text)) {
      const m2 = next.text.match(/^([A-Z]) (\S.*)$/);
      if (m2) {
        l.text = m2[1] + l.text;
        next.text = m2[2];
        next.start = false;
      }
    }
  }
  return out;
}

/** Penomoran "I." / "l." yang sebenarnya "1." (diikuti "2." di bawahnya). */
function fixListOne(lines) {
  return lines.map((l, i) => {
    if (!/^[Il|]\.\s/.test(l.text)) return l;
    const soon = lines.slice(i + 1, i + 6).some((n) => /^2[.)]?\s/.test(n.text));
    return soon ? { ...l, text: '1.' + l.text.slice(2), list: true } : l;
  });
}

/** Baris yang isinya hanya angka (sisa watermark NIM, nomor halaman lepas, dll). */
function isNoiseLine(text) {
  const t = text.replace(/\s/g, '');
  if (!t) return true;
  const digits = (t.match(/\d/g) || []).length;
  if (t.length >= 5 && digits / t.length >= 0.8) return true;
  // Sisa garis/titik tanpa huruf
  if (!/[\p{L}\d]/u.test(t)) return true;
  return false;
}

/**
 * Susun baris jadi teks.
 * tidy=true: gabung baris dalam satu paragraf, daftar tetap per baris.
 */
function linesToText(lines, opt = {}) {
  const tidy = opt.tidy !== false;
  let ls = lines.filter((l) => !(opt.removeNoise !== false && isNoiseLine(l.text)));
  if (!ls.length) return '';
  ls = markParagraphs(ls);
  ls = fixDropCap(ls);
  ls = fixListOne(ls);
  ls[0].start = true; // baris pertama selalu memulai paragraf
  if (!tidy) {
    let s = '';
    ls.forEach((l, i) => {
      if (i > 0) s += l.start ? '\n\n' : '\n';
      s += l.text;
    });
    return s.trim();
  }
  let s = '';
  ls.forEach((l, i) => {
    if (i === 0) {
      s = l.text;
      return;
    }
    if (l.start) s += '\n\n' + l.text;
    else if (l.list) s += '\n' + l.text;
    else if (/[A-Za-zÀ-ÿ]-$/.test(s) && /^[a-z]/.test(l.text)) s += l.text; // kata terpotong "pertama-" + "tama"
    else s += ' ' + l.text;
  });
  return s.replace(/[ \t]+/g, ' ').trim();
}

// ---------- pembanding baris untuk mode Baca Terus ----------

function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Kemiripan 0..1 antara dua teks (sudah dinormalisasi atau belum). */
function similarity(a, b) {
  const x = norm(a).slice(0, 400);
  const y = norm(b).slice(0, 400);
  if (!x && !y) return 1;
  const max = Math.max(x.length, y.length);
  return 1 - levenshtein(x, y) / max;
}

/**
 * Bandingkan hasil baca sebelum dan sesudah digulir.
 * Cari "jangkar": baris terakhir hasil sebelumnya yang muncul lagi di hasil baru,
 * lalu ambil hanya baris di bawahnya. Header yang diam di atas (toolbar)
 * otomatis terlewati karena posisinya di atas jangkar.
 *
 * @returns {{lines: object[], anchored: boolean, same: boolean}}
 */
function newLinesAfterScroll(prevLines, nextLines) {
  const prevText = prevLines.map((l) => l.text).join('\n');
  const nextText = nextLines.map((l) => l.text).join('\n');
  if (!nextLines.length) return { lines: [], anchored: false, same: !prevLines.length };
  if (prevLines.length && similarity(prevText, nextText) > 0.93) {
    return { lines: [], anchored: true, same: true };
  }
  const usable = (l) => norm(l.text).length >= 8;
  const stop = Math.max(0, prevLines.length - 6);
  for (let j = prevLines.length - 1; j >= stop; j--) {
    const pj = prevLines[j];
    if (!usable(pj)) continue;
    // Pilih pasangan baris paling mirip (bukan yang pertama ketemu): teks berpola mirip
    // (mis. "Paragraf 1 …", "Paragraf 9 …") tidak boleh saling tertukar. Baris sebelumnya ikut
    // dicocokkan sebagai konfirmasi; teks persis sama dapat nilai tambah.
    let best = null;
    for (let m = nextLines.length - 1; m >= 0; m--) {
      const sim = similarity(pj.text, nextLines[m].text);
      if (sim < 0.82) continue;
      const pPrev = prevLines[j - 1];
      const nPrev = nextLines[m - 1];
      let confirm = 0.5;
      if (pPrev && nPrev && usable(pPrev) && usable(nPrev)) {
        confirm = similarity(pPrev.text, nPrev.text);
        if (confirm < 0.6) continue;
      }
      const exact = norm(pj.text) === norm(nextLines[m].text) ? 1 : 0;
      const score = sim + confirm + exact;
      if (!best || score > best.score) best = { m, score };
    }
    if (best) return { lines: nextLines.slice(best.m + 1), anchored: true, same: false };
  }
  return { lines: nextLines, anchored: false, same: false };
}

module.exports = {
  linesFromTesseract,
  linesFromWindows,
  dropEdgeLines,
  linesToText,
  newLinesAfterScroll,
  similarity,
  isNoiseLine,
  markParagraphs,
};
