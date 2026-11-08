'use strict';
// Menjalankan skrip PowerShell bawaan aplikasi (folder scripts/).
const { execFile } = require('child_process');
const path = require('path');

const SCRIPTS = path.join(__dirname, '..', 'scripts');

function runScript(name, args = [], timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Hanya tersedia di Windows'));
    const file = path.join(SCRIPTS, name);
    const ps = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      file,
      ...args.map(String),
    ];
    execFile(
      'powershell.exe',
      ps,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message || err).trim().split(/\r?\n/).slice(0, 4).join(' ');
          return reject(new Error(msg || 'PowerShell gagal'));
        }
        resolve(stdout);
      }
    );
  });
}

function readJsonFile(fs, file) {
  let s = fs.readFileSync(file, 'utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return JSON.parse(s);
}

module.exports = { runScript, readJsonFile };
