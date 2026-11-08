'use strict';
// Uji asap: jalankan dengan BACA_LAYAR_SELFTEST=<folder hasil> (dipakai saat pengembangan saja)
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

module.exports = function selftest(win, { ocr, nativeImage, settings, app }) {
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

      log('error renderer:', errors.length ? errors : 'tidak ada');
      fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ errors, text }, null, 2));
    } catch (e) {
      log('GAGAL', e.stack || e);
      fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ errors: [...errors, String(e)] }, null, 2));
    }
    app.exit(0);
  });
};
