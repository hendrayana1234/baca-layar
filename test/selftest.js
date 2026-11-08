'use strict';
// Uji asap: jalankan dengan BACA_LAYAR_SELFTEST=<folder hasil> (dipakai saat pengembangan saja)
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

module.exports = function selftest(win, { ocr, nativeImage, settings, app, page }) {
  const outDir = process.env.BACA_LAYAR_SELFTEST;
  fs.mkdirSync(outDir, { recursive: true });
  const errors = [];
  const log = (...a) => console.log('[selftest]', ...a);
  const hook = (wc, name) =>
    wc.on('console-message', (e) => {
      const level = e.level ?? e.params?.level;
      const msg = e.message ?? e.params?.message;
      if (level === 'error' || level === 3) errors.push(`${name}: ${msg}`);
    });
  hook(win.webContents, 'main');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (w, file) => fs.writeFileSync(path.join(outDir, file), (await w.webContents.capturePage()).toPNG());

  win.webContents.once('did-finish-load', async () => {
    try {
      await sleep(1500);
      const js = (code) => win.webContents.executeJavaScript(code);

      // 0) Modul gulir mouse (user32.dll lewat koffi) — hanya di Windows
      if (process.platform === 'win32') {
        const mouse = require('../src/mouse');
        const api = mouse.loadNative();
        log('koffi user32:', api ? 'termuat' : 'GAGAL');
        if (!api) errors.push('koffi gagal dimuat');
        else {
          const pt = {};
          api.GetCursorPos(pt);
          log('GetCursorPos:', JSON.stringify(pt));
          const via = await mouse.scroll(null, 2);
          log('scroll via:', via);
        }
      }

      // 1) OCR di proses utama Electron
      const fixture = path.join(__dirname, 'fixtures', 'ut-reader.png');
      let text = '';
      if (fs.existsSync(fixture)) {
        const img = nativeImage.createFromPath(fixture).crop({ x: 240, y: 360, width: 1290, height: 578 });
        const t0 = Date.now();
        const r = await ocr.recognize(nativeImage, img, settings);
        text = r.text;
        log(`OCR ${r.engine} ${Date.now() - t0}ms, ${r.lines.length} baris`);
        log('awal teks:', JSON.stringify(text.slice(0, 80)));
        if (!text.startsWith('Sebagai dasar')) errors.push('OCR: awal teks tidak sesuai');
      }

      // 2) Tampilan tiap tab
      await js(`window.__bacaLayar.putText(${JSON.stringify(text || 'Contoh teks')}, false); window.__bacaLayar.setStatus('Terbaca 120 kata (Tesseract).', 'ok');`);
      await sleep(300);
      await shot(win, 'tab-baca.png');
      for (const tab of ['gulir', 'rekam', 'atur']) {
        await js(`document.querySelector('[data-tab=${tab}]').click()`);
        await sleep(tab === 'rekam' ? 2500 : 400);
        await shot(win, `tab-${tab}.png`);
      }
      await js(`document.querySelector('[data-tab=baca]').click(); document.querySelector('#btnContinuous').classList.add('on'); document.querySelector('#contLabel').textContent='Hentikan Baca Terus';`);
      await sleep(200);

      // 3) Layar pilih area
      const ov = new BrowserWindow({
        width: 1280,
        height: 720,
        show: true,
        frame: false,
        webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
      });
      hook(ov.webContents, 'overlay');
      await ov.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
      const bg = fs.existsSync(fixture) ? nativeImage.createFromPath(fixture).resize({ width: 1280 }) : nativeImage.createEmpty();
      ov.webContents.send('overlay:init', { image: bg.toDataURL(), width: 1280, height: 720 });
      await sleep(400);
      ov.webContents.sendInputEvent({ type: 'mouseDown', x: 160, y: 240, button: 'left', clickCount: 1 });
      ov.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 420, button: 'left' });
      ov.webContents.sendInputEvent({ type: 'mouseMove', x: 1020, y: 610, button: 'left' });
      await sleep(300);
      await shot(ov, 'overlay.png');
      ov.destroy();

      // 4) Halaman di dalam aplikasi: buka HTML lokal, OCR seluruh tampilan, gulir, Baca Terus 2 putaran, teks DOM
      if (page) {
        const html = path.join(outDir, 'halaman-uji.html');
        const paras = [];
        const topik = ['statistika dasar', 'pemrograman Python', 'basis data relasional', 'visualisasi grafik', 'etika profesi', 'pembelajaran mesin', 'pembersihan data', 'komunikasi hasil', 'eksperimen A/B', 'komputasi awan'];
        for (let i = 1; i <= 40; i++) {
          const t = topik[i % topik.length];
          paras.push(`<p>Paragraf nomor ${i} membahas ${t} secara ringkas; bagian ini ${i % 2 ? 'menjelaskan konsep utama dan contohnya' : 'memberi latihan singkat untuk mahasiswa'} agar mudah ${i % 3 ? 'dipahami' : 'dipraktikkan'}.</p>`);
        }
        fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><title>Uji Halaman</title><body style="font:20px/1.7 Georgia,serif;max-width:760px;margin:30px auto;color:#222;background:#fff">${paras.join('')}</body>`);
        page.openPage('file://' + html);
        await sleep(2500);
        const pw = page.getPageWin();
        if (pw) hook(pw.webContents, 'page');
        await shot(pw, 'halaman.png');
        const st = page.pageState();
        log('halaman:', st.title, st.url);
        if (!/Uji Halaman/.test(st.title || '')) errors.push('halaman: judul tidak terbaca');
        page.usePageRegion();
        const t1 = Date.now();
        const r1 = await page.recognizeLast({ continuous: true, reset: true });
        log(`OCR halaman ${Date.now() - t1}ms:`, JSON.stringify((r1.text || r1.error || '').slice(0, 70)));
        if (!/Paragraf nomor 1/.test(r1.text || '')) errors.push('halaman: OCR paragraf 1 gagal: ' + (r1.error || r1.text));
        const s = await page.scrollPage(5);
        log('gulir halaman:', JSON.stringify(s));
        await sleep(700);
        const r2 = await page.recognizeLast({ continuous: true });
        const nums = (t) => (t || '').match(/nomor \d+/g) || [];
        log('putaran 1 paragraf:', nums(r1.text).join(', '));
        log('putaran 2 paragraf:', nums(r2.text).join(', '), 'anchored=' + r2.anchored, 'same=' + r2.same);
        if (r2.same || !r2.text) errors.push('halaman: gulir tidak mengubah tampilan (same=' + r2.same + ')');
        if (r2.text && /Paragraf nomor 1\./.test(r2.text)) errors.push('halaman: paragraf 1 dibaca dua kali');
        const dom = await page.pageDomText();
        log('teks DOM:', dom.text ? dom.text.length + ' huruf' : dom.error);
        if (!dom.text || !/Paragraf nomor 40/.test(dom.text)) errors.push('halaman: teks DOM gagal');
        await shot(pw, 'halaman-setelah-gulir.png');

        // 4b) Halaman putih yang baru menampilkan tulisan setelah 2,5 detik → OCR harus menunggu
        const lazy = path.join(outDir, 'halaman-lambat.html');
        fs.writeFileSync(lazy, `<!doctype html><meta charset="utf-8"><title>Lambat</title><body style="font:22px Georgia,serif;margin:40px;background:#fff;color:#222"><div id="t"></div><script>setTimeout(()=>{document.getElementById('t').innerHTML='<p>Tulisan ini baru muncul setelah halaman selesai dimuat.</p><p>Baris kedua untuk memastikan OCR menunggu dengan benar.</p>'},2500)</script></body>`);
        page.openPage('file://' + lazy);
        await sleep(600);
        page.usePageRegion();
        const t2 = Date.now();
        const r3 = await page.recognizeLast({});
        log(`OCR halaman lambat ${Date.now() - t2}ms:`, JSON.stringify((r3.text || r3.error || '').slice(0, 60)), 'blank=' + !!r3.blank);
        if (!/baru muncul/.test(r3.text || '')) errors.push('halaman lambat: tidak menunggu tulisan muncul: ' + (r3.error || r3.note || r3.text));
        if (Date.now() - t2 < 1500) errors.push('halaman lambat: OCR tidak menunggu');
      }

      log('error renderer:', errors.length ? errors : 'tidak ada');
      fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ errors, text }, null, 2));
    } catch (e) {
      log('GAGAL', e.stack || e);
      fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ errors: [...errors, String(e)] }, null, 2));
    }
    app.exit(0);
  });
};
