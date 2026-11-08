'use strict';
// Gulir roda mouse lewat user32.dll (koffi). Cadangan: skrip PowerShell.
const fs = require('fs');
const path = require('path');
const { runScript } = require('./winps');

function logError(msg) {
  try {
    const { app } = require('electron');
    const file = path.join(app.getPath('userData'), 'log.txt');
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) {
    /* abaikan */
  }
}

const MOUSEEVENTF_WHEEL = 0x0800;
const WHEEL_DELTA = 120;

let native = undefined; // undefined = belum dicoba, null = gagal

function loadNative() {
  if (native !== undefined) return native;
  native = null;
  if (process.platform !== 'win32') return native;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const POINT = koffi.struct('BL_POINT', { x: 'long', y: 'long' });
    native = {
      GetCursorPos: user32.func('bool __stdcall GetCursorPos(_Out_ BL_POINT *p)'),
      SetCursorPos: user32.func('bool __stdcall SetCursorPos(int x, int y)'),
      mouse_event: user32.func(
        'void __stdcall mouse_event(uint32_t flags, uint32_t dx, uint32_t dy, int32_t data, uintptr_t extra)'
      ),
      POINT,
    };
  } catch (e) {
    native = null;
    logError('koffi gagal dimuat (pakai cadangan PowerShell): ' + (e && e.stack ? e.stack : e));
  }
  return native;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Linux: roda mouse lewat xdotool (X11) — ydotool sebagai cadangan (Wayland).
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    require('child_process').execFile(cmd, args, { timeout: 10000 }, (err, out) => (err ? reject(err) : resolve(String(out || ''))));
  });
}
async function scrollLinux(physPoint, notches, restore) {
  const n = Math.max(1, Math.min(40, Math.abs(Math.round(notches)) || 1));
  const button = notches < 0 ? '4' : '5'; // 5 = ke bawah
  try {
    let old = null;
    if (physPoint) {
      const loc = await run('xdotool', ['getmouselocation', '--shell']);
      const m = /X=(\d+)[\s\S]*Y=(\d+)/.exec(loc);
      if (m) old = { x: +m[1], y: +m[2] };
      await run('xdotool', ['mousemove', String(Math.round(physPoint.x)), String(Math.round(physPoint.y))]);
      await sleep(40);
    }
    await run('xdotool', ['click', '--repeat', String(n), '--delay', '30', button]);
    if (physPoint && restore && old) {
      await sleep(80);
      await run('xdotool', ['mousemove', String(old.x), String(old.y)]);
    }
    return 'xdotool';
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      try {
        if (physPoint) await run('ydotool', ['mousemove', '--absolute', '-x', String(Math.round(physPoint.x)), '-y', String(Math.round(physPoint.y))]);
        for (let i = 0; i < n; i++) {
          await run('ydotool', ['mousemove', '--wheel', '-x', '0', '-y', notches < 0 ? '1' : '-1']);
          await sleep(30);
        }
        return 'ydotool';
      } catch (e2) {
        if (e2 && e2.code === 'ENOENT') throw new Error('xdotool tidak terpasang. Pasang dulu: sudo apt install xdotool');
        throw e2;
      }
    }
    throw e;
  }
}

/**
 * Gulir mouse.
 * @param {{x:number,y:number}|null} physPoint titik layar fisik; null = di posisi kursor sekarang
 * @param {number} notches jumlah "klik" roda, positif = ke bawah
 */
async function scroll(physPoint, notches, restore = true) {
  if (process.platform === 'linux') return scrollLinux(physPoint, notches, restore);
  const n = Math.max(1, Math.min(40, Math.abs(Math.round(notches)) || 1));
  const dir = notches < 0 ? 1 : -1; // nilai negatif pada mouse_event = turun
  const api = loadNative();
  if (api) {
    let old = null;
    if (physPoint) {
      old = {};
      api.GetCursorPos(old);
      api.SetCursorPos(Math.round(physPoint.x), Math.round(physPoint.y));
      await sleep(40);
    }
    for (let i = 0; i < n; i++) {
      api.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, dir * WHEEL_DELTA, 0);
      await sleep(30);
    }
    if (physPoint && restore && old && typeof old.x === 'number') {
      await sleep(80);
      api.SetCursorPos(old.x, old.y);
    }
    return 'native';
  }
  // Satu argumen berawalan "p:" — PowerShell 5.1 salah membaca argumen negatif seperti "-5".
  const x = physPoint ? Math.round(physPoint.x) : -99999;
  const y = physPoint ? Math.round(physPoint.y) : -99999;
  const spec = `p:${x},${y},${notches < 0 ? -n : n},${restore ? 1 : 0}`;
  await runScript('win-scroll.ps1', ['-Spec', spec], 20000);
  return 'powershell';
}

module.exports = { scroll, loadNative, logError };
